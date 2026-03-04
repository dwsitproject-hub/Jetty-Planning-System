# Jetty Planning System (JPS) - Frontend mockup
# Multi-stage: build with Node, serve with nginx for environment parity with future production

# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run build

# ---- Production stage ----
FROM nginx:alpine

# Copy built assets and nginx config
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
