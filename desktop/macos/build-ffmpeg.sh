#!/usr/bin/env bash
# คอมไพล์ ffmpeg ที่ฝังในแอป WebMix Pro บน macOS — ผู้ใช้ไม่ต้องติดตั้ง ffmpeg / Homebrew เอง
#
#   desktop/macos/build-ffmpeg.sh OUTDIR        (รันบน Mac · ต้องมี Xcode Command Line Tools, cmake, nasm, pkg-config)
#
# ผลลัพธ์: OUTDIR/ffmpeg — โปรแกรมเดียวใช้ได้ทั้งชิป Apple (arm64) และ Intel (x86_64)
#   ลิงก์ x264 / OpenSSL (RTMPS) / libsrt (+ mbedtls) แบบ static · ใช้ตัวเข้ารหัสของเครื่อง (h264_videotoolbox) ได้
#   พึ่งเฉพาะไลบรารีและ framework ของ macOS
#   BUILD_FFPROBE=1 → ได้ OUTDIR/ffprobe ด้วย (ใช้ตรวจผลใน CI ไม่ได้แนบไปกับแอป)
# ชุดคอมโพเนนต์ = ที่ Stream Gateway ในแอป (desktop/gateway) ใช้: ส่งออก RTMP/RTMPS/SRT, ภาพแนวตั้ง 9:16,
#   รับ SRT / RTMP / กล้อง IP (RTSP), NDI / OMT (ภาพ rawvideo + เสียง f32le ทาง pipe)
# เวอร์ชันตรงกับ desktop/android/build-ffmpeg.sh · ไลเซนส์: ffmpeg + x264 = GPL — ซอร์สดาวน์โหลดได้จากเวอร์ชันด้านล่าง
set -euo pipefail

OUT=$(mkdir -p "${1:?usage: build-ffmpeg.sh OUTDIR}" && cd "$1" && pwd)
WORK=${WORK:-$PWD/.ffmpeg-build-macos}
JOBS=${JOBS:-$(sysctl -n hw.ncpu)}
MACOS_MIN=11.0   # ตรงกับ minimumSystemVersion ของแอป (tauri.conf.json)

FFMPEG_TAG=n7.1.1
X264_REF=31e19f9   # x264 stable (0.164.3108)
MBEDTLS_VER=3.6.2   # ใช้กับ libsrt เท่านั้น
OPENSSL_TAG=openssl-3.5.9
SRT_TAG=v1.5.4

[ "$(uname -s)" = Darwin ] || { echo "ต้องรันบน macOS" >&2; exit 2; }
for t in cmake nasm pkg-config; do command -v "$t" >/dev/null || { echo "ไม่พบ $t (brew install $t)" >&2; exit 2; }; done

mkdir -p "$WORK/src"
SRC=$WORK/src
fetch() {
  [ -d "$SRC/ffmpeg" ] || git clone -q --depth 1 --branch "$FFMPEG_TAG" https://github.com/FFmpeg/FFmpeg.git "$SRC/ffmpeg"
  if [ ! -d "$SRC/x264" ]; then
    git clone -q https://github.com/mirror/x264.git "$SRC/x264"
    git -C "$SRC/x264" checkout -q "$X264_REF"
  fi
  [ -d "$SRC/srt" ] || git clone -q --depth 1 --branch "$SRT_TAG" https://github.com/Haivision/srt.git "$SRC/srt"
  [ -d "$SRC/openssl" ] || git clone -q --depth 1 --branch "$OPENSSL_TAG" https://github.com/openssl/openssl.git "$SRC/openssl"
  if [ ! -d "$SRC/mbedtls" ]; then
    curl -fsSL "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-$MBEDTLS_VER/mbedtls-$MBEDTLS_VER.tar.bz2" | tar -xj -C "$SRC"
    mv "$SRC/mbedtls-$MBEDTLS_VER" "$SRC/mbedtls"
  fi
}
fetch

