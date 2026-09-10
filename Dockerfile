# Skool Roast worker: headless Codex SDK + Playwright Chromium + sharp.
# Base image ships Chromium and its system deps; keep its version in step with package.json's playwright.
FROM mcr.microsoft.com/playwright:v1.62.1-noble
ENV NODE_ENV=production \
    CODEX_HOME=/data/.codex \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# yt-dlp + ffmpeg for the opt-in VSL pass (Loom/Vimeo/Wistia download, 3-minute 480p clip)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN mkdir -p runtime && chmod +x scripts/worker-entry.sh
CMD ["scripts/worker-entry.sh"]
