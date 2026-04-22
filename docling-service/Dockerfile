ARG BASE_REGISTRY=registry.cn-hangzhou.aliyuncs.com
FROM ${BASE_REGISTRY}/library/python:3.11-slim

WORKDIR /app

ARG APT_MIRROR=https://mirrors.aliyun.com/debian
ARG APT_SECURITY_MIRROR=https://mirrors.aliyun.com/debian-security
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
ARG PIP_DEFAULT_TIMEOUT=600
ARG PIP_RETRIES=10
ARG DOCLING_WHEELS_ONLY=0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8091 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    DOCLING_ARTIFACTS_PATH=/opt/docling-models \
    DOCLING_SERVE_ARTIFACTS_PATH=/opt/docling-models/serve_artifacts \
    HF_HOME=/opt/docling-models/hf \
    HF_HUB_CACHE=/opt/docling-models/hf/hub \
    PIP_DEFAULT_TIMEOUT=${PIP_DEFAULT_TIMEOUT}

RUN sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && sed -i "s|https://deb.debian.org/debian|${APT_MIRROR}|g; s|https://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
        libsm6 \
        libxext6 \
        libxrender1 \
        libmagic1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/
COPY wheels /opt/wheels
RUN --mount=type=cache,target=/root/.cache/pip \
    if [ "${DOCLING_WHEELS_ONLY}" = "1" ]; then \
      pip install --no-cache-dir --no-index --find-links /opt/wheels -r /app/requirements.txt; \
    else \
      pip install --no-cache-dir --find-links /opt/wheels --index-url "${PIP_INDEX_URL}" --trusted-host "${PIP_TRUSTED_HOST}" --retries "${PIP_RETRIES}" --progress-bar off -r /app/requirements.txt; \
    fi

COPY app /app/app
COPY scripts /app/scripts

EXPOSE 8091

CMD ["uvicorn", "app.service:app", "--host", "0.0.0.0", "--port", "8091"]
