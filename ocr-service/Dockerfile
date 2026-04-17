ARG BASE_REGISTRY=docker.m.daocloud.io
FROM ${BASE_REGISTRY}/library/python:3.11-slim
ARG OCR_PPSTRUCTURE_PRELOAD=0
ARG OCR_WHEELS_ONLY=0

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
    PADDLEX_HOME=/root/.paddlex \
    OCR_PDX_PIPELINE=PP-StructureV3 \
    OCR_PPSTRUCTURE_DEVICE=cpu \
    OCR_PPSTRUCTURE_LANG=ch \
    OCR_PPSTRUCTURE_ENABLE_TABLES=0 \
    OCR_PPSTRUCTURE_USE_REGION_DETECTION=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    FLAGS_use_mkldnn=0 \
    FLAGS_enable_pir_api=0 \
    FLAGS_enable_pir_in_executor=0 \
    CPU_NUM=1 \
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

COPY requirements.txt constraints.txt /app/
COPY wheels /wheels
RUN --mount=type=cache,target=/root/.cache/pip if [ "${OCR_WHEELS_ONLY}" = "1" ]; then \
      test -n "$(find /wheels -maxdepth 1 -type f -name 'paddlepaddle-3.2.0*.whl' -print -quit)" || (echo "missing wheel: paddlepaddle-3.2.0*.whl" && exit 1); \
      test -n "$(find /wheels -maxdepth 1 -type f -name 'paddleocr-3.4.0*.whl' -print -quit)" || (echo "missing wheel: paddleocr-3.4.0*.whl" && exit 1); \
      test -n "$(find /wheels -maxdepth 1 -type f -name 'paddlex-3.4*.whl' -print -quit)" || (echo "missing wheel: paddlex-3.4*.whl" && exit 1); \
      test -n "$(find /wheels -maxdepth 1 -type f -name 'opencv_contrib_python-4.10.0.84*.whl' -print -quit)" || (echo "missing wheel: opencv_contrib_python-4.10.0.84*.whl" && exit 1); \
      test -n "$(find /wheels -maxdepth 1 -type f -name 'protobuf-4.25.8*.whl' -print -quit)" || (echo "missing wheel: protobuf-4.25.8*.whl" && exit 1); \
      pip install --no-cache-dir --no-index --find-links /wheels --progress-bar off -r /app/requirements.txt -c /app/constraints.txt; \
    else \
      if pip install --no-cache-dir --no-index --find-links /wheels --progress-bar off -r /app/requirements.txt -c /app/constraints.txt; then \
        echo "install from local wheels only"; \
      else \
        echo "local wheels incomplete, fallback to remote index"; \
        pip install --no-cache-dir --prefer-binary --find-links /wheels --index-url "${PIP_INDEX_URL}" --trusted-host "${PIP_TRUSTED_HOST}" --retries "${PIP_RETRIES}" --progress-bar off -r /app/requirements.txt -c /app/constraints.txt; \
      fi; \
    fi
RUN mkdir -p /root/.paddlex

COPY app /app/app
COPY scripts /app/scripts
RUN sed -i 's/\r$//' /app/scripts/*.sh \
    && chmod +x /app/scripts/start_official_serving.sh

RUN --mount=type=cache,target=/root/.paddlex if [ "$OCR_PPSTRUCTURE_PRELOAD" = "1" ]; then python -m app.preload_models; fi

EXPOSE 8090

CMD ["/app/scripts/start_official_serving.sh"]
