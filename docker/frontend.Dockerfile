FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
# Vite 8 uses Rolldown's platform-specific native binding. Explicitly include
# optional dependencies so a lockfile generated on Windows also installs the
# Linux binding inside this image.
RUN npm ci --include=optional

COPY frontend/ ./
ARG VITE_SINERGI_BASEMAP_TILES
ARG VITE_SINERGI_VECTOR_TILES_URL
ARG VITE_SINERGI_BASEMAP_ATTRIBUTION
ENV VITE_SINERGI_BASEMAP_TILES=${VITE_SINERGI_BASEMAP_TILES}
ENV VITE_SINERGI_VECTOR_TILES_URL=${VITE_SINERGI_VECTOR_TILES_URL}
ENV VITE_SINERGI_BASEMAP_ATTRIBUTION=${VITE_SINERGI_BASEMAP_ATTRIBUTION}
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=10 \
  CMD wget --quiet --output-document=- http://127.0.0.1:8080/health >/dev/null || exit 1
