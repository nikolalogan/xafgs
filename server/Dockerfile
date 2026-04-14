FROM golang:1.24-bookworm AS builder
WORKDIR /app
ARG TARGETOS=linux
ARG TARGETARCH=amd64
ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}
ENV TZ=Asia/Shanghai
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /bin/api ./cmd/api

FROM debian:bookworm-slim AS runner
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends mupdf-tools python3 python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --no-cache-dir --break-system-packages PyMuPDF==1.24.14
RUN groupadd -r app && useradd -r -g app app
COPY --from=builder /bin/api /app/api
COPY --from=builder /app/scripts /app/scripts
ENV PORT=8080
ENV TZ=Asia/Shanghai
EXPOSE 8080
USER app
ENTRYPOINT ["/app/api"]
