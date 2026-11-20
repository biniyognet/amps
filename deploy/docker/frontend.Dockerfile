# AMPS frontend — Vite build served by nginx
# Build from the repository root:
#   docker build -f deploy/docker/frontend.Dockerfile -t <registry>/amps-frontend:<tag> .
FROM node:20-alpine AS build

# demo (default) = full synthetic walkthrough · live = screens read the backend,
# unfinished modules leave the nav. AMPS_ORG names the org on tags/printouts.
# AMPS_BRAND=neutral keeps operator branding out of a live build (public demo).
ARG AMPS_DATA=demo
ARG AMPS_ORG=
ARG AMPS_BRAND=
# operator details, set only in the office's untracked env (compose.local.yaml)
ARG AMPS_ORDER_REF=
ARG AMPS_ORDER_EXTRACT=
ARG AMPS_ORG_ALIASES=

WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN VITE_AMPS_DATA=$AMPS_DATA VITE_AMPS_ORG="$AMPS_ORG" VITE_AMPS_BRAND=$AMPS_BRAND \
    VITE_AMPS_ORDER_REF="$AMPS_ORDER_REF" VITE_AMPS_ORDER_EXTRACT="$AMPS_ORDER_EXTRACT" \
    VITE_AMPS_ORG_ALIASES="$AMPS_ORG_ALIASES" npx vite build

FROM nginx:1.27-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /ui/dist /usr/share/nginx/html
EXPOSE 80
