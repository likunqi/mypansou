# 云盘搜 (Cloud Disk Search)

基于盘搜 (PanSou) API 的网盘资源搜索引擎。聚合豆瓣热榜与本地资源库，支持夸克 / 百度 / 阿里云盘资源的检索、链接可用性检测与夸克一键转存，附完整后台管理系统。

> **前端零构建**：Vue 3 本地运行时 + 原生 HTML，无需 npm 打包即可运行。

## ? 功能特性

### 前台搜索
- **本地优先**：输入关键词进入搜索页，默认先展示本地资源库结果（`/api/search/local`），无结果时提示切换全网搜
- **双 Tab 切换**：`本地资源（N）｜全网搜`，同页切换不跳转，结果缓存短路（同词不重复请求）
- **全网搜**：盘搜 API 聚合夸克 / 百度双源，结果按网盘类型分组
- **手动链接检测**：本地资源检测结果**持久化落库**（只测未检测过的），全网检测为临时结果；卡片带状态徽标（有效 / 失效 / 检查中 / 未检测）
- **资源卡片**：网盘色标、来源 badge、分类、提取码、失效反馈按钮，打开链接支持夸克一键转存
- **搜索历史**：首页与搜索页共享 `localStorage` 历史（10 条去重，可单删 / 清空）

### 豆瓣电影热榜
- 自动抓取豆瓣电影排行榜，封面卡片展示
- 点击卡片一键搜索该电影资源

### 资源入库三管道（本地搜索数据源）
| 管道 | 入口 | 说明 |
|------|------|------|
| ① 人工提交 | `POST /api/submit/resource`（公开） | 进待审核，后台审核通过自动转入资源库 |
| ② 批量导入 | 后台「资源管理 → 批量导入」 | CSV / JSON 解析、URL 去重、预览确认、导入日志 |
| ③ 自动采集 | 后台「采集管理」 | 零依赖引擎 `lib/crawler-engine.js`：rss / page / api 三类源，regex / jsonpath / fixed 字段提取，URL 去重 |

> 已上线真实采集源：shareAliyun Telegram RSS（RSSHub 公共实例），一次采集 20 条阿里云盘影视资源。

### 夸克网盘转存
- 点击打开触发完整转存链路：解析链接 → 获取文件 → 创建目录 → 转存 → 轮询 → 列文件 → 创建新分享 → 返回新 URL + 提取码
- 支持 URL 前缀替换（后台可配置），转存历史可查（最近 50 条）

### 后台管理（Tabler 重写）
- 侧边栏中文 UI，明暗主题切换，本地 Tabler CSS（零外网依赖）
- **仪表盘**：系统状态 + MySQL 接入状态卡（连接 / 地址 / 库名 / 表数量）
- **Cookie 管理**：AES-256-GCM 加密存储，保存前自动校验
- **API 配置**：盘搜源地址 / 分享 URL 前缀
- **资源管理**：资源列表（搜索 / 筛选 / 手动新增 / 删除）、提交审核（通过 / 驳回）、批量导入、采集源与解析规则管理（CRUD + 手动触发）
- **转存历史** / **缓存管理** / **密码修改**

### 每日清理定时任务
- 策略：**保当天，删更早**。每日 03:00 删除夸克 `pansou` 目录里「今天 00:00 之前」转存的文件，历史 / 缓存只留当天
- 调度器读取 `scheduled_tasks` 表，每 60s 检查到期任务，执行记录写入 `task_logs`

## ? 快速开始

### 前置要求
- Node.js >= 18
- 核心功能零外部依赖；接入 NAS MySQL 需执行一次 `npm install mysql2`（已引入 mysql2@3.23.2）

### 启动

```bash
node server/index.js
```

### 访问

| 页面 | 地址 | 说明 |
|------|------|------|
| 首页 | http://localhost:3090 | 豆瓣热榜 + 搜索入口 |
| 搜索页 | http://localhost:3090/search.html | 本地优先 + 全网搜双 Tab |
| 后台管理 | http://localhost:3090/admin.html | 全部管理功能（默认密码 `admin123`） |

> Windows 下可直接双击 `restart.bat`（安全版：只停 3090 端口进程、独立窗口启动）。

