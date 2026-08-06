# Docker 部署指南（远程服务器 + 远程 NAS MySQL）

> 适用场景：**Docker 装在独立服务器上**（与 NAS 同一内网），**MySQL 不用 Docker**，容器直接远程直连 NAS 的 `192.168.1.65:3306/pansou`。
> 本地开发机不需要装 Docker，只改代码推 GitHub，服务器拉取构建。

## 一、架构

```
┌─────────────────────┐        ┌──────────────────────┐
│  Docker 服务器       │        │  NAS 192.168.1.65    │
│  ┌───────────────┐  │  3306  │  ┌────────────────┐  │
│  │ yunpansou 容器 │──┼────────┼─▶│ MySQL (pansou) │  │
│  │ node 20 alpine │  │ 内网直连 │  └────────────────┘  │
│  │ 端口 3090      │  │        └──────────────────────┘
│  └───────────────┘  │
│  data/ 挂载卷(JSON兜底)│
└─────────────────────┘
```

- 容器只跑应用；MySQL 在 NAS，容器内通过 `PANSOU_MYSQL_*` 环境变量直连
- `data/` 目录挂载到宿主机，存 JSON 兜底/镜像数据（MySQL 为主，JSON 为辅）
- 定时任务按 **Asia/Shanghai 时区**运行（Dockerfile 已配 `TZ`，不配的话 03:00 清理会在 UTC 时间跑）

## 二、前置条件

| 项 | 要求 |
|----|------|
| Docker 服务器 | 装了 Docker + Docker Compose（`docker compose version` 有输出） |
| 网络 | Docker 服务器与 NAS（192.168.1.65）内网互通，3306 端口可达 |
| NAS MySQL | 库 `pansou`、用户 `pansou` 已存在（本地项目已在用，直接复用） |
| 代码 | GitHub 仓库 likunqi/mypansou（main 分支） |

## 三、部署步骤（在 Docker 服务器上执行）

### 1. 拉代码

```bash
git clone https://github.com/likunqi/mypansou.git /opt/yunpansou
cd /opt/yunpansou
```

### 2. 配置 .env（MySQL 连接信息）

```bash
cp .env.example .env
vi .env        # 改 PANSOU_MYSQL_PASSWORD 为真实密码（如与 example 相同可不动）
```

> `.env` 已在 .gitignore / .dockerignore 中排除，不会进镜像、不会提交。

### 3. 构建并启动

```bash
# 首次构建（npm 装 mysql2，网络慢可先配 npm 镜像）
docker compose up -d --build
```

### 4. 验证

```bash
# 容器健康状态（HEALTHCHECK 每 30s 探活，start-period 10s）
docker compose ps
# 期望：STATUS = Up ... (healthy)

# 看日志（MySQL 连接成功会打印迁移信息，连不上会提示降级 JSON）
docker compose logs -f app

# 验证四页面
curl -s -o /dev/null -w "%{http_code}" http://localhost:3090/           # 首页 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3090/search.html # 搜索页 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3090/admin.html  # 后台 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3090/bigscreen.html

# 验证 MySQL 直连（应返回资源统计 JSON，而不是降级空数据）
curl -s http://localhost:3090/api/admin/status   # 需带 token，或看日志中 "[mysql] 已连接"
```

日志中看到以下任一即为成功：
- `[mysql] JSON->MySQL 迁移完成:` —— 首次且 NAS 库无标记时
- 无 mysql 报错、`scheduler.start()` 正常 —— MySQL 已连接
- 若打印 `[mysql] 未连接（使用 JSON 存储兜底）: ...` —— 说明连不上 NAS，检查 .env 与内网互通

## 四、日常运维

| 操作 | 命令 |
|------|------|
| 查看日志 | `docker compose logs -f app` |
| 重启 | `docker compose restart` |
| 停止 | `docker compose down`（保留数据卷） |
| 更新代码 | 本地改完推 GitHub → 服务器 `git pull` → `docker compose up -d --build` |
| 彻底删除（含数据卷） | `docker compose down -v`（慎用，data/ 是 bind mount 不受影响，但 MySQL 数据在 NAS 不受影响） |
| 进入容器 | `docker exec -it yunpansou sh` |

数据说明：
- **MySQL 数据**在 NAS 上，删容器、删服务器都不影响
- **JSON 兜底数据**在服务器 `/opt/yunpansou/data/`（bind mount），删容器不丢
- 定时任务（cleanup 03:00 / douban_hotwords 08:00 / trending 30min / optimize 10min / check 03:30 / crawl_source）全部由容器内调度器驱动，重启容器后自动恢复（调度器自带 MySQL 重试）

## 五、常见问题

| 现象 | 原因 / 处理 |
|------|------------|
| 启动日志 `[mysql] 未连接` | .env 密码错 / NAS 3306 不通。`docker compose exec app sh` 里 `nc -zv 192.168.1.65 3306` 验证 |
| 构建时 npm 慢/失败 | `docker compose build --build-arg` 或先 `npm config set registry https://registry.npmmirror.com` 再 build |
| 定时任务时间不对 | 检查容器内时区：`docker exec yunpansou date` 应为北京时间（Dockerfile 已配，若旧镜像需重建） |
| hunhepan（混合盘）源不可用 | 正常现象，该源已在 registry 注销（2026-08-04），容器内无需 chromium |
| 3090 端口冲突 | 改 docker-compose.yml 的 `"3090:3090"` 为 `"其他端口:3090"` |

## 六、本次 Docker 相关文件改动（2026-08-06）

| 文件 | 改动 |
|------|------|
| Dockerfile | 增加 tzdata + `TZ=Asia/Shanghai`；增加 `npm ci --omit=dev` 装 mysql2（原注释"无外部依赖"已过时）；去掉误 COPY 敏感文件的风险 |
| docker-compose.yml | 删掉 MySQL 容器段；补 `PANSOU_MYSQL_*` 环境变量（修正原 `DB_*` 错误变量名）；加 `TZ`；密码走 .env |
| .dockerignore | 排除 `data/db.config.json`（含 NAS 密码）与 `.env`，防打进镜像 |
| .env.example | 新增，MySQL 连接模板 |
| .gitignore | 追加 `.env` |
