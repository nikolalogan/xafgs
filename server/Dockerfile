FROM golang:1.24-alpine AS builder
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

FROM alpine:3.22 AS runner
WORKDIR /app
RUN apk add --no-cache mupdf-tools
RUN addgroup -S app && adduser -S -G app app
COPY --from=builder /bin/api /app/api
ENV PORT=8080
ENV TZ=Asia/Shanghai
EXPOSE 8080
USER app
ENTRYPOINT ["/app/api"]
