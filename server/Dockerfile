FROM docker.1panel.live/library/golang:1.24-alpine AS builder
WORKDIR /app
ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /bin/api ./cmd/api

FROM docker.1panel.live/gcr.io/distroless/static-debian12:nonroot AS runner
WORKDIR /app
COPY --from=builder /bin/api /app/api
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/app/api"]
