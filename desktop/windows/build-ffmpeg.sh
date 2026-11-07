#!/usr/bin/env bash
# คอมไพล์ ffmpeg.exe ที่ฝังในแอป WebMix Pro บน Windows — ผู้ใช้ไม่ต้อง winget install ffmpeg เอง
#
#   desktop/windows/build-ffmpeg.sh OUTDIR      (รันบน Linux · คอมไพล์ข้ามแพลตฟอร์มด้วย mingw-w64)
#   ต้องมี: mingw-w64 (x86_64-w64-mingw32-gcc-posix), cmake, nasm, pkg-config, make, git, curl
#
# ผลลัพธ์: OUTDIR/ffmpeg.exe (Windows 10/11 64 บิต) — x264 / OpenSSL (RTMPS) / libsrt (+ mbedtls) ลิงก์ static
#   พึ่งเฉพาะ DLL ที่มากับ Windows · ใช้ตัวเข้ารหัสของการ์ดจอได้: NVIDIA (h264_nvenc) และ AMD (h264_amf)
#   (สองตัวนี้ใช้แค่ไฟล์ header — โหลดไดรเวอร์ของเครื่องตอนใช้งาน ไม่มีโค้ดของไดรเวอร์อยู่ในไฟล์)
#   BUILD_FFPROBE=1 → ได้ OUTDIR/ffprobe.exe ด้วย (ใช้ตรวจผลใน CI ไม่ได้แนบไปกับแอป)
# ชุดคอมโพเนนต์ตรงกับ desktop/macos/build-ffmpeg.sh (ที่ Stream Gateway ในแอปใช้) · เวอร์ชันตรงกับสคริปต์ Android
# ไลเซนส์: ffmpeg + x264 = GPL — แนบไลเซนส์และรายการซอร์สไปกับแอป
set -euo pipefail

OUT=$(mkdir -p "${1:?usage: build-ffmpeg.sh OUTDIR}" && cd "$1" && pwd)
WORK=${WORK:-$PWD/.ffmpeg-build-windows}
JOBS=${JOBS:-$(nproc)}

FFMPEG_TAG=n7.1.1
X264_REF=31e19f9   # x264 stable (0.164.3108)
MBEDTLS_VER=3.6.2   # ใช้กับ libsrt เท่านั้น
OPENSSL_TAG=openssl-3.5.9
SRT_TAG=v1.5.4
NVHEADERS_TAG=n12.2.72.0   # header ของ NVENC (MIT) — ffmpeg โหลด nvEncodeAPI64.dll ของไดรเวอร์ตอนใช้งาน
AMF_TAG=v1.4.36            # header ของ AMD AMF (MIT) — โหลด amfrt64.dll ของไดรเวอร์ตอนใช้งาน

HOST=x86_64-w64-mingw32
# -posix: เธรดแบบ POSIX ของ mingw (libsrt ต้องใช้ std::thread) · ลิงก์ runtime ของ gcc แบบ static
CC_BIN=$HOST-gcc-posix CXX_BIN=$HOST-g++-posix
for t in "$CC_BIN" "$CXX_BIN" cmake nasm pkg-config; do command -v "$t" >/dev/null || { echo "ไม่พบ $t (apt install mingw-w64 cmake nasm pkg-config)" >&2; exit 2; }; done

mkdir -p "$WORK/src"
SRC=$WORK/src
BUILD=$WORK/build
PREFIX=$BUILD/prefix
rm -rf "$BUILD" && mkdir -p "$PREFIX/include"

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
  [ -d "$SRC/nv-codec-headers" ] || git clone -q --depth 1 --branch "$NVHEADERS_TAG" https://github.com/FFmpeg/nv-codec-headers.git "$SRC/nv-codec-headers"
  if [ ! -d "$SRC/amf" ]; then
    # คลังของ AMF ใหญ่ (มีไฟล์ไบนารี) — ดึงเฉพาะโฟลเดอร์ header
    git clone -q --depth 1 --branch "$AMF_TAG" --filter=blob:none --sparse https://github.com/GPUOpen-LibrariesAndSDKs/AMF.git "$SRC/amf"
    git -C "$SRC/amf" sparse-checkout set amf/public/include
  fi
}
fetch

export PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig
CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_PREFIX_PATH="$PREFIX"
  -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_C_COMPILER="$CC_BIN" -DCMAKE_CXX_COMPILER="$CXX_BIN" -DCMAKE_RC_COMPILER=$HOST-windres
  -DCMAKE_FIND_ROOT_PATH="$PREFIX;/usr/$HOST" -DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY
  -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY -DCMAKE_POLICY_VERSION_MINIMUM=3.5)

