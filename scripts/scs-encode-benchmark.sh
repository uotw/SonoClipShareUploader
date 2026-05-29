#!/usr/bin/env bash
# scs-encode-benchmark.sh
# Compare CPU (libx264) vs GPU (NVENC / CUDA) H.264 encode speed for the
# SonoClipShare de-identification step, using the SAME target-bitrate VBR
# model, de-id crop, and decode path as the uploader's ffmpeg-wrapper.js.
#
# Usage:  ./scs-encode-benchmark.sh [dir-with-mp4s]      (default: current dir)
# Env:    BPP, MIN_KBPS, MAX_KBPS, CROP_PCT, ITER, RUN_PARALLEL, FFMPEG, FFPROBE
#
# Notes:
#  - The GPU number includes the CPU de-id crop (frames are decoded on the GPU,
#    downloaded for the crop, re-uploaded to NVENC) because that is exactly what
#    the production path does. A fully-GPU filter chain (crop_cuda/scale_npp)
#    would be faster but is NOT how the app de-identifies today.
#  - A one-time warmup per encoder absorbs driver/codec cold-start before timing.

set -uo pipefail

DIR="${1:-.}"
BPP="${BPP:-0.12}"            # bits-per-pixel quality knob (matches BITRATE_MODEL)
MIN_KBPS="${MIN_KBPS:-2000}"
MAX_KBPS="${MAX_KBPS:-12000}"
CROP_PCT="${CROP_PCT:-0.09}"  # auto de-id crop fraction of height (app default)
ITER="${ITER:-3}"            # timed runs per file per encoder; the min is reported
RUN_PARALLEL="${RUN_PARALLEL:-1}"   # also run a concurrent throughput test
PRESET_CPU="${PRESET_CPU:-medium}"
PRESET_GPU="${PRESET_GPU:-medium}"  # legacy nvenc preset name; widely supported

FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---------- preflight ----------
command -v "$FFMPEG"  >/dev/null || { echo "ffmpeg not found";  exit 1; }
command -v "$FFPROBE" >/dev/null || { echo "ffprobe not found"; exit 1; }

echo "== environment =="
"$FFMPEG" -hide_banner -version | head -1
if command -v nvidia-smi >/dev/null; then
  nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
else
  echo "nvidia-smi not found (GPU info unavailable)"
fi
# Capture the encoder list first; piping into `grep -q` can SIGPIPE ffmpeg and,
# under pipefail, falsely report the encoder missing when it is actually present.
ENCODERS="$("$FFMPEG" -hide_banner -encoders 2>/dev/null || true)"
if ! grep -q h264_nvenc <<<"$ENCODERS"; then
  echo "ERROR: this ffmpeg has no h264_nvenc encoder - GPU test impossible." >&2
  echo "Point FFMPEG/FFPROBE at the build from get-ffmpeg-nvenc.sh." >&2
  exit 1
fi
echo

now_ms(){ date +%s%3N; }

# run one encode; echoes elapsed ms. args: mode in out crop target max buf
run_encode(){
  local mode="$1" in="$2" out="$3" crop="$4" t="$5" m="$6" b="$7" start end
  start=$(now_ms)
  if [ "$mode" = gpu ]; then
    "$FFMPEG" -y -hide_banner -loglevel error \
      -hwaccel cuda -i "$in" \
      -an -map_metadata -1 -vf "$crop" \
      -c:v h264_nvenc -preset "$PRESET_GPU" -rc vbr \
      -b:v "${t}k" -maxrate "${m}k" -bufsize "${b}k" -profile:v high \
      -pix_fmt yuv420p "$out"
  else
    "$FFMPEG" -y -hide_banner -loglevel error \
      -i "$in" \
      -an -map_metadata -1 -vf "$crop" \
      -c:v libx264 -preset "$PRESET_CPU" \
      -b:v "${t}k" -maxrate "${m}k" -bufsize "${b}k" -profile:v high \
      -pix_fmt yuv420p "$out"
  fi
  end=$(now_ms)
  echo $(( end - start ))
}

# probe + compute crop/target for a file; sets globals W H FPS T M B CROP
prep(){
  local f="$1" fr
  read -r W H fr <<<"$("$FFPROBE" -v error -select_streams v:0 \
      -show_entries stream=width,height,avg_frame_rate -of csv=p=0:s=' ' "$f")"
  FPS=$(awk -v r="$fr" 'BEGIN{n=split(r,a,"/"); if(n==2&&a[2]>0)printf "%.3f",a[1]/a[2]; else printf "%.3f",r}')
  T=$(awk -v bpp="$BPP" -v w="$W" -v h="$H" -v fps="$FPS" -v mn="$MIN_KBPS" -v mx="$MAX_KBPS" \
        'BEGIN{k=bpp*w*h*fps/1000; if(k<mn)k=mn; if(k>mx)k=mx; printf "%d",(k+0.5)}')
  M=$(awk -v t="$T" 'BEGIN{printf "%d",(t*1.5+0.5)}')
  B=$(awk -v t="$T" 'BEGIN{printf "%d",(t*2)}')
  local cp
  cp=$(awk -v h="$H" -v p="$CROP_PCT" 'BEGIN{printf "%d",2*int(h*p/2+0.5)}')
  CROP="crop=in_w:in_h-${cp}:0:${cp},setsar=1,scale=trunc(iw/2)*2:trunc(ih/2)*2"
}

