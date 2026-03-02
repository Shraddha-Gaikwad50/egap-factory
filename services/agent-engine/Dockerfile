FROM node:20-slim

# Prisma requires OpenSSL
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies FIRST 
COPY package*.json ./
RUN npm install

# Prisma Schema & Generated Client
# Since it's a microservice, it shares the Database Schema
COPY prisma ./prisma
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# App Code
COPY tsconfig.json ./
COPY src ./src

# Compile typescript
RUN npx tsc -p tsconfig.json

ENV NODE_ENV=production

# The agent engine expects AGENT_ID to be passed down dynamically
# e.g., docker run -e AGENT_ID="..." agent-engine
CMD ["node", "dist/index.js"]
