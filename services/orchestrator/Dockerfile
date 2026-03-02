# Use a Python base image so we can run Vertex AI Reasoning Engine ADK scripts
FROM python:3.11-slim

# Install Node.js (v20)
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install required Python packages for Agent Development Kit (ADK)
RUN pip install --no-cache-dir "google-cloud-aiplatform[agent_engines]" "cloudpickle" "fastapi" "pydantic" "uvicorn"

WORKDIR /app

# Install Node.js dependencies
COPY package.json package-lock.json .env* ./
RUN npm ci

# Copy remainder of app and build
COPY tsconfig* ./
COPY prisma ./prisma
COPY src ./src

# Generate prisma client and build TS code
RUN npx prisma generate
RUN npm run build
RUN cp src/adk_deployer.py dist/

EXPOSE 8080
ENV PORT=8080

CMD ["npm", "start"]
