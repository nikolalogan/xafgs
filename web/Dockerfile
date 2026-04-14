ARG BASE_REGISTRY=docker.m.daocloud.io
FROM ${BASE_REGISTRY}/library/node:22-alpine AS builder
WORKDIR /app
ENV TZ=Asia/Shanghai
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry ${NPM_REGISTRY}
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM ${BASE_REGISTRY}/library/node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
