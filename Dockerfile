# Production build - compile TypeScript, run JavaScript
FROM node:20-slim

# Install system dependencies for Prisma and OpenSSL
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install typescript globally for compilation
RUN npm install -g typescript

WORKDIR /app

# 1. Copy Orchestrator dependencies
COPY services/orchestrator/package*.json ./

# 2. Install dependencies
RUN npm install

# 3. Copy Prisma Schema and Config
COPY prisma ./prisma
COPY prisma.config.ts ./

# 4. Generate Prisma Client (dummy URL - generate only needs schema, not a real DB)
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# 5. Copy Orchestrator Source Code and prod tsconfig
COPY services/orchestrator/tsconfig.prod.json ./tsconfig.json
COPY services/orchestrator/src ./src

# 6. Compile TypeScript to JavaScript
RUN tsc -p tsconfig.json

# 7. Copy Client (Static Files) and build frontend
COPY client ./client
RUN cd client && npm install && npm run build

# Move build artifacts to public folder served by Fastify
RUN mkdir -p public && cp -r client/dist/* public/ && rm -rf client

# 8. Add Entrypoint script
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]

ENV NODE_ENV=production

# 9. Start the compiled Orchestrator
CMD ["node", "dist/index.js"]