echo "== mbedtls $MBEDTLS_VER"
cmake -S "$SRC/mbedtls" -B "$BUILD/mbedtls" "${CMAKE_ARGS[@]}" -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF -DMBEDTLS_FATAL_WARNINGS=OFF \
  -DUSE_SHARED_MBEDTLS_LIBRARY=OFF -DUSE_STATIC_MBEDTLS_LIBRARY=ON >/dev/null
cmake --build "$BUILD/mbedtls" -j "$JOBS" >"$BUILD/mbedtls.log" 2>&1 || { tail -30 "$BUILD/mbedtls.log"; exit 1; }
cmake --install "$BUILD/mbedtls" >/dev/null

# RTMPS ใช้ OpenSSL (mbedtls จับมือกับ RTMPS ของ Facebook ไม่ผ่าน — ดูหมายเหตุในสคริปต์ Android)
echo "== $OPENSSL_TAG"
rm -rf "$BUILD/openssl" && cp -r "$SRC/openssl" "$BUILD/openssl"
(cd "$BUILD/openssl" && ./Configure mingw64 --cross-compile-prefix=$HOST- no-shared no-tests no-docs no-apps no-module no-engine no-legacy \
  --prefix="$PREFIX" --libdir=lib >/dev/null && make -j "$JOBS" build_libs >"$BUILD/openssl.log" 2>&1 && make install_dev >/dev/null) \
  || { tail -30 "$BUILD/openssl.log"; exit 1; }

echo "== srt $SRT_TAG"
# Windows ไม่มี pthreads ของระบบ — ให้ libsrt ใช้เธรดของ C++11 (ENABLE_STDCXX_SYNC)
cmake -S "$SRC/srt" -B "$BUILD/srt" "${CMAKE_ARGS[@]}" -DENABLE_APPS=OFF -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DENABLE_CXX11=ON -DENABLE_STDCXX_SYNC=ON \
  -DUSE_ENCLIB=mbedtls -DMBEDTLS_INCLUDE_DIRS="$PREFIX/include" -DMBEDTLS_INCLUDE_DIR="$PREFIX/include" \
  -DMBEDTLS_LIBRARIES="$PREFIX/lib/libmbedtls.a;$PREFIX/lib/libmbedx509.a;$PREFIX/lib/libmbedcrypto.a" >/dev/null
cmake --build "$BUILD/srt" -j "$JOBS" >"$BUILD/srt.log" 2>&1 || { tail -30 "$BUILD/srt.log"; exit 1; }
cmake --install "$BUILD/srt" >/dev/null
# srt.pc ของ static build ต้องลิงก์ mbedtls และไลบรารีเครือข่ายของ Windows ด้วย
sed -i "s#^Libs.private:.*#& -L$PREFIX/lib -lmbedtls -lmbedx509 -lmbedcrypto -lws2_32 -lbcrypt#" "$PREFIX/lib/pkgconfig/srt.pc"

echo "== x264"
rm -rf "$BUILD/x264" && cp -r "$SRC/x264" "$BUILD/x264"
(cd "$BUILD/x264" && CC=$CC_BIN ./configure --prefix="$PREFIX" --host=$HOST --cross-prefix=$HOST- --enable-static --enable-pic --disable-cli >"$BUILD/x264.log" 2>&1 \
  && make -j "$JOBS" >>"$BUILD/x264.log" 2>&1 && make install >/dev/null) || { tail -30 "$BUILD/x264.log"; exit 1; }

echo "== nv-codec-headers $NVHEADERS_TAG · AMF $AMF_TAG"
make -C "$SRC/nv-codec-headers" PREFIX="$PREFIX" install >/dev/null
rm -rf "$PREFIX/include/AMF" && cp -r "$SRC/amf/amf/public/include" "$PREFIX/include/AMF"

