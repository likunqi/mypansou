FROM node:20-alpine

WORKDIR /app

# 只复制应用需要的目录
COPY server/    ./server/
COPY lib/       ./lib/
COPY public/    ./public/
COPY docs/      ./docs/
COPY data/      ./data/

# 无外部依赖，无需 npm install

EXPOSE 3090

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3090/ || exit 1

CMD ["node", "server/index.js"]