# สร้างทีละสถาปัตยกรรม แล้วรวมเป็นไฟล์เดียวด้วย lipo
build_arch() {
  local ARCH=$1   # arm64 | x86_64
  local BUILD=$WORK/build-$ARCH PREFIX=$WORK/build-$ARCH/prefix
  rm -rf "$BUILD" && mkdir -p "$PREFIX"
  local HOST TRIPLE OSSL_TARGET FFARCH
  if [ "$ARCH" = arm64 ]; then TRIPLE=aarch64-apple-darwin; OSSL_TARGET=darwin64-arm64-cc; FFARCH=aarch64
  else TRIPLE=x86_64-apple-darwin; OSSL_TARGET=darwin64-x86_64-cc; FFARCH=x86_64; fi
  HOST=$(uname -m); [ "$HOST" = arm64 ] && HOST=arm64 || HOST=x86_64
  local FLAGS="-arch $ARCH -mmacosx-version-min=$MACOS_MIN"
  export CC="clang $FLAGS" CXX="clang++ $FLAGS" CFLAGS="" LDFLAGS=""
  export MACOSX_DEPLOYMENT_TARGET=$MACOS_MIN
  export PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig
  local CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_POSITION_INDEPENDENT_CODE=ON
    -DCMAKE_PREFIX_PATH="$PREFIX" -DCMAKE_OSX_ARCHITECTURES="$ARCH" -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN" -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++)

  echo "== mbedtls $MBEDTLS_VER ($ARCH)"
  CC=clang CXX=clang++ cmake -S "$SRC/mbedtls" -B "$BUILD/mbedtls" "${CMAKE_ARGS[@]}" -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF -DMBEDTLS_FATAL_WARNINGS=OFF \
    -DUSE_SHARED_MBEDTLS_LIBRARY=OFF -DUSE_STATIC_MBEDTLS_LIBRARY=ON >/dev/null
  cmake --build "$BUILD/mbedtls" -j "$JOBS" >"$BUILD/mbedtls.log" 2>&1 || { tail -30 "$BUILD/mbedtls.log"; exit 1; }
  cmake --install "$BUILD/mbedtls" >/dev/null

  # RTMPS ใช้ OpenSSL (mbedtls จับมือกับ RTMPS ของ Facebook ไม่ผ่าน — ดูหมายเหตุในสคริปต์ Android)
  echo "== $OPENSSL_TAG ($ARCH)"
  rm -rf "$BUILD/openssl" && cp -R "$SRC/openssl" "$BUILD/openssl"
  (cd "$BUILD/openssl" && CC=clang ./Configure "$OSSL_TARGET" no-shared no-tests no-docs no-apps no-module no-engine no-legacy \
    "-mmacosx-version-min=$MACOS_MIN" --prefix="$PREFIX" --libdir=lib >/dev/null &&
    make -j "$JOBS" build_libs >"$BUILD/openssl.log" 2>&1 && make install_dev >/dev/null) || { tail -30 "$BUILD/openssl.log"; exit 1; }

  echo "== srt $SRT_TAG ($ARCH)"
  CC=clang CXX=clang++ cmake -S "$SRC/srt" -B "$BUILD/srt" "${CMAKE_ARGS[@]}" -DENABLE_APPS=OFF -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DENABLE_CXX11=ON \
    -DUSE_ENCLIB=mbedtls -DMBEDTLS_INCLUDE_DIRS="$PREFIX/include" -DMBEDTLS_INCLUDE_DIR="$PREFIX/include" \
    -DMBEDTLS_LIBRARIES="$PREFIX/lib/libmbedtls.a;$PREFIX/lib/libmbedx509.a;$PREFIX/lib/libmbedcrypto.a" >/dev/null
  cmake --build "$BUILD/srt" -j "$JOBS" >"$BUILD/srt.log" 2>&1 || { tail -30 "$BUILD/srt.log"; exit 1; }
  cmake --install "$BUILD/srt" >/dev/null
  # srt.pc ของ static build ต้องลิงก์ mbedtls ด้วย (perl: sed -i ของ macOS ต่างจาก Linux)
  perl -pi -e "s#^(Libs.private:.*)#\$1 -L$PREFIX/lib -lmbedtls -lmbedx509 -lmbedcrypto#" "$PREFIX/lib/pkgconfig/srt.pc"

  echo "== x264 ($ARCH)"
  rm -rf "$BUILD/x264" && cp -R "$SRC/x264" "$BUILD/x264"
  local X264_ARGS=(--prefix="$PREFIX" --enable-static --enable-pic --disable-cli)
  [ "$ARCH" != "$HOST" ] && X264_ARGS+=(--host="$TRIPLE")
  (cd "$BUILD/x264" && ./configure "${X264_ARGS[@]}" --extra-cflags="$FLAGS" --extra-ldflags="$FLAGS" >"$BUILD/x264.log" 2>&1 && make -j "$JOBS" >>"$BUILD/x264.log" 2>&1 && make install >/dev/null) \
    || { tail -30 "$BUILD/x264.log"; exit 1; }

  echo "== ffmpeg $FFMPEG_TAG ($ARCH)"
  rm -rf "$BUILD/ffmpeg" && mkdir -p "$BUILD/ffmpeg"
  local FF_ARGS=(--arch="$FFARCH" --target-os=darwin --cc="clang $FLAGS" --cxx="clang++ $FLAGS")
  [ "$ARCH" != "$HOST" ] && FF_ARGS+=(--enable-cross-compile)
  local PROGS=(--disable-ffprobe); [ "${BUILD_FFPROBE:-}" = 1 ] && PROGS=(--enable-ffprobe)
  (cd "$BUILD/ffmpeg" && "$SRC/ffmpeg/configure" --prefix="$PREFIX" --pkg-config=pkg-config --pkg-config-flags=--static \
    --extra-cflags="-I$PREFIX/include $FLAGS" --extra-ldflags="-L$PREFIX/lib $FLAGS" \
    --disable-doc --disable-ffplay "${PROGS[@]}" --disable-debug --disable-shared --enable-static --enable-pic \
    --enable-gpl --enable-version3 --disable-everything --disable-autodetect --enable-pthreads \
    --enable-libx264 --enable-libsrt --enable-openssl --enable-videotoolbox --enable-audiotoolbox \
    --enable-protocol=file,pipe,tcp,udp,tls,rtmp,rtmps,libsrt,rtp,srtp \
    --enable-demuxer=matroska,mov,mpegts,flv,aac,h264,hevc,rtsp,sdp,rtp,rawvideo,pcm_f32le \
    --enable-indev=lavfi --enable-avdevice --enable-avfilter --enable-swscale --enable-swresample \
    --enable-decoder=vp8,vp9,h264,hevc,av1,opus,aac,mp3,pcm_s16le,pcm_f32le,pcm_mulaw,pcm_alaw,rawvideo,wrapped_avframe \
    --enable-encoder=libx264,h264_videotoolbox,aac,wrapped_avframe \
    --enable-muxer=flv,mpegts,null,matroska,mp4 \
    --enable-parser=h264,hevc,aac,opus,vp8,vp9,av1 \
    --enable-bsf=dump_extradata,h264_mp4toannexb,hevc_mp4toannexb,aac_adtstoasc,extract_extradata,vp9_superframe_split,h264_metadata \
    --enable-filter=color,testsrc,scale,format,aformat,aresample,fps,null,anull,setpts,asetpts,anullsrc,trim,atrim,split,crop,boxblur,overlay,setsar,pad \
    "${FF_ARGS[@]}" >"$BUILD/ffmpeg-configure.log" 2>&1) || { tail -40 "$BUILD/ffmpeg-configure.log"; tail -60 "$BUILD/ffmpeg/ffbuild/config.log" 2>/dev/null; exit 1; }
  local TARGETS=(ffmpeg); [ "${BUILD_FFPROBE:-}" = 1 ] && TARGETS+=(ffprobe)
  make -C "$BUILD/ffmpeg" -j "$JOBS" "${TARGETS[@]}" >"$BUILD/ffmpeg-make.log" 2>&1 || { tail -40 "$BUILD/ffmpeg-make.log"; exit 1; }
}

