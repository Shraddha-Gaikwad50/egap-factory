# Single-stage build - run source directly with ts-node
FROM node:20-slim

# Install system dependencies for Prisma and OpenSSL
RUN apt-get update -y && apt-get install -y openssl ca-certificates python3 build-essential && rm -rf /var/lib/apt/lists/*

# Install ts-node and typescript globally
RUN npm install -g ts-node typescript

WORKDIR /app

# 1. Copy Orchestrator dependencies (This handles "type": "module" and dependencies)
COPY services/orchestrator/package*.json ./

# 2. Install dependencies
RUN npm install

# 3. Copy Prisma Schema and Config
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY services/orchestrator/tsconfig.json ./

# 4. Generate Prisma Client (dummy URL - generate only needs schema, not a real DB)
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# 5. Copy Orchestrator Source Code
COPY services/orchestrator/src ./src

# 6. Copy Client (Static Files) - If needed by Orchestrator
COPY client ./client
# Build frontend if Orchestrator serves it (it does via @fastify/static?)
# Checking src/index.ts: imports @fastify/static but serving logic might be missing/different in Orchestrator vs Root
# Root src/index.ts served client/dist. Orchestrator src/index.ts (Fastify) likely does too or should.
# For now, let's include client build just in case.
RUN cd client && npm install && npm run build

# 7. Add Entrypoint script
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]

ENV NODE_ENV=production

# 8. Start the Orchestrator (Fastify) using ESM loader
CMD ["node", "--loader", "ts-node/esm", "src/index.ts"]
