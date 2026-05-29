#!/usr/bin/env bash
# get-ffmpeg-nvenc.sh
# Download a static Linux x64 ffmpeg/ffprobe with NVENC + CUDA support (BtbN GPL
# build), verify the h264_nvenc encoder exists, and run a REAL nvenc smoke test
# against the local NVIDIA driver. No root / no apt required.
#
# Usage:  ./get-ffmpeg-nvenc.sh [install-dir]      (default: ~/ffmpeg-nvenc)

set -euo pipefail

DEST="${1:-$HOME/ffmpeg-nvenc}"
URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"

mkdir -p "$DEST"
cd "$DEST"

if [ -x "$DEST/ffmpeg" ] && "$DEST/ffmpeg" -hide_banner -version >/dev/null 2>&1; then
  echo "== ffmpeg already present at $DEST/ffmpeg, skipping download =="
else
  echo "== downloading static ffmpeg with NVENC/CUDA (BtbN linux64-gpl) =="
  if command -v curl >/dev/null; then
    curl -fL --retry 3 "$URL" -o ffmpeg.tar.xz
  elif command -v wget >/dev/null; then
    wget -O ffmpeg.tar.xz "$URL"
  else
    echo "ERROR: need curl or wget" >&2; exit 1
  fi

  echo "== extracting =="
  tar xf ffmpeg.tar.xz

  # BtbN tarballs extract to a versioned dir; locate the binaries
  BIN_DIR="$(dirname "$(find "$DEST" -type f -name ffmpeg ! -lname '*' | head -1)")"
  [ -n "$BIN_DIR" ] || { echo "ERROR: ffmpeg binary not found after extract" >&2; exit 1; }
  ln -sf "$BIN_DIR/ffmpeg"  "$DEST/ffmpeg"
  ln -sf "$BIN_DIR/ffprobe" "$DEST/ffprobe"
fi

echo
echo "ffmpeg : $DEST/ffmpeg"
"$DEST/ffmpeg" -hide_banner -version | head -1

# 1) encoder must be compiled in.
#    NOTE: capture the list first. Piping into `grep -q` makes grep exit on the
#    first match, which SIGPIPEs ffmpeg; under `set -o pipefail` that non-zero
#    exit looks like failure EVEN WHEN the encoder is present (false negative).
ENCODERS="$("$DEST/ffmpeg" -hide_banner -encoders 2>/dev/null || true)"
if ! grep -q h264_nvenc <<<"$ENCODERS"; then
  echo "ERROR: this build lacks h264_nvenc." >&2
  echo "nvenc-related encoders found:" >&2
  grep -i nvenc <<<"$ENCODERS" >&2 || echo "  (none)" >&2
  exit 1
fi
echo "h264_nvenc encoder: present"

# 2) driver must actually be able to encode (libnvidia-encode at runtime)
echo
echo "== NVENC smoke test (exercises the GPU) =="
if "$DEST/ffmpeg" -hide_banner -loglevel error \
     -f lavfi -i testsrc=size=320x240:rate=30:duration=1 \
     -c:v h264_nvenc -f null - 2>/tmp/nvenc_err; then
  echo "RESULT: PASS - NVENC encoding works on this GPU."
  echo
  echo "Now run the benchmark pointed at this ffmpeg:"
  echo
  echo "  FFMPEG=$DEST/ffmpeg FFPROBE=$DEST/ffprobe ~/scs-encode-benchmark.sh ~/Janus"
else
  echo "RESULT: FAIL - the encoder is present but the GPU rejected the encode." >&2
  echo "---- ffmpeg error ----" >&2
  cat /tmp/nvenc_err >&2
  echo "----------------------" >&2
  echo "Most likely the NVIDIA driver / libnvidia-encode.so isn't installed or visible." >&2
  echo "Check:  nvidia-smi   and   ldconfig -p | grep -i libnvidia-encode" >&2
  exit 1
fi