build_arch arm64
build_arch x86_64
for prog in ffmpeg $([ "${BUILD_FFPROBE:-}" = 1 ] && echo ffprobe); do
  lipo -create "$WORK/build-arm64/ffmpeg/$prog" "$WORK/build-x86_64/ffmpeg/$prog" -output "$OUT/$prog"
  strip "$OUT/$prog"
  # ต้องพึ่งเฉพาะของ macOS (/usr/lib, /System/Library) — ไม่อย่างนั้นเครื่องผู้ใช้ที่ไม่มี Homebrew เปิดไม่ได้
  BAD=$(otool -L "$OUT/$prog" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/)' || true)
  [ -z "$BAD" ] || { echo "$prog ต้องใช้ไลบรารีที่ไม่มีใน macOS: $BAD" >&2; exit 1; }
  echo "$prog: $(lipo -archs "$OUT/$prog") · $(du -h "$OUT/$prog" | cut -f1)"
done
"$OUT/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -E 'libx264|h264_videotoolbox|aac' || true
# GPL: แนบไลเซนส์และบอกที่มาของซอร์สไปกับแอป
cp "$SRC/ffmpeg/COPYING.GPLv2" "$OUT/LICENSE-GPLv2.txt"
cat > "$OUT/SOURCES.txt" <<EOF
ffmpeg ในแอปนี้คอมไพล์จากซอร์สต่อไปนี้ด้วย desktop/macos/build-ffmpeg.sh (https://github.com/jugkritso-png/webswither)
FFmpeg $FFMPEG_TAG  https://github.com/FFmpeg/FFmpeg/tree/$FFMPEG_TAG  (GPL v2 หรือใหม่กว่า — เพราะรวม x264)
x264 $X264_REF      https://code.videolan.org/videolan/x264
OpenSSL $OPENSSL_TAG  https://github.com/openssl/openssl  (Apache 2.0)
SRT $SRT_TAG        https://github.com/Haivision/srt  (MPL 2.0)
Mbed TLS $MBEDTLS_VER  https://github.com/Mbed-TLS/mbedtls  (Apache 2.0)
EOF