### 接入 NAS MySQL（可选，推荐）

项目默认用 `data/` 下 JSON 文件存储；接入 NAS MySQL 后以 MySQL 为主存储，JSON 作为镜像 / 兜底，启动时自动一次性迁移旧数据。

```bash
npm install mysql2          # 首次接入时安装客户端
node scripts/db_setup.js    # 在目标库执行 002_schema_v2.sql，建 16 张表
```

连接配置放 `data/db.config.json`（或环境变量 `PANSOU_MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`）：

```json
{ "host": "192.168.1.65", "port": 3306, "user": "pansou", "password": "***", "database": "pansou" }
```

> ?? `data/db.config.json` 含密码明文，已被 .gitignore 排除，勿提交到公开仓库。

### Docker 部署

```bash
docker compose up -d            # 初次构建并启动
docker compose logs -f          # 查看日志
docker compose down             # 停止
docker compose up -d --build    # 更新代码后重新构建
```

- 数据目录 `data/` 通过 volume 挂载到容器外，删容器不丢数据
- 接入 MySQL：取消 docker-compose.yml 中 mysql 服务与 app 服务 `DB_*` 环境变量的注释，再 `docker compose up -d --build`

## ? 项目结构

```
server/                    # 后端（Node 纯内置模块）
  index.js                 # 入口，端口 3090
  router.js                # 路由分发
  middleware.js            # CORS / JSON / 静态文件 / 日志
  handlers/
    douban.js              # 豆瓣电影热榜
    hot.js                 # 热榜 API（含缓存）
    pansou.js              # 盘搜搜索代理
    check.js               # 链接批量检测（全网临时 + 本地持久化）
    transfer.js            # 夸克转存服务
    admin.js               # 后台管理 API
    resource.js            # 三管道①人工提交 + 本地搜索 + 失效反馈 + 审核
    import.js              # 三管道②批量导入（CSV/JSON 预览/确认/日志）
    crawler.js             # 三管道③采集管理（源/规则 CRUD + 手动触发）
  tasks/
    cleanup.js             # 每日 03:00 转存资源清理
lib/
  store.js                 # 统一存储层（MySQL 优先 + JSON 镜像/兜底 + 一次性迁移）
  mysql.js                 # MySQL 适配器（mysql2 连接池，不可用时自动降级）
  storage.js               # JSON 文件读写 + 数据初始化
  crypto.js                # AES-256-GCM 加密 / scrypt 哈希
  auth.js                  # Session 鉴权
  quark.js                 # 夸克网盘 API 封装
  baidu.js                 # 百度网盘 API 封装（P5 待接入）
  crawler-engine.js        # 爬虫引擎（rss/page/api，零依赖）
  scheduler.js             # 定时任务调度器
public/                    # 前端（Vue 3 本地运行时，无构建）
  index.html               # 首页：豆瓣热榜 + 搜索
  search.html              # 搜索页：本地优先 + 全网搜双 Tab
  admin.html               # 后台管理（Tabler）
  vue.global.prod.js       # Vue 3 运行时（本地加载）
  vendor/tabler/           # Tabler CSS（本地化，零外网依赖）
data/                      # 数据存储（JSON 兜底/镜像）
  config.json              # 盘搜地址 / 加密密钥 / 分享前缀
  admin.json               # 管理员密码哈希
  cookies.enc              # Cookie（AES-256-GCM 加密）
  cache.json               # 转存结果缓存
  transfer_history.json    # 转存历史
  trending.json            # 热榜缓存
  resources.json           # 资源库镜像
  submissions.json         # 提交审核镜像
  crawler.json             # 采集源/规则镜像
  import_logs.json         # 导入日志镜像
  reports.json             # 失效反馈镜像
  db.config.json           # NAS MySQL 连接配置（含密码，勿提交）
scripts/
  db_setup.js              # 建表脚本
  _verify_mysql.js         # MySQL 迁移回归自测
  _verify_pipeline.js      # 资源三管道端到端自测（15 项）
  _dryrun_cleanup.js       # 清理任务只读试运行
  _check_vue_bindings.js   # 前端模板绑定一致性检查
sql/init/
  002_schema_v2.sql        # ★ 建 16 张表（以本文件为准）
docs/
  PROJECT_DOC.md           # 唯一权威技术文档（原多份文档已合并）
```

