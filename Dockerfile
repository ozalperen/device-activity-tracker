# Backend Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (ignore postinstall script since client is built separately)
RUN npm ci --ignore-scripts

# Install dev dependencies needed for TypeScript
RUN npm install typescript tsx --save-dev

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npx tsc --skipLibCheck || true

# Create auth directory for WhatsApp session persistence
RUN mkdir -p /app/auth_info_baileys

EXPOSE 3001

# Run with tsx for TypeScript support
CMD ["npx", "tsx", "src/server.ts"]

