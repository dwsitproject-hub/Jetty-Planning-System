# Jetty Planning System (JPS) - Frontend app image
# Multi-stage: build with Node, serve with nginx.

# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Copy frontend source only (compose context must be Frontend/).
COPY . .

# Vite reads VITE_* at build time. Pass via compose build args.
ARG VITE_API_BASE_URL=http://localhost:3000/api/v1
ARG VITE_USE_LEGACY_VESSEL_PIPELINE=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_USE_LEGACY_VESSEL_PIPELINE=$VITE_USE_LEGACY_VESSEL_PIPELINE

RUN npm run build

# ---- Production stage ----
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
