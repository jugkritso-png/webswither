/* ไลบรารีจำลอง NDI + OMT สำหรับชุดทดสอบ — ส่ง/รับภายในโปรเซสเดียวกัน (ไม่ใช้เครือข่าย)
 * ฟังก์ชันและโครงสร้างตาม Processing.NDI.*.h และ libomt.h (เฉพาะส่วนที่ WebMix ใช้)
 * สร้าง: cc -shared -fPIC -O2 -o libnetvideo-mock.so netvideo-mock.c -lpthread */
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define SLOTS 16
#define RING 64

typedef struct { float *data; int channels, samples, rate; } chunk_t;
typedef struct {
	bool used;
	char name[256], full[300];
	uint8_t *video; int vsize, w, h, stride, fpsn, fpsd; uint32_t fourcc; long seq;
	chunk_t ring[RING]; long acount;
	int connections;
} slot_t;

static slot_t slots[SLOTS];
static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;

static void nap(void) { struct timespec t = { 0, 2000000 }; nanosleep(&t, NULL); }
static long now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1000 + t.tv_nsec / 1000000; }

static slot_t *add_sender(const char *name) {
	pthread_mutex_lock(&mu);
	for (int i = 0; i < SLOTS; i++) if (slots[i].used && !strcmp(slots[i].name, name)) { pthread_mutex_unlock(&mu); return NULL; }
	for (int i = 0; i < SLOTS; i++) if (!slots[i].used) {
		memset(&slots[i], 0, sizeof slots[i]);
		slots[i].used = true;
		snprintf(slots[i].name, sizeof slots[i].name, "%s", name);
		snprintf(slots[i].full, sizeof slots[i].full, "MOCKHOST (%s)", name);
		pthread_mutex_unlock(&mu);
		return &slots[i];
	}
	pthread_mutex_unlock(&mu);
	return NULL;
}
static void del_sender(slot_t *s) {
	pthread_mutex_lock(&mu);
	free(s->video);
	for (int i = 0; i < RING; i++) free(s->ring[i].data);
	memset(s, 0, sizeof *s);
	pthread_mutex_unlock(&mu);
}
static void put_video(slot_t *s, const uint8_t *data, int w, int h, int stride, uint32_t fourcc, int n, int d) {
	pthread_mutex_lock(&mu);
	int size = stride * h;
	if (size != s->vsize) { free(s->video); s->video = malloc(size); s->vsize = size; }
	memcpy(s->video, data, size);
	s->w = w; s->h = h; s->stride = stride; s->fourcc = fourcc; s->fpsn = n; s->fpsd = d; s->seq++;
	pthread_mutex_unlock(&mu);
}
static void put_audio(slot_t *s, const float *planar, int channels, int samples, int channel_stride_floats, int rate) {
	pthread_mutex_lock(&mu);
	chunk_t *c = &s->ring[s->acount % RING];
	free(c->data);
	c->data = malloc(sizeof(float) * channels * samples);
	for (int ch = 0; ch < channels; ch++) memcpy(c->data + ch * samples, planar + ch * channel_stride_floats, sizeof(float) * samples);
	c->channels = channels; c->samples = samples; c->rate = rate;
	s->acount++;
	pthread_mutex_unlock(&mu);
}

