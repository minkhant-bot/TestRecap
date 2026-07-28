# Railway deployment

Railway builds this repository from the root `Dockerfile` and starts it with
`npm start`. The server reads Railway's `PORT` automatically and binds to
`0.0.0.0` in production.

Mount a Railway Volume at `/data`. Set `DATA_DIR=/data` so uploads, job caches,
temporary rendering artifacts, MP4 files, MP3 files, and local settings data
remain beneath that volume. Without `DATA_DIR`, local development retains the
existing repository-relative directories.

Recommended Railway Variables:

- `DATA_DIR=/data`
- `QUEUE_CONCURRENCY=1`
- `WHISPER_MODEL=small`
- `WHISPER_DEVICE=cpu`
- `WHISPER_COMPUTE_TYPE=int8`
- `WHISPER_NUM_WORKERS=1`
- `WHISPER_BEAM_SIZE=3`
- `WHISPER_CPU_THREADS` set to the service CPU allocation when an explicit
  value is desired; the application otherwise detects CPUs and caps the
  default at four threads.
- `OMP_NUM_THREADS` optionally set to the same bounded CPU allocation.
- `HF_HOME=/opt/models/huggingface` to use the model cached in the image.
- `GEMINI_API_KEY` only when the key is supplied as a Railway secret rather
  than per request.

The image build downloads the `small` Faster-Whisper model into
`/opt/models/huggingface`. Runtime jobs reuse that cache and do not download
the model per transcription.
