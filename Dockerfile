FROM node:20-alpine

# 时区：调度器按本地时间排程（03:00 清理、08:00 豆瓣热词等），必须 Asia/Shanghai
RUN apk add --no-cache tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone
ENV TZ=Asia/Shanghai

WORKDIR /app

# 依赖清单先行（利用 Docker 层缓存）
COPY package.json package-lock.json ./

# 生产依赖：mysql2（远程 MySQL 直连必需）。
# playwright-core 仅 hunhepan 源使用（已在 registry 注销），不下载浏览器二进制。
# 服务器网络慢可先配 npm 镜像：npm config set registry https://registry.npmmirror.com
RUN npm ci --omit=dev || npm install --omit=dev

# 只复制应用需要的目录
# data/ 仅复制兜底 JSON（db.config.json 等敏感文件已由 .dockerignore 排除，运行时靠挂载卷 + 环境变量）
COPY server/    ./server/
COPY lib/       ./lib/
COPY public/    ./public/
COPY docs/      ./docs/
COPY data/      ./data/

EXPOSE 3090

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3090/ || exit 1

CMD ["node", "server/index.js"]