typedef struct { char want[300]; slot_t *slot; long seq, aread; void *vbuf, *abuf; } recv_t;
static slot_t *resolve(recv_t *r) {
	if (r->slot && r->slot->used && (!strcmp(r->slot->full, r->want) || !strcmp(r->slot->name, r->want))) return r->slot;
	for (int i = 0; i < SLOTS; i++) if (slots[i].used && (!strcmp(slots[i].full, r->want) || !strcmp(slots[i].name, r->want))) {
		r->slot = &slots[i]; slots[i].connections++; r->seq = slots[i].seq - 1; r->aread = slots[i].acount; return r->slot;
	}
	r->slot = NULL;
	return NULL;
}
static recv_t *new_recv(const char *name) { recv_t *r = calloc(1, sizeof *r); snprintf(r->want, sizeof r->want, "%s", name); return r; }
static void del_recv(recv_t *r) {
	pthread_mutex_lock(&mu);
	if (r->slot && r->slot->used && r->slot->connections > 0) r->slot->connections--;
	pthread_mutex_unlock(&mu);
	free(r->vbuf); free(r->abuf); free(r);
}
/* 1 = ภาพ, 2 = เสียง, 0 = หมดเวลา — ข้อมูลอยู่ใน r->vbuf / r->abuf จนกว่าจะเรียกครั้งถัดไป */
static int take(recv_t *r, int timeout, slot_t *out_v, chunk_t *out_a) {
	long end = now_ms() + timeout;
	do {
		pthread_mutex_lock(&mu);
		slot_t *s = resolve(r);
		if (s) {
			if (s->acount - r->aread > RING) r->aread = s->acount - RING;
			if (r->aread < s->acount) {
				chunk_t *c = &s->ring[r->aread++ % RING];
				free(r->abuf); r->abuf = malloc(sizeof(float) * c->channels * c->samples);
				memcpy(r->abuf, c->data, sizeof(float) * c->channels * c->samples);
				*out_a = *c; out_a->data = r->abuf;
				pthread_mutex_unlock(&mu);
				return 2;
			}
			if (s->seq > r->seq && s->video) {
				free(r->vbuf); r->vbuf = malloc(s->vsize); memcpy(r->vbuf, s->video, s->vsize);
				*out_v = *s; out_v->video = r->vbuf; r->seq = s->seq;
				pthread_mutex_unlock(&mu);
				return 1;
			}
		}
		pthread_mutex_unlock(&mu);
		nap();
	} while (now_ms() < end);
	return 0;
}

/* ------------------------------------------------------------------ NDI */
typedef struct { const char *name, *url; } NDIlib_source_t;
typedef struct { bool show_local; const char *groups, *extra; } NDIlib_find_create_t;
typedef struct { const char *name, *groups; bool clock_video, clock_audio; } NDIlib_send_create_t;
typedef struct { NDIlib_source_t src; int color, bandwidth; bool fields; const char *recv_name; } NDIlib_recv_create_v3_t;
typedef struct { int xres, yres; uint32_t fourcc; int n, d; float aspect; int format; int64_t timecode; uint8_t *data; int stride; const char *meta; int64_t ts; } NDIlib_video_frame_v2_t;
typedef struct { int rate, channels, samples; int64_t timecode; float *data; int channel_stride; const char *meta; int64_t ts; } NDIlib_audio_frame_v2_t;
typedef struct { int length; int64_t timecode; char *data; } NDIlib_metadata_frame_t;

bool NDIlib_initialize(void) { return true; }
const char *NDIlib_version(void) { return "NDI MOCK 1.0"; }
void *NDIlib_find_create_v2(const NDIlib_find_create_t *c) { (void)c; return (void *)1; }
static NDIlib_source_t found[SLOTS];
static char found_names[SLOTS][300];
const NDIlib_source_t *NDIlib_find_get_current_sources(void *f, uint32_t *n) {
	(void)f;
	pthread_mutex_lock(&mu);
	uint32_t k = 0;
	for (int i = 0; i < SLOTS; i++) if (slots[i].used) { strcpy(found_names[k], slots[i].full); found[k].name = found_names[k]; found[k].url = "127.0.0.1:5961"; k++; }
	pthread_mutex_unlock(&mu);
	*n = k;
	return found;
}
bool NDIlib_find_wait_for_sources(void *f, uint32_t ms) { (void)f; usleep(ms > 50 ? 50000 : ms * 1000); return true; }
void *NDIlib_send_create(const NDIlib_send_create_t *c) { return add_sender(c && c->name ? c->name : "Untitled"); }
void NDIlib_send_destroy(void *s) { if (s) del_sender(s); }
void NDIlib_send_send_video_v2(void *s, const NDIlib_video_frame_v2_t *v) { put_video(s, v->data, v->xres, v->yres, v->stride, v->fourcc, v->n, v->d); }
void NDIlib_send_send_audio_v2(void *s, const NDIlib_audio_frame_v2_t *a) { put_audio(s, a->data, a->channels, a->samples, a->channel_stride / 4, a->rate); }
int NDIlib_send_get_no_connections(void *s, uint32_t ms) { (void)ms; pthread_mutex_lock(&mu); int n = ((slot_t *)s)->connections; pthread_mutex_unlock(&mu); return n; }
void *NDIlib_recv_create_v3(const NDIlib_recv_create_v3_t *c) { return new_recv(c->src.name ? c->src.name : ""); }
void NDIlib_recv_destroy(void *r) { del_recv(r); }
int NDIlib_recv_capture_v2(void *inst, NDIlib_video_frame_v2_t *v, NDIlib_audio_frame_v2_t *a, NDIlib_metadata_frame_t *m, uint32_t timeout) {
	(void)m;
	slot_t sv; chunk_t ca;
	int k = take(inst, timeout, &sv, &ca);
	if (k == 1 && v) { memset(v, 0, sizeof *v); v->xres = sv.w; v->yres = sv.h; v->fourcc = sv.fourcc; v->n = sv.fpsn; v->d = sv.fpsd; v->format = 1; v->data = sv.video; v->stride = sv.stride; return 1; }
	if (k == 2 && a) { memset(a, 0, sizeof *a); a->rate = ca.rate; a->channels = ca.channels; a->samples = ca.samples; a->data = ca.data; a->channel_stride = ca.samples * 4; return 2; }
	return 0;
}
void NDIlib_recv_free_video_v2(void *r, const NDIlib_video_frame_v2_t *v) { (void)r; (void)v; }
void NDIlib_recv_free_audio_v2(void *r, const NDIlib_audio_frame_v2_t *a) { (void)r; (void)a; }
void NDIlib_recv_free_metadata(void *r, const NDIlib_metadata_frame_t *m) { (void)r; (void)m; }

