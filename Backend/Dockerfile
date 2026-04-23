# Jetty Planning System - Backend API (development)
# Used with docker-compose; source is mounted for live reload.
FROM node:20-alpine

WORKDIR /app

# Install dependencies (copied first for better layer caching)
COPY package.json ./
RUN npm install

# Copy source only (avoids overwriting package-lock.json from npm install)
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations

EXPOSE 3000

# Development: live reload via node --watch
CMD ["npm", "run", "dev"]
