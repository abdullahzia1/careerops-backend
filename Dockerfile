# Stage 1: Build 
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:20-slim AS runtime

# System dependencies required by Playwright's Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Tectonic LaTeX engine — single static binary, fetches packages on demand.
# Used by /api/v1/latex/compile (LatexService prefers tectonic over pdflatex).
ARG TECTONIC_VERSION=0.15.0
RUN curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      | tar -xz -C /usr/local/bin tectonic \
    && chmod +x /usr/local/bin/tectonic \
    && tectonic --version

WORKDIR /app

# Copy built output and production node_modules from builder
COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy runtime assets the app reads from disk
COPY --from=builder /app/modes       ./modes
COPY --from=builder /app/config      ./config
COPY --from=builder /app/templates   ./templates
COPY --from=builder /app/fonts       ./fonts

# Install Playwright's Chromium browser into the image
RUN npx playwright install chromium

ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/main"]