/* ------------------------------------------------------------------ OMT */
typedef struct {
	int Type; int64_t Timestamp; uint32_t Codec; int Width, Height, Stride, Flags, FrameRateN, FrameRateD; float AspectRatio; int ColorSpace, SampleRate, Channels, SamplesPerChannel;
	void *Data; int DataLength; void *CompressedData; int CompressedLength; void *FrameMetadata; int FrameMetadataLength;
} OMTMediaFrame;
#define FOURCC(a, b, c, d) ((uint32_t)(a) | (uint32_t)(b) << 8 | (uint32_t)(c) << 16 | (uint32_t)(d) << 24)

static char *addrs[SLOTS];
char **omt_discovery_getaddresses(int *count) {
	pthread_mutex_lock(&mu);
	int k = 0;
	for (int i = 0; i < SLOTS; i++) if (slots[i].used) addrs[k++] = slots[i].full;
	pthread_mutex_unlock(&mu);
	*count = k;
	return addrs;
}
typedef struct { recv_t *r; OMTMediaFrame f; } omt_recv_t;
void *omt_receive_create(const char *address, int types, int format, int flags) { (void)types; (void)format; (void)flags; omt_recv_t *o = calloc(1, sizeof *o); o->r = new_recv(address); return o; }
void omt_receive_destroy(void *inst) { omt_recv_t *o = inst; del_recv(o->r); free(o); }
OMTMediaFrame *omt_receive(void *inst, int types, int timeout) {
	(void)types;
	omt_recv_t *o = inst;
	slot_t sv; chunk_t ca;
	int k = take(o->r, timeout, &sv, &ca);
	memset(&o->f, 0, sizeof o->f);
	if (k == 1) {
		o->f.Type = 2; o->f.Codec = sv.fourcc; o->f.Width = sv.w; o->f.Height = sv.h; o->f.Stride = sv.stride; o->f.FrameRateN = sv.fpsn; o->f.FrameRateD = sv.fpsd;
		o->f.Data = sv.video; o->f.DataLength = sv.stride * sv.h;
		return &o->f;
	}
	if (k == 2) {
		o->f.Type = 4; o->f.Codec = FOURCC('F', 'P', 'A', '1'); o->f.SampleRate = ca.rate; o->f.Channels = ca.channels; o->f.SamplesPerChannel = ca.samples;
		o->f.Data = ca.data; o->f.DataLength = ca.channels * ca.samples * 4;
		return &o->f;
	}
	return NULL;
}
void *omt_send_create(const char *name, int quality) { (void)quality; return add_sender(name); }
void omt_send_destroy(void *s) { if (s) del_sender(s); }
int omt_send(void *s, OMTMediaFrame *f) {
	if (f->Type == 2) put_video(s, f->Data, f->Width, f->Height, f->Stride, f->Codec, f->FrameRateN, f->FrameRateD);
	else if (f->Type == 4) put_audio(s, f->Data, f->Channels, f->SamplesPerChannel, f->SamplesPerChannel, f->SampleRate);
	return 0;
}
int omt_send_connections(void *s) { pthread_mutex_lock(&mu); int n = ((slot_t *)s)->connections * 2; pthread_mutex_unlock(&mu); return n; }
