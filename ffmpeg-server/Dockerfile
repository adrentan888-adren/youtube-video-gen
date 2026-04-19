FROM node:20-slim

# Install FFmpeg + font tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Install Montserrat ExtraBold from Google Fonts GitHub
RUN mkdir -p /usr/share/fonts/truetype/montserrat \
    && curl -fL \
       "https://github.com/google/fonts/raw/main/ofl/montserrat/static/Montserrat-ExtraBold.ttf" \
       -o /usr/share/fonts/truetype/montserrat/Montserrat-ExtraBold.ttf \
    && fc-cache -fv

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js .

ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.js"]