echo "== ffmpeg $FFMPEG_TAG"
rm -rf "$BUILD/ffmpeg" && mkdir -p "$BUILD/ffmpeg"
PROGS=(--disable-ffprobe); [ "${BUILD_FFPROBE:-}" = 1 ] && PROGS=(--enable-ffprobe)
(cd "$BUILD/ffmpeg" && "$SRC/ffmpeg/configure" --prefix="$PREFIX" --pkg-config=pkg-config --pkg-config-flags=--static \
  --enable-cross-compile --target-os=mingw32 --arch=x86_64 --cross-prefix=$HOST- --cc="$CC_BIN" --cxx="$CXX_BIN" \
  --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib -static -static-libgcc -static-libstdc++" --extra-libs="-lws2_32 -lcrypt32 -lbcrypt" \
  --disable-doc --disable-ffplay "${PROGS[@]}" --disable-debug --disable-shared --enable-static \
  --enable-gpl --enable-version3 --disable-everything --disable-autodetect --enable-w32threads \
  --enable-libx264 --enable-libsrt --enable-openssl --enable-ffnvcodec --enable-nvenc --enable-amf \
  --enable-protocol=file,pipe,tcp,udp,tls,rtmp,rtmps,libsrt,rtp,srtp \
  --enable-demuxer=matroska,mov,mpegts,flv,aac,h264,hevc,rtsp,sdp,rtp,rawvideo,pcm_f32le \
  --enable-indev=lavfi --enable-avdevice --enable-avfilter --enable-swscale --enable-swresample \
  --enable-decoder=vp8,vp9,h264,hevc,av1,opus,aac,mp3,pcm_s16le,pcm_f32le,pcm_mulaw,pcm_alaw,rawvideo,wrapped_avframe \
  --enable-encoder=libx264,h264_nvenc,h264_amf,aac,wrapped_avframe \
  --enable-muxer=flv,mpegts,null,matroska,mp4 \
  --enable-parser=h264,hevc,aac,opus,vp8,vp9,av1 \
  --enable-bsf=dump_extradata,h264_mp4toannexb,hevc_mp4toannexb,aac_adtstoasc,extract_extradata,vp9_superframe_split,h264_metadata \
  --enable-filter=color,testsrc,scale,format,aformat,aresample,fps,null,anull,setpts,asetpts,anullsrc,trim,atrim,split,crop,boxblur,overlay,setsar,pad \
  >"$BUILD/ffmpeg-configure.log" 2>&1) || { tail -40 "$BUILD/ffmpeg-configure.log"; tail -60 "$BUILD/ffmpeg/ffbuild/config.log" 2>/dev/null; exit 1; }
TARGETS=(ffmpeg); [ "${BUILD_FFPROBE:-}" = 1 ] && TARGETS+=(ffprobe)
make -C "$BUILD/ffmpeg" -j "$JOBS" "${TARGETS[@]}" >"$BUILD/ffmpeg-make.log" 2>&1 || { tail -40 "$BUILD/ffmpeg-make.log"; exit 1; }

# ต้องพึ่งเฉพาะ DLL ที่มากับ Windows — ไม่อย่างนั้นเครื่องผู้ใช้เปิดไม่ได้ (เช่น libwinpthread-1.dll, libstdc++-6.dll)
SYSTEM_DLLS='^(kernel32|msvcrt|ws2_32|advapi32|user32|bcrypt|crypt32|ole32|oleaut32|shell32|shlwapi|gdi32|secur32|iphlpapi|userenv|ntdll|psapi|dbghelp|mfplat|mfuuid|strmiids|api-ms-win-.*)\.dll$'
for prog in "${TARGETS[@]}"; do
  cp "$BUILD/ffmpeg/$prog.exe" "$OUT/$prog.exe"
  $HOST-strip "$OUT/$prog.exe"
  DLLS=$($HOST-objdump -p "$OUT/$prog.exe" | sed -n 's/^[[:space:]]*DLL Name: //p' | tr 'A-Z' 'a-z' | sort -u)
  BAD=$(echo "$DLLS" | grep -vE "$SYSTEM_DLLS" || true)
  [ -z "$BAD" ] || { echo "$prog.exe ต้องใช้ DLL ที่ไม่มีใน Windows: $BAD" >&2; exit 1; }
  echo "$prog.exe: $(du -h "$OUT/$prog.exe" | cut -f1) · DLL: $(echo $DLLS | tr '\n' ' ')"
done

# GPL: แนบไลเซนส์และบอกที่มาของซอร์สไปกับแอป
cp "$SRC/ffmpeg/COPYING.GPLv2" "$OUT/LICENSE-GPLv2.txt"
cat > "$OUT/SOURCES.txt" <<EOF
ffmpeg.exe ในแอปนี้คอมไพล์จากซอร์สต่อไปนี้ด้วย desktop/windows/build-ffmpeg.sh (https://github.com/jugkritso-png/webswither)
FFmpeg $FFMPEG_TAG  https://github.com/FFmpeg/FFmpeg/tree/$FFMPEG_TAG  (GPL v2 หรือใหม่กว่า — เพราะรวม x264)
x264 $X264_REF      https://code.videolan.org/videolan/x264
OpenSSL $OPENSSL_TAG  https://github.com/openssl/openssl  (Apache 2.0)
SRT $SRT_TAG        https://github.com/Haivision/srt  (MPL 2.0)
Mbed TLS $MBEDTLS_VER  https://github.com/Mbed-TLS/mbedtls  (Apache 2.0)
nv-codec-headers $NVHEADERS_TAG  https://github.com/FFmpeg/nv-codec-headers  (MIT)
AMD AMF headers $AMF_TAG  https://github.com/GPUOpen-LibrariesAndSDKs/AMF  (MIT)
mingw-w64 runtime   https://www.mingw-w64.org  (ZPL / public domain)
EOF
