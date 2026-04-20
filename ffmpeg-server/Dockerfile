FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

# Install faster-whisper and edge-tts
RUN pip3 install --break-system-packages faster-whisper edge-tts

# Pre-download tiny model at build time to avoid cold-start delay
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8')"

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js .
COPY transcribe.py .
COPY tts.py .

ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.js"]
