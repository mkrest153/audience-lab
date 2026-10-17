# Audience Lab — one service: the FastAPI core serves the built web app (Render).
# 1) web app
FROM node:20-slim AS web
WORKDIR /w
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web ./
RUN npm run build

# 2) core service + the built web app
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY services/core/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt
COPY services/core/app ./app
COPY --from=web /w/dist ./webdist
# DATA_DIR is the persistent disk on Render (render.yaml mounts it at /var/data)
ENV WEB_DIST=/app/webdist \
    DATA_DIR=/var/data
RUN mkdir -p /var/data
EXPOSE 8000
# one process: the stores and the job runner live in memory next to SQLite
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
