ARG BASE_REGISTRY=registry.cn-hangzhou.aliyuncs.com
FROM ${BASE_REGISTRY}/library/golang:1.24-bookworm AS builder
WORKDIR /app
ARG TARGETOS=linux
ARG TARGETARCH=amd64
ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}
ENV TZ=Asia/Shanghai
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /bin/api ./cmd/api

FROM ${BASE_REGISTRY}/library/debian:bookworm-slim AS runner
WORKDIR /app
ARG APT_MIRROR=https://mirrors.aliyun.com/debian
ARG APT_SECURITY_MIRROR=https://mirrors.aliyun.com/debian-security
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ARG PIP_TRUSTED_HOST=mirrors.aliyun.com
RUN sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}|g; s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && sed -i "s|https://deb.debian.org/debian|${APT_MIRROR}|g; s|https://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" /etc/apt/sources.list.d/debian.sources
RUN apt-get update \
    && apt-get install -y --no-install-recommends mupdf-tools python3 python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --no-cache-dir --break-system-packages --index-url "${PIP_INDEX_URL}" --trusted-host "${PIP_TRUSTED_HOST}" PyMuPDF==1.24.14
RUN groupadd -r app && useradd -r -g app app
COPY --from=builder /bin/api /app/api
COPY --from=builder /app/scripts /app/scripts
ENV PORT=8080
ENV TZ=Asia/Shanghai
EXPOSE 8080
USER app
ENTRYPOINT ["/app/api"]
