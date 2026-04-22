ARG BASE_REGISTRY=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io
FROM ${BASE_REGISTRY}/library/python:3.11-slim

WORKDIR /app

ARG APT_MIRROR=https://mirrors.aliyun.com/debian
ARG APT_SECURITY_MIRROR=https://mirrors.aliyun.com/debian-security
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
ARG PIP_DEFAULT_TIMEOUT=600
ARG PIP_RETRIES=10

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8090 \
    GLM_BASE_URL=http://vllm:8000 \
    GLM_MODEL=glm-4.1v-thinking-flash \
    GLM_AUTH_MODE=none \
    GLM_TIMEOUT_MS=120000 \
    PIP_DEFAULT_TIMEOUT=${PIP_DEFAULT_TIMEOUT}

RUN sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && sed -i "s|https://deb.debian.org/debian|${APT_MIRROR}|g; s|https://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgomp1 \
        libstdc++6 \
        libgl1 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --index-url "${PIP_INDEX_URL}" --trusted-host "${PIP_TRUSTED_HOST}" --retries "${PIP_RETRIES}" --progress-bar off -r /app/requirements.txt

COPY app /app/app

EXPOSE 8090

CMD ["uvicorn", "app.service:app", "--host", "0.0.0.0", "--port", "8090"]