## ? API 一览

### 公开接口
| 路由 | 方法 | 说明 |
|------|------|------|
| /api/douban/hot | GET | 豆瓣电影排行榜 |
| /api/hot/trending | GET | 热榜（含缓存） |
| /api/pansou/search | GET | 盘搜资源搜索 |
| /api/check/links | POST | 链接批量检测（全网搜临时检测） |
| /api/check/local | POST | 本地资源检测（只测未检测的，结果落库） |
| /api/transfer/save | POST | 夸克转存 |
| /api/transfer/history | GET | 转存历史（最近 50 条） |
| /api/search/local | GET | 本地资源搜索（kw/category/disk_type/page/size） |
| /api/submit/resource | POST | 用户提交资源（进待审核） |
| /api/resources/:id/report | POST | 用户反馈链接失效 |

### 管理接口（需 Bearer token，/api/admin/login 除外）
| 路由 | 方法 | 说明 |
|------|------|------|
| /api/admin/login · /logout | POST | 登录 / 退出 |
| /api/admin/status | GET | 系统状态 |
| /api/admin/config | GET/POST | 配置管理 |
| /api/admin/cookies · /test · /summary | POST/POST/GET | Cookie 管理 |
| /api/admin/cache · /cache/clear | GET/POST | 缓存统计 / 清空 |
| /api/admin/db | GET | MySQL 接入状态 |
| /api/admin/password | POST | 修改密码 |
| /api/admin/resources | GET/POST | 资源列表 / 手动新增 |
| /api/admin/resources/:id | POST/DELETE | 编辑 / 删除资源 |
| /api/admin/submissions | GET | 提交审核列表 |
| /api/admin/submissions/:id/approve · /reject | POST | 审核通过 / 驳回 |
| /api/admin/import/upload · /confirm · /logs | POST/POST/GET | 批量导入 |
| /api/admin/crawler/sources · /rules | GET/POST | 采集源 / 规则管理 |
| /api/admin/crawler/sources/:id/run | POST | 手动触发采集（?dry=1 只解析不写入） |

## ? 安全设计

| 层面 | 措施 |
|------|------|
| Cookie 存储 | AES-256-GCM 加密，随机 IV + auth tag |
| 密码存储 | scrypt (N=16384) + salt 哈希 |
| 会话管理 | 内存 token（进程生命周期，重启后重新登录） |
| 权限控制 | /api/admin/* 需 Bearer token 鉴权（/login 除外） |
| Cookie 传输 | 不向前端传递明文 |

## ? 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3（Composition API，本地运行时无构建）+ Tabler |
| 后端 | Node.js 纯内置模块（http / crypto / fs / https） |
| 数据 | NAS MySQL（mysql2）为主 + `data/` JSON 兜底/镜像 |
| 加密 | AES-256-GCM + scrypt（Node.js 内置） |
| 外部 API | 盘搜（so.252035.xyz）/ 豆瓣 / 夸克（drive-h.quark.cn）/ RSSHub |

## ? 开发状态

| 模块 | 状态 |
|------|------|
| 资源搜索 + 链接检测（手动化 + 本地持久化） | ? 完成 |
| 豆瓣热榜 | ? 完成 |
| 夸克转存 + 转存历史 | ? 完成 |
| 后台管理（Tabler 重写，7 个页面） | ? 完成 |
| MySQL 接入 + 数据全面迁移 | ? 完成 |
| 每日清理定时任务（03:00 保当天） | ? 完成 |
| 资源入库三管道（submit / import / crawl） | ? 完成 |
| 本地搜索（/api/search/local，本地优先） | ? 完成 |
| 搜索历史（首页 + 搜索页共享） | ? 完成 |
| 百度转存（BDUSS） | ? 搁置（P5） |
| 搜索缓存 | ? 搁置（P6） |
| 采集引擎增强（cheerio / 定时采集 / 多页并发） | ? 规划中 |

## ? License

MIT
