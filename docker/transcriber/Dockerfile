FROM python:3.12-slim-bookworm AS cpu
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models XDG_CACHE_HOME=/models
WORKDIR /service
RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --create-home transcriber \
  && mkdir -p /models && chown -R transcriber:transcriber /models /service
COPY docker/transcriber/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt
COPY --chown=transcriber:transcriber docker/transcriber/app.py ./app.py
USER transcriber
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD curl -fsS -H "x-internal-token: $TRANSCRIBER_API_KEY" http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]

FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04 AS gpu
ENV DEBIAN_FRONTEND=noninteractive PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
  HF_HOME=/models XDG_CACHE_HOME=/models PATH=/opt/venv/bin:$PATH
WORKDIR /service
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 python3-venv curl ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/venv \
  && useradd --system --uid 10001 --create-home transcriber \
  && mkdir -p /models && chown -R transcriber:transcriber /models /service
COPY docker/transcriber/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt
COPY --chown=transcriber:transcriber docker/transcriber/app.py ./app.py
USER transcriber
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD curl -fsS -H "x-internal-token: $TRANSCRIBER_API_KEY" http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
