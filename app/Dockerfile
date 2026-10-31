FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git tar ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY client ./client
COPY src ./src
RUN npm ci --omit=dev
COPY db ./db
COPY public ./public
COPY eval ./eval
COPY prompts ./prompts
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