out_kbps(){ # echo output avg bitrate in kbps
  awk -v br="$("$FFPROBE" -v error -show_entries format=bit_rate -of csv=p=0 "$1" 2>/dev/null)" \
      'BEGIN{printf "%d",(br/1000+0.5)}'
}

# ---------- collect files ----------
shopt -s nullglob
files=("$DIR"/*.mp4 "$DIR"/*.MP4)
[ ${#files[@]} -gt 0 ] || { echo "No .mp4 files in $DIR"; exit 1; }
echo "Benchmarking ${#files[@]} clip(s) in: $DIR"
echo "Settings: bpp=$BPP  clamp=[$MIN_KBPS,$MAX_KBPS]k  crop=${CROP_PCT}  iters=$ITER (min reported)"
echo

# ---------- warmup + GPU sanity ----------
echo "Warming up encoders (cold-start absorbed)..."
prep "${files[0]}"
if ! run_encode gpu "${files[0]}" "$TMP/warm.mp4" "$CROP" "$T" "$M" "$B" >/dev/null 2>"$TMP/gpuerr"; then
  echo "ERROR: GPU (h264_nvenc) warmup encode failed:" >&2
  sed 's/^/  /' "$TMP/gpuerr" >&2
  echo "Run scripts/get-ffmpeg-nvenc.sh and point FFMPEG/FFPROBE at that build." >&2
  exit 1
fi
# the output must be a real video, else NVENC silently produced garbage
if ! "$FFPROBE" -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$TMP/warm.mp4" >/dev/null 2>&1; then
  echo "ERROR: GPU warmup produced an invalid file - NVENC isn't actually encoding." >&2
  exit 1
fi
run_encode cpu "${files[0]}" "$TMP/warm.mp4" "$CROP" "$T" "$M" "$B" >/dev/null 2>&1 || true
echo

# ---------- sequential per-file benchmark ----------
printf "%-44s %9s %5s %7s %9s %9s   %s\n" "file" "WxH" "fps" "tgt(k)" "GPU(ms)" "CPU(ms)" "winner"
printf '%.0s-' {1..104}; echo

tot_gpu=0; tot_cpu=0; n=0
for f in "${files[@]}"; do
  prep "$f"
  gbest=""; cbest=""
  for _ in $(seq 1 "$ITER"); do
    g=$(run_encode gpu "$f" "$TMP/g.mp4" "$CROP" "$T" "$M" "$B")
    c=$(run_encode cpu "$f" "$TMP/c.mp4" "$CROP" "$T" "$M" "$B")
    if [ -z "$gbest" ] || [ "$g" -lt "$gbest" ]; then gbest=$g; fi
    if [ -z "$cbest" ] || [ "$c" -lt "$cbest" ]; then cbest=$c; fi
  done
  win=$(awk -v g="$gbest" -v c="$cbest" 'BEGIN{ if(c<g) printf "CPU x%.1f", g/c; else printf "GPU x%.1f", c/g }')
  printf "%-44s %9s %5.0f %7s %9s %9s   %s\n" \
    "$(basename "$f")" "${W}x${H}" "$FPS" "$T" "$gbest" "$cbest" "$win"
  tot_gpu=$(( tot_gpu + gbest )); tot_cpu=$(( tot_cpu + cbest )); n=$(( n + 1 ))
done

# verify the two paths actually land on the same bitrate (last file)
echo
echo "Bitrate match check (last clip): target=${T}k  GPU=$(out_kbps "$TMP/g.mp4")k  CPU=$(out_kbps "$TMP/c.mp4")k"

echo
echo "== sequential totals over $n clip(s) =="
awk -v g="$tot_gpu" -v c="$tot_cpu" 'BEGIN{
  printf "  GPU total: %d ms (avg %.0f ms/clip)\n", g, g/'"$n"';
  printf "  CPU total: %d ms (avg %.0f ms/clip)\n", c, c/'"$n"';
  if(c<g) printf "  => CPU faster overall by %.2fx\n", g/c;
  else    printf "  => GPU faster overall by %.2fx\n", c/g;
}'

# ---------- optional concurrent throughput test ----------
if [ "$RUN_PARALLEL" = "1" ]; then
  echo
  echo "== concurrent throughput (all ${#files[@]} clips at once, wall-clock) =="
  # GPU: launch all NVENC jobs in parallel
  s=$(now_ms)
  i=0
  for f in "${files[@]}"; do
    prep "$f"
    run_encode gpu "$f" "$TMP/par_g_$i.mp4" "$CROP" "$T" "$M" "$B" >/dev/null 2>&1 &
    i=$(( i + 1 ))
  done
  wait
  gpar=$(( $(now_ms) - s ))
  # CPU: launch all x264 jobs in parallel (will contend for cores)
  s=$(now_ms)
  i=0
  for f in "${files[@]}"; do
    prep "$f"
    run_encode cpu "$f" "$TMP/par_c_$i.mp4" "$CROP" "$T" "$M" "$B" >/dev/null 2>&1 &
    i=$(( i + 1 ))
  done
  wait
  cpar=$(( $(now_ms) - s ))
  awk -v g="$gpar" -v c="$cpar" 'BEGIN{
    printf "  GPU wall-clock: %d ms\n  CPU wall-clock: %d ms\n", g, c;
    if(c<g) printf "  => CPU faster (concurrent) by %.2fx\n", g/c;
    else    printf "  => GPU faster (concurrent) by %.2fx\n", c/g;
  }'
  echo "  (CPU concurrent contends for cores; nproc=$(nproc 2>/dev/null || echo '?'). GPU concurrency is limited by NVENC session count on the card/driver.)"
fi
