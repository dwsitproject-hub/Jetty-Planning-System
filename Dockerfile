# Jetty Planning System (JPS) - Frontend mockup
# Multi-stage: build with Node, serve with nginx for environment parity with future production

# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

# Vite reads VITE_* at build time. Pass via compose build.args (root .env is dockerignored).
ARG VITE_API_BASE_URL=http://localhost:3000/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ---- Production stage ----
FROM nginx:alpine

# Copy built assets and nginx config
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
