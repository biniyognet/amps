# AMPS frontend for Cloud Run: same Vite build as deploy/docker/frontend.Dockerfile,
# nginx config from a template (listens on $PORT, proxies the API to $BACKEND_URL).
# Build from the repository root:
#   docker build -f deploy/gcp/frontend.cloudrun.Dockerfile -t <registry>/amps-frontend:<tag> .
FROM node:20-alpine AS build
ARG AMPS_DATA=live
ARG AMPS_ORG=
ARG AMPS_BRAND=neutral
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN VITE_AMPS_DATA=$AMPS_DATA VITE_AMPS_ORG="$AMPS_ORG" VITE_AMPS_BRAND=$AMPS_BRAND npx vite build

FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/gcp/nginx.cloudrun.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /ui/dist /usr/share/nginx/html
ENV PORT=8080
EXPOSE 8080
