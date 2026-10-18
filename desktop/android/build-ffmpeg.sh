#!/usr/bin/env bash
# คอมไพล์ ffmpeg สำหรับ Stream Gateway ในแอป Android (หรือเครื่องนี้ เพื่อตรวจชุดคอมโพเนนต์)
#
#   desktop/android/build-ffmpeg.sh arm64-v8a  OUTDIR    ต้องมี ANDROID_NDK_HOME
#   desktop/android/build-ffmpeg.sh x86_64     OUTDIR    (สำหรับ emulator)
#   desktop/android/build-ffmpeg.sh host       OUTDIR    คอมไพล์ให้เครื่องนี้ (Linux) ด้วยชุดคอมโพเนนต์เดียวกัน
#
# ผลลัพธ์: OUTDIR/ffmpeg — โปรแกรมเดียว ลิงก์ x264 / mbedtls (RTMPS) / libsrt แบบ static
# Android: ใช้ตัวเข้ารหัสฮาร์ดแวร์ของเครื่อง (h264_mediacodec ผ่าน NDK) ได้ และมี libx264 สำรอง
# ไลเซนส์: ffmpeg + x264 = GPL — ซอร์สของทุกส่วนดาวน์โหลดได้จากเวอร์ชันที่ระบุด้านล่าง
set -euo pipefail

ABI=${1:?usage: build-ffmpeg.sh arm64-v8a|x86_64|host OUTDIR}
OUT=$(mkdir -p "${2:?OUTDIR}" && cd "$2" && pwd)
WORK=${WORK:-$PWD/.ffmpeg-build}
API=${ANDROID_API:-24}
JOBS=${JOBS:-$(nproc)}

FFMPEG_TAG=n7.1.1
X264_REF=31e19f9   # x264 stable (0.164.3108)
MBEDTLS_VER=3.6.2
SRT_TAG=v1.5.4

mkdir -p "$WORK/src"
SRC=$WORK/src
BUILD=$WORK/build-$ABI
PREFIX=$BUILD/prefix
rm -rf "$BUILD" && mkdir -p "$PREFIX"

fetch() {
  [ -d "$SRC/ffmpeg" ] || git clone -q --depth 1 --branch "$FFMPEG_TAG" https://github.com/FFmpeg/FFmpeg.git "$SRC/ffmpeg"
  if [ ! -d "$SRC/x264" ]; then
    git clone -q https://github.com/mirror/x264.git "$SRC/x264"
    git -C "$SRC/x264" checkout -q "$X264_REF"
  fi
  [ -d "$SRC/srt" ] || git clone -q --depth 1 --branch "$SRT_TAG" https://github.com/Haivision/srt.git "$SRC/srt"
  if [ ! -d "$SRC/mbedtls" ]; then
    curl -fsSL "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-$MBEDTLS_VER/mbedtls-$MBEDTLS_VER.tar.bz2" | tar -xj -C "$SRC"
    mv "$SRC/mbedtls-$MBEDTLS_VER" "$SRC/mbedtls"
  fi
}
fetch

CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_PREFIX_PATH="$PREFIX")
X264_ARGS=()
FF_ARGS=()
case "$ABI" in
  host)
    export CC=${CC:-cc} CXX=${CXX:-c++}
    ;;
  arm64-v8a|x86_64)
    NDK=${ANDROID_NDK_HOME:?ANDROID_NDK_HOME ต้องชี้ไปที่ Android NDK}
    TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64
    [ "$ABI" = arm64-v8a ] && { TRIPLE=aarch64-linux-android; ARCH=aarch64; CPU=armv8-a; } || { TRIPLE=x86_64-linux-android; ARCH=x86_64; CPU=x86-64; }
    export CC=$TC/bin/$TRIPLE$API-clang CXX=$TC/bin/$TRIPLE$API-clang++ AR=$TC/bin/llvm-ar RANLIB=$TC/bin/llvm-ranlib STRIP=$TC/bin/llvm-strip NM=$TC/bin/llvm-nm
    CMAKE_ARGS+=(-DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" -DANDROID_ABI="$ABI" -DANDROID_PLATFORM="android-$API" -DANDROID_STL=c++_static -DCMAKE_FIND_ROOT_PATH="$PREFIX")
    X264_ARGS+=(--host="$TRIPLE" --sysroot="$TC/sysroot")
    # x86_64 ใช้กับ emulator เท่านั้น — ปิด asm (ไม่ต้องพึ่ง nasm และเลี่ยง text relocation)
    [ "$ABI" = x86_64 ] && X264_ARGS+=(--disable-asm) && FF_ARGS+=(--disable-x86asm)
    FF_ARGS+=(--enable-cross-compile --target-os=android --arch="$ARCH" --cpu="$CPU" --cc="$CC" --cxx="$CXX" --ar="$AR" --ranlib="$RANLIB" --strip="$STRIP" --nm="$NM"
      --sysroot="$TC/sysroot" --enable-jni --enable-mediacodec --enable-encoder=h264_mediacodec
      --extra-ldflags="-Wl,-z,max-page-size=16384 -static-libstdc++" --extra-libs="-lc++_static -lc++abi")
    ;;
  *) echo "ABI ไม่รู้จัก: $ABI" >&2; exit 2 ;;
esac
export PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig

echo "== mbedtls $MBEDTLS_VER ($ABI)"
cmake -S "$SRC/mbedtls" -B "$BUILD/mbedtls" "${CMAKE_ARGS[@]}" -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF -DMBEDTLS_FATAL_WARNINGS=OFF -DUSE_SHARED_MBEDTLS_LIBRARY=OFF -DUSE_STATIC_MBEDTLS_LIBRARY=ON >/dev/null
cmake --build "$BUILD/mbedtls" -j "$JOBS" >"$BUILD/mbedtls.log" 2>&1 || { tail -30 "$BUILD/mbedtls.log"; exit 1; }
cmake --install "$BUILD/mbedtls" >/dev/null

echo "== srt $SRT_TAG ($ABI)"
cmake -S "$SRC/srt" -B "$BUILD/srt" "${CMAKE_ARGS[@]}" -DENABLE_APPS=OFF -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DENABLE_CXX11=ON \
  -DUSE_ENCLIB=mbedtls -DMBEDTLS_INCLUDE_DIRS="$PREFIX/include" -DMBEDTLS_INCLUDE_DIR="$PREFIX/include" \
  -DMBEDTLS_LIBRARIES="$PREFIX/lib/libmbedtls.a;$PREFIX/lib/libmbedx509.a;$PREFIX/lib/libmbedcrypto.a" >/dev/null
cmake --build "$BUILD/srt" -j "$JOBS" >"$BUILD/srt.log" 2>&1 || { tail -30 "$BUILD/srt.log"; exit 1; }
cmake --install "$BUILD/srt" >/dev/null
# srt.pc ของ static build ต้องลิงก์ mbedtls ด้วย
sed -i "s#^Libs.private:.*#& -L$PREFIX/lib -lmbedtls -lmbedx509 -lmbedcrypto#" "$PREFIX/lib/pkgconfig/srt.pc"
# Android: ใช้ C++ runtime แบบ static (แอปไม่มี libc++_shared.so ให้ ffmpeg)
if [ "$ABI" != host ]; then
  sed -i -E 's/-l(c\+\+|stdc\+\+)( |$)/-lc++_static -lc++abi\2/g' "$PREFIX/lib/pkgconfig/srt.pc"
fi

echo "== x264 ($ABI)"
rm -rf "$BUILD/x264" && cp -r "$SRC/x264" "$BUILD/x264"
(cd "$BUILD/x264" && ./configure --prefix="$PREFIX" --enable-static --enable-pic --disable-cli "${X264_ARGS[@]}" >/dev/null && make -j "$JOBS" >/dev/null && make install >/dev/null)

echo "== ffmpeg $FFMPEG_TAG ($ABI)"
rm -rf "$BUILD/ffmpeg" && mkdir -p "$BUILD/ffmpeg"
(cd "$BUILD/ffmpeg" && "$SRC/ffmpeg/configure" --prefix="$PREFIX" --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib" \
  --disable-doc --disable-ffplay --disable-ffprobe --disable-debug --disable-shared --enable-static --enable-pic \
  --enable-gpl --enable-version3 --disable-everything --disable-autodetect --enable-pthreads \
  --enable-libx264 --enable-libsrt --enable-mbedtls \
  --enable-protocol=file,pipe,tcp,udp,tls,rtmp,rtmps,libsrt \
  --enable-demuxer=matroska,mov,mpegts,flv,aac,h264 \
  --enable-indev=lavfi --enable-avdevice --enable-avfilter --enable-swscale --enable-swresample \
  --enable-decoder=vp8,vp9,h264,hevc,av1,opus,aac,mp3,pcm_s16le,pcm_f32le,wrapped_avframe \
  --enable-encoder=libx264,aac,wrapped_avframe \
  --enable-muxer=flv,mpegts,null,matroska,mp4 \
  --enable-parser=h264,hevc,aac,opus,vp8,vp9,av1 \
  --enable-bsf=dump_extra,h264_mp4toannexb,aac_adtstoasc,extract_extradata,vp9_superframe_split,h264_metadata \
  --enable-filter=color,testsrc,scale,format,aformat,aresample,fps,null,anull,setpts,asetpts,anullsrc,trim,atrim \
  "${FF_ARGS[@]}" >"$BUILD/ffmpeg-configure.log" 2>&1) || { tail -40 "$BUILD/ffmpeg-configure.log"; tail -60 "$BUILD/ffmpeg/ffbuild/config.log" 2>/dev/null; exit 1; }
make -C "$BUILD/ffmpeg" -j "$JOBS" ffmpeg >"$BUILD/ffmpeg-make.log" 2>&1 || { tail -40 "$BUILD/ffmpeg-make.log"; exit 1; }
cp "$BUILD/ffmpeg/ffmpeg" "$OUT/ffmpeg"
"${STRIP:-strip}" "$OUT/ffmpeg"
# Android: ต้องพึ่งแค่ไลบรารีของระบบ (libc, libm, libdl, liblog, libmediandk, libandroid …)
if [ "$ABI" != host ]; then
  NEEDED=$("$TC/bin/llvm-readelf" -d "$OUT/ffmpeg" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p' | tr '\n' ' ')
  echo "NEEDED: $NEEDED"
  for lib in $NEEDED; do
    case "$lib" in libc.so|libm.so|libdl.so|liblog.so|libmediandk.so|libandroid.so|libz.so|libEGL.so|libGLESv2.so|libOpenSLES.so|libnativewindow.so) ;;
      *) echo "ffmpeg ต้องใช้ $lib ซึ่งไม่มีในเครื่อง Android" >&2; exit 1 ;;
    esac
  done
fi
ls -la "$OUT/ffmpeg"
