# Jetty Live — RTSP → MPEG1 WebSocket (FFmpeg + Node).
# Used by docker-compose.app.yml as jps-jetty-live (internal HTTP 3081, WS 9999).

FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY lib ./lib
COPY server.js ./
COPY public ./public

ENV HTTP_PORT=3081
ENV WS_PORT=9999
ENV STREAM_OUTPUT_FPS=1
ENV STREAM_MPEG1_RATE=25
ENV STREAM_SCALE=640:-1
ENV STREAM_IDLE_STOP_MS=30000

EXPOSE 3081 9999

CMD ["node", "server.js"]
