FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PATH=/opt/venv/bin:$PATH \
    PYTHON_PATH=/opt/venv/bin/python3 \
    HF_HOME=/opt/models/huggingface \
    WHISPER_MODEL=small \
    WHISPER_DEVICE=cpu \
    WHISPER_COMPUTE_TYPE=int8 \
    WHISPER_NUM_WORKERS=1 \
    WHISPER_BEAM_SIZE=3 \
    DATA_DIR=/data \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg ca-certificates fonts-unifont fonts-sil-padauk fontconfig gosu \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && pip install --upgrade pip==25.1.1 \
    && pip install -r requirements.txt

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

RUN mkdir -p "$HF_HOME" /data/uploads /data/cache /data/output \
    && python3 src/ai/download_model.py \
    && npm run build \
    && npm prune --omit=dev \
    && chown -R node:node /app /data /opt/models \
    && chmod 0755 /app/scripts/docker-entrypoint.sh

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const p=process.env.PORT||3000;fetch('http://127.0.0.1:'+p+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
