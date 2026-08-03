# 云盘搜 (Cloud Disk Search) — 项目总文档（合并版）

> 合并日期：2026-08-03
> 本文档由项目内 12 份分散文档（见 §0.2）合并而成，作为**唯一权威参考**。合并后分散文档可删除，保留本文件即可。
> 项目根目录：`C:\Users\Administrator\Documents\云盘\`（即工作区本身；历史文档中提到的 `cloud-disk-search/` 子目录为空、已弃用）。

---

## 0. 文档说明

### 0.1 合并目的

原来 `docs/` 下散落多份文档，内容交叉重复、部分彼此冲突（例如百度转存在 README 结构里被写成"已实现"，但在优化计划里仍是"待实现"）。本文档将它们统一、去重、并校正不一致之处，作为后续持续开发的唯一入口。

### 0.2 合并来源

| 原文件 | 主题 | 现状 |
|--------|------|------|
| README.md（根目录） | 项目总览 / 快速开始 / 功能 / API / 技术栈 | 保留为入口，本文档与之互补 |
| docs/PROJECT_LOGIC.md | 核心业务流程（双搜索、入库三管道、采集、转存、失效检测） | 已并入 §3 |
| docs/DESIGN_ARCHITECTURE.md | 系统架构图、模块职责、新增文件 | 已并入 §2 |
| docs/DATABASE_DESIGN.md | 数据库表设计（DDL） | 已并入 §5 |
| docs/OPTIMIZATION_PLAN.md | P0–P6 优化计划、Cookie 存储细节、Session 处理 | 已并入 §10 |
| docs/KNOWLEDGE_GRAPH.md | 文件结构、路由图、夸克流程、前端状态机、安全模型、已知问题 | 已并入 §2/§4/§6/§8/§9/§12 |
| docs/MODIFICATION_RECORD.md | P0–P4 修改明细 | 已并入 §11 |
| docs/quark_api.md | 夸克网盘 API 逆向文档 | 已并入 §6 |
| docs/baidu_api.md | 百度转存可行性分析（BDUSS 方案） | 已并入 §7 |
| docs/baidu_api_2.md | 百度网盘开放平台官方 API 文档 | 已并入 §7 |
| docs/TODO_LIST.md | 设计阶段遗留问题 | 已并入 §14 |
| docs/CHATLOG.md | 开发日志与技术决策 | 已并入 §13 |
| docs/CRAWLER_REFERENCE.md | 爬虫技术选型参考 | **已损坏（二进制编码，无法读取）**，内容待重新整理，见 §15 |

### 0.3 文档间不一致（已在本总文档中校正）

1. **百度转存是否实现**：README 的"项目结构"列出了 `lib/baidu.js`，但优化计划 P5 与知识图谱均标明其为"待实现"。以代码为准——**百度转存尚未实现**，本文档统一标记为"规划中（P5）"，`lib/baidu.js` 尚未创建。
2. **数据存储方案**：早期做过 Supabase/PostgreSQL 尝试（已彻底移除），当前实际运行在 JSON 文件（`data/`）。MySQL 为**可选**部署（Docker 挂载 `sql/init/002_schema_v2.sql`），并非当前默认路径。见 §5.7 与 §9。
3. **资源表来源类型**：早期文档列出 `submitted/imported/collected/manual` 四种；后新增 `transferred`（一键转存）。本文档以 5 种来源为准。
4. **SQL schema 文件缺陷**：`sql/init/002_schema_v2.sql` 中中文注释为乱码（mojibake），且第 274 行存在一条**不完整的 `INSERT IGNORE INTO site_config ... VALUES` 语句（VALUES 后无内容）**，直接执行会报错。见 §12.11。

---

## 1. 项目概览

**云盘搜** 是基于盘搜（PanSou）API 的网盘资源搜索引擎。聚合豆瓣电影热榜，支持夸克 / 百度网盘资源的检索与链接可用性检测，并提供夸克网盘一键转存（百度规划中）。

### 1.1 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3（Composition API，本地 CDN 文件 `vue.global.prod.js`，in-DOM 模板） |
| 后端 | Node.js 纯内置模块（`http` / `crypto` / `fs` / `https`），**零外部 npm 依赖** |
| 数据（当前） | JSON 文件系统（`data/`） |
| 数据（可选） | MySQL 8.0（Docker 挂载，utf8mb4 / InnoDB） |
| 加密 | AES-256-GCM + scrypt（Node.js `crypto` 内置） |
| 会话 | 内存 `Map`（32 字节随机 token，进程生命周期） |
| 外部 API | 盘搜 `so.252035.xyz` / 豆瓣 `movie.douban.com` / 夸克 `drive-h.quark.cn` / 百度 `pan.baidu.com` |

### 1.2 快速开始

**前置要求**：Node.js ≥ 18；无需 `npm install`。

**启动（纯 Node）：**
```
node server/index.js
```
访问：前台 `http://localhost:3090`，后台 `http://localhost:3090/admin.html`。
后台默认密码：**admin123**（存于 `data/admin.json`，可改）。

**Docker 部署：**
```
docker compose up -d          # 构建并启动
docker compose logs -f        # 查看日志
docker compose down           # 停止
docker compose up -d --build  # 更新代码后重建
```
数据目录 `data/` 通过 volume 挂载到容器外，删除容器不丢数据。
接入 MySQL（可选）：取消 `docker-compose.yml` 中 `mysql` 服务与 `app` 服务 `DB_*` 环境变量注释，再 `docker compose up -d --build`；`sql/init/001_schema.sql` 与 `002_schema_v2.sql` 首次启动自动执行。

### 1.3 开发状态总览

| 模块 | 状态 |
|------|------|
| 资源搜索（全网盘搜）+ 链接检测 | ✅ 完成 |
| 豆瓣电影热榜 | ✅ 完成 |
| 后台管理 + Cookie 加密 | ✅ 完成（P1） |
| 夸克转存 + 转存历史 + 分享前缀 | ✅ 完成（P3/P4） |
| 结构重组（模块化） | ✅ 完成（P0） |
| 日志 + 错误处理 | ✅ 完成（P2） |
| 本地搜索（resources 表） | ✅ 完成（/api/search/local，见 §3.1 / §5） |
| 资源入库（提交/导入/采集） | ✅ 完成（三管道落地，见 §3.2-3.5） |
| 百度转存（BDUSS） | ⏳ 规划中（P5） |
| 搜索缓存 | ⏳ 规划中（P6） |
| 多用户系统 | 规划中 |

---

## 2. 系统架构

### 2.1 架构图

```
+---------------------------- 用户浏览器 (Vue 3 SPA) ----------------------------+
| 前台 search.html/index.html: [本地查询] [全网搜] [一键转存] [提交资源]         |
| 后台 admin.html: 资源管理 / 导入 / 采集源 / 热词 / 配置 / 脚本 / Cookie        |
+------------------------------- HTTP (localhost:3090) --------------------------+
                                 |
                                 v
+------------------------------ Node.js 后端 -----------------------------------+
| server/index.js     入口 + 定时任务调度器                                     |
| server/router.js    路由分发 + 中间件链                                       |
| server/middleware.js CORS / JSON / 静态文件 / 日志 / SEO 注入                 |
|                                                                                |
| handlers/ : douban.js / pansou.js / check.js / transfer.js                     |
|            resource.js / import.js / crawler.js / admin.js                      |
|                                                                                |
| lib/ : mysql.js / store.js / storage.js / crawler-engine.js / scheduler.js     |
|        crypto.js / auth.js / quark.js / baidu.js(规划)                         |
+----------------------------------|---------------------------------------------+
                                   |
                  +----------------v------------------+      +------------------+
                  |  当前默认: data/*.json 文件持久化   |      | MySQL 8.0 (可选) |
                  |  config/admin/cookies.enc/cache     |      | 15 张表(见 §5)  |
                  +-------------------------------------+      +------------------+
```

### 2.2 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| 入口 | server/index.js | 监听 3090、初始化数据/表、启动定时任务 |
| 路由 | server/router.js | 路由分发 + 中间件链 + 错误处理 |
| 中间件 | server/middleware.js | CORS、JSON 解析、静态文件、请求日志（method/path/status/耗时） |
| 豆瓣热榜 | handlers/douban.js | 正则解析 `movie.douban.com/chart` HTML |
| 盘搜代理 | handlers/pansou.js | 转发 `so.252035.xyz/api/search` |
| 链接检测 | handlers/check.js | 批量链接可用性检测（代理盘搜 + 本地回退） |
| 夸克转存 | handlers/transfer.js | 夸克转存 + 创建新分享 + 历史 |
| 资源管理 | handlers/resource.js | resources 表 CRUD、提交审核（通过转资源库/驳回）、失效反馈、本地搜索 |
| 批量导入 | handlers/import.js | CSV/JSON 解析、预览、批量写入、导入日志 |
| 采集管理 | handlers/crawler.js | 采集源/规则 CRUD、手动触发（?dry=1 试运行） |
| 爬虫引擎 | lib/crawler-engine.js | page/rss/api 三类爬取核心（regex/jsonpath/fixed 提取，CDATA 兼容，URL 去重） |
| 后台管理 | handlers/admin.js | 登录/状态/Cookie/配置/缓存/密码 |
| 存储 | lib/storage.js | JSON 读写统一封装 + 路径常量 + 初始化 |
| 加密 | lib/crypto.js | AES-256-GCM + scrypt |
| 鉴权 | lib/auth.js | 内存 Session token |
| 夸克 API | lib/quark.js | 夸克网盘 API 封装（见 §6） |
| 百度 API | lib/baidu.js（规划） | 百度网盘 API 封装（见 §7） |

### 2.3 实际项目结构（2026-08 现状）

```
云盘搜根目录/
├── server/
│   ├── index.js            # 入口
│   ├── router.js           # 路由 + 中间件
│   ├── middleware.js       # CORS/JSON/静态/日志
│   └── handlers/           # douban / pansou / check / transfer / admin (+ 新增 resource/import/crawler)
├── lib/
│   ├── storage.js          # JSON 读写 + 初始化
│   ├── crypto.js           # AES-256-GCM / scrypt
│   ├── auth.js             # Session
│   └── quark.js            # 夸克 API
├── public/
│   ├── index.html          # 前台 SPA
│   ├── admin.html          # 后台 SPA
│   └── vue.global.prod.js  # Vue 3 运行时
├── data/                   # JSON 持久化 (运行时生成)
├── sql/init/
│   ├── 001_schema.sql      # 基础表
│   └── 002_schema_v2.sql   # v2.1 资源中心/导入/采集系统 (15 表)
├── docs/PROJECT_DOC.md     # 本文件 (合并总文档)
├── docker-compose.yml / Dockerfile
├── restart.bat             # 双击重启
├── server.js.bak           # 原始单文件备份
├── package.json            # 零依赖，start: node server/index.js
└── README.md
```

> **注意**：工作区根目录下另有一个空的 `cloud-disk-search/` 文件夹与若干 `_diag*.txt`、`git_msg.txt` 临时文件，与项目功能无关，可忽略。

---

## 3. 核心业务流程

### 3.1 双搜索模式

```
用户输入关键词
  ├── [本地查询] 模式（快，毫秒级）
  │     GET /api/search/local?kw=xxx&page=1&size=20&category=&disk_type=
  │     → SELECT ... FROM resources
  │         WHERE (title LIKE "%kw%" OR description LIKE "%kw%") AND status=1
  │         ORDER BY search_count DESC, created_at DESC LIMIT ...
  │     → 记录搜索词到 search_keywords
  └── [全网搜] 模式（全，1–3 秒）
        GET /api/pansou/search?kw=xxx（盘搜 API）
        → 1 秒后 POST /api/check/links 触发链接检测
        → 结果按有效状态排序
```

UI：搜索框下方两个 Tab——`[ 本地查询 (快) ] [ 全网搜 (全) ]`。

| 维度 | 本地查询 | 全网搜 |
|------|---------|--------|
| 速度 | 毫秒级 | 1–3 秒 |
| 数据量 | 取决于库内资源数 | 全网易盘资源 |
| 来源标记 | 显示"人工/导入/采集" | 显示"全网" |
| 链接检测 | 入库时/定时检测 | 每次搜索后检测 |
| 提取码 | 入库时已记录 | 需从网页获取 |

### 3.2 资源入库总流程

所有本地资源通过三条管道进入 `resources` 表（本地搜索的唯一数据源）：

```
        ┌──────────────┐
        │ resources 表  │ ← 本地搜索核心数据源
        └──────┬───────┘
   ┌───────────┼───────────┐
   v           v           v
[人工提交]   [批量导入]   [自动采集]
(submit)     (import)    (crawler)
   |           |           |
   v           v           v
submitted   CSV/JSON    RSS/网页/JSON API
_resources  文件上传     爬取+解析
```

每条资源带 `source` 标记：

| source | 来源 | 何时写入 | 后台操作 |
|--------|------|---------|---------|
| submitted | 用户提交审核通过 | 审核通过自动转入 | 管理提交审核 |
| imported | 文件批量导入 | 确认导入批量写入 | 上传文件 + 导入 |
| collected | 爬虫自动采集 | 每次采集后 | 管理采集源 + 规则 |
| manual | 管理员手动添加 | 后台"新增" | 直接填表 |
| transferred | 一键转存并分享 | 转存成功后 | 管理转存历史 |

### 3.3 人工提交流程

```
POST /api/submit/resource { title, url, password, disk_type, description, category, submitter_name }
  → 写入 submitted_resources (status=0 待审核)
  → 管理员后台审核：
      通过 (status=1) → INSERT INTO resources (source="submitted") + 回写 resource_id
      驳回 (status=2) → 填驳回原因 admin_remark
```

### 3.4 批量导入流程

```
POST /api/admin/import/upload (CSV/JSON 文件)
  → 后端解析、字段映射、URL 去重、返回前 5 条预览 + 统计
管理员确认 → POST /api/admin/import/confirm
  → 批量 INSERT INTO resources (source="imported")
  → 写入 import_logs
```
支持格式见 §5.6。

### 3.5 采集引擎流程

**采集源配置**（后台）：名称 / 类型(`rss`/`page`/`api`) / URL 模板(支持 `{page}`) / 编码 / 间隔 / 分类 / 网盘类型。
**解析规则**（每条源多条）：`title/url/password/disk_type/category/image/description` 各自的提取方式（`css`/`regex`/`jsonpath`/`fixed`/`concat`）。

```
定时 / 手动触发
  → 读取启用源 (status=1)
  → 对每个源：
      1. 构建请求 URL（替换 {page}，page_start..page_end 循环）
      2. HTTP GET（UA/Referer/Cookie，超时 15s，按 encoding 解码）
      3. 按 type 解析：
           page → 简单 HTML 解析 + CSS 选择器（复杂页可 npm i cheerio；降级正则）
           rss  → XML 解析 + 字段映射
           api  → JSON.parse + JSONPath
      4. 按 rule_type 提取字段值
      5. 去重（url 已存在则跳过）→ INSERT INTO resources (source="collected")
      6. UPDATE crawler_sources.last_crawled_at + 写 task_logs
```

**演进路径**：第一阶段（RSS + 简单列表页正则，零依赖）→ 第二阶段（cheerio CSS 选择器 + JSON API + 自动翻页）→ 第三阶段（puppeteer 渲染 / 登录态 Cookie / 代理池，按需引入）。当前设计覆盖第一、二阶段。

**采集注意事项**：频率控制防封、UA 轮换、15s 超时、编码处理（utf-8/gbk/big5）、URL 去重、失败写 `task_logs` 且多次失败自动停用。

### 3.6 一键转存并分享

> 用户贴入夸克/百度网盘链接（每行一个），系统自动转存到自己的网盘，生成新分享链接，批量返回便于复制转发。

```
POST /api/transfer/batch { urls: ["url1","url2",...] }
  → 逐条：判断网盘类型 → 解密 Cookie → 调 quark.transfer()/baidu.transfer()
       → 写入 resources (source="transferred") + transfer_history
       → 返回 { original, newUrl, pwd, status }
  → 汇总返回 { total, success, failed, results:[...] }
```
去重：转存前检查 `resources` 表是否已有相同 `original_url` 且 `link_valid=1`，有则直接返回缓存新链接。
前端入口：`public/transfer.html` 独立页面 + 导航栏 `[一键转存]` 按钮。

### 3.7 失效检测、反馈与修复

| 途径 | 触发 | 说明 |
|------|------|------|
| 定时检测 | scheduled_tasks.check_links（默认每 1h） | 批量请求 resources 表 URL，更新 link_valid |
| 用户反馈 | 搜索结果页 `[失效]` 按钮 | POST /api/resources/:id/report |
| 手动检测 | 后台选中一批 `[批量检测]` | 立即执行 check 逻辑 |

**自动隐藏**：定时检测连续 3 次失败 → `resources.status=0`（搜索不展示），后台仍可见并标灰，可手动恢复/删除。

**按来源修复策略**：

| source | 修复方式 |
|--------|---------|
| transferred | 自动重新转存（记住 original_url，重调 transfer） |
| collected | 重新采集 |
| submitted | 通知提交人/管理员手动 |
| imported/manual | 管理员后台直接改 URL |

---

## 4. 后端路由总览

> Admin 路由统一前缀 `/api/admin/`，除 `login` 外均需 `Authorization: Bearer <token>`。CORS 全开 `*`。SPA 回退：未命中路径返回 index.html。

### 4.1 公开路由

| 路由 | 方法 | 说明 |
|------|------|------|
| /api/douban/hot | GET | 豆瓣电影排行榜 |
| /api/pansou/search | GET | 盘搜资源搜索（代理 so.252035.xyz） |
| /api/search/local | GET | 本地资源搜索（新增，参数 kw/page/size/category/disk_type） |
| /api/check/links | POST | 批量链接检测 |
| /api/transfer/save | POST | 网盘转存（夸克） |
| /api/transfer/batch | POST | 批量转存并分享（新增） |
| /api/transfer/history | GET | 转存历史（最近 50 条） |
| /api/submit/resource | POST | 用户提交资源 |
| /api/resources/:id/report | POST | 用户反馈链接失效 |

### 4.2 后台路由（Bearer）

| 路由 | 方法 | 说明 |
|------|------|------|
| /api/admin/login | POST | 登录（scrypt 验证 + 生成 token） |
| /api/admin/logout | POST | 注销 |
| /api/admin/status | GET | 系统状态（Pansou/夸克 Cookie/缓存/cookieSize） |
| /api/admin/config | GET/POST | 配置读写（pansouBase / baiduDir / shareUrlPrefix 等） |
| /api/admin/cookies | POST | AES 加密保存 Cookie |
| /api/admin/cookies/test | POST | 真实 API 校验 Cookie（夸克 file 接口 / 百度 quota 接口） |
| /api/admin/cookies/summary | GET | Cookie 有效/无效摘要 |
| /api/admin/cache | GET | 缓存统计 |
| /api/admin/cache/clear | POST | 清空缓存 |
| /api/admin/password | POST | 修改管理员密码 |
| /api/admin/resources | GET/POST | 资源列表 / 手动添加 |
| /api/admin/resources/:id | POST | 编辑资源 |
| /api/admin/resources/:id/delete | POST | 删除资源 |
| /api/admin/resources/batch-delete | POST | 批量删除 |
| /api/admin/resources/:id/refresh | POST | 重新转存/刷新链接 |
| /api/admin/resources/batch-check | POST | 批量检测链接有效性 |
| /api/admin/categories | GET/POST | 分类列表 / 保存 |
| /api/admin/import/upload | POST | 上传导入文件，返回预览 |
| /api/admin/import/confirm | POST | 确认导入 |
| /api/admin/import/logs | GET | 导入历史 |
| /api/admin/crawler/sources | GET/POST | 采集源列表 / 新增 |
| /api/admin/crawler/sources/:id | POST | 编辑采集源 |
| /api/admin/crawler/sources/:id/delete | POST | 删除采集源 |
| /api/admin/crawler/sources/:id/test | POST | 测试采集一次 |
| /api/admin/crawler/sources/:id/run | POST | 手动触发采集 |
| /api/admin/crawler/rules | GET/POST | 规则列表 / 新增（含 source_id） |
| /api/admin/crawler/rules/:id | POST | 编辑规则 |
| /api/admin/crawler/rules/:id/delete | POST | 删除规则 |
| /api/admin/reports | GET | 失效反馈列表 |
| /api/admin/reports/:id/dismiss | POST | 标记反馈已处理 |

---

## 5. 数据库设计

> 实际建表脚本：`sql/init/002_schema_v2.sql`（15 张表，utf8mb4/InnoDB）。**注意**：当前应用默认运行在 JSON 文件，MySQL 为可选 Docker 部署；本设计的表尚未被运行时代码全部使用，部分为设计预留。

### 5.1 表总览

| # | 表名 | 用途 |
|---|------|------|
| 1 | site_config | 网站全局配置（取代 config.json） |
| 2 | admin_users | 管理员（取代 admin.json） |
| 3 | cookies | 加密网盘 Cookie（取代 cookies.enc） |
| 4 | transfer_cache | 转存结果缓存（取代 cache.json） |
| 5 | transfer_history | 转存历史 |
| 6 | **resources** | **★ 核心资源索引表（本地搜索数据源）** |
| 7 | submitted_resources | 人工提交审核 |
| 8 | **crawler_sources** | **★ 采集源定义** |
| 9 | **crawler_rules** | **★ 采集解析规则** |
| 10 | **import_logs** | **★ 批量导入日志** |
| 11 | broken_link_reports | 失效反馈记录 |
| 12 | search_keywords | 搜索热词 |
| 13 | scheduled_tasks | 定时任务定义 |
| 14 | task_logs | 任务执行日志 |
| 15 | custom_scripts | 自定义 JS 脚本 |
| — | categories | 分类管理（电影/电视剧/…/其他，12 项预置） |

### 5.2 核心表 DDL

**resources（资源索引表）**
```sql
CREATE TABLE IF NOT EXISTS resources (
  id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
  title           VARCHAR(256) NOT NULL,
  url             VARCHAR(512) NOT NULL,
  password        VARCHAR(32)  DEFAULT "",
  disk_type       VARCHAR(16)  NOT NULL DEFAULT "quark",
  category        VARCHAR(64)  DEFAULT "",
  tags            VARCHAR(256) DEFAULT "",
  description     TEXT         DEFAULT NULL,
  file_name       VARCHAR(256) DEFAULT "",
  file_size       VARCHAR(32)  DEFAULT "",
  source          VARCHAR(16)  NOT NULL DEFAULT "manual",
  source_id       VARCHAR(64)  DEFAULT "",
  status          TINYINT(1)   DEFAULT 1,
  link_valid      TINYINT(1)   DEFAULT 0,
  check_message   VARCHAR(128) DEFAULT "",
  search_count    INT          DEFAULT 0,
  last_checked_at DATETIME     DEFAULT NULL,
  check_fail_count INT         DEFAULT 0,
  created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_title (title(64)),
  INDEX idx_disk_type (disk_type),
  INDEX idx_category (category, status),
  INDEX idx_source (source, status),
  INDEX idx_created (created_at DESC),
  INDEX idx_url (url(128)),
  FULLTEXT INDEX ft_title_desc (title, description) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**submitted_resources（提交审核）**
```sql
CREATE TABLE IF NOT EXISTS submitted_resources (
  id                INT          PRIMARY KEY AUTO_INCREMENT,
  title             VARCHAR(256) NOT NULL,
  url               VARCHAR(512) NOT NULL,
  password          VARCHAR(32)  DEFAULT "",
  disk_type         VARCHAR(16)  DEFAULT "quark",
  description       TEXT         DEFAULT NULL,
  category          VARCHAR(64)  DEFAULT "",
  submitter_name    VARCHAR(64)  DEFAULT "",
  submitter_contact VARCHAR(128) DEFAULT "",
  status            TINYINT(1)   DEFAULT 0,   -- 0待审核 1通过 2驳回
  admin_remark      VARCHAR(256) DEFAULT "",
  link_valid        TINYINT(1)   DEFAULT 0,
  check_message     VARCHAR(128) DEFAULT "",
  created_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
  reviewed_at       DATETIME     DEFAULT NULL,
  resource_id       BIGINT       DEFAULT NULL,
  INDEX idx_status (status, created_at DESC),
  INDEX idx_category (category),
  INDEX idx_disk_type (disk_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**crawler_sources（采集源）**
```sql
CREATE TABLE IF NOT EXISTS crawler_sources (
  id              INT          PRIMARY KEY AUTO_INCREMENT,
  name            VARCHAR(128) NOT NULL,
  description     VARCHAR(256) DEFAULT "",
  source_type     VARCHAR(16)  NOT NULL,   -- rss / page / api
  url_template    VARCHAR(512) NOT NULL,   -- 支持 {page}
  page_start      INT          DEFAULT 1,
  page_end        INT          DEFAULT 1,
  page_param      VARCHAR(32)  DEFAULT "/page/{page}",
  encoding        VARCHAR(16)  DEFAULT "utf-8",
  interval_mins   INT          DEFAULT 0,   -- 0=仅手动
  status          TINYINT(1)   DEFAULT 1,
  category        VARCHAR(64)  DEFAULT "",
  disk_type       VARCHAR(16)  DEFAULT "",
  use_proxy       TINYINT(1)   DEFAULT 0,
  last_crawled_at DATETIME     DEFAULT NULL,
  created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status_type (status, source_type),
  INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**crawler_rules（解析规则）**
```sql
CREATE TABLE IF NOT EXISTS crawler_rules (
  id            INT          PRIMARY KEY AUTO_INCREMENT,
  source_id     INT          NOT NULL,
  field_name    VARCHAR(32)  NOT NULL,  -- title/url/password/disk_type/category/image/description
  rule_type     VARCHAR(16)  NOT NULL DEFAULT "css",  -- css/regex/jsonpath/fixed/concat
  rule_value    TEXT         NOT NULL,
  attr_name     VARCHAR(32)  DEFAULT "",  -- text(默认)/href/src/alt
  filter_regex  VARCHAR(256) DEFAULT "",
  default_value VARCHAR(128) DEFAULT "",
  required      TINYINT(1)   DEFAULT 0,
  position      INT          DEFAULT 0,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source (source_id, position),
  INDEX idx_field (field_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**import_logs（导入日志）**
```sql
CREATE TABLE IF NOT EXISTS import_logs (
  id             BIGINT       PRIMARY KEY AUTO_INCREMENT,
  file_name      VARCHAR(256) NOT NULL,
  file_format    VARCHAR(16)  NOT NULL,   -- csv / json
  total_rows     INT          DEFAULT 0,
  imported_rows  INT          DEFAULT 0,
  skipped_rows   INT          DEFAULT 0,
  duplicate_urls INT          DEFAULT 0,
  category       VARCHAR(64)  DEFAULT "",
  disk_type      VARCHAR(16)  DEFAULT "",
  status         VARCHAR(16)  NOT NULL DEFAULT "completed",  -- completed/partial/failed
  error_msg      TEXT         DEFAULT NULL,
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**broken_link_reports（失效反馈）**
```sql
CREATE TABLE IF NOT EXISTS broken_link_reports (
  id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
  resource_id   BIGINT       NOT NULL,
  reporter_ip   VARCHAR(64)  DEFAULT "",
  reporter_name VARCHAR(64)  DEFAULT "",
  message       VARCHAR(256) DEFAULT "",
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_resource (resource_id, created_at DESC),
  INDEX idx_ip (reporter_ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

其余表（site_config / admin_users / cookies / transfer_cache / transfer_history / search_keywords / scheduled_tasks / task_logs / custom_scripts / categories）结构见 `sql/init/002_schema_v2.sql`。要点：
- `categories`：预置 电影/电视剧/短剧/综艺/动漫/纪录片/软件/游戏/音乐/文档/图片/其他。
- `resources` 全文索引用 `WITH PARSER ngram`（中文分词，已修复默认不支持中文的问题）。
- `scheduled_tasks` 预置三条：转存资源清理(cleanup, 86400s)、链接可用性检测(check_links, 3600s)、Cookie 状态刷新(refresh_cookies, 43200s)。

### 5.3 表关系图

```
crawler_sources ──< crawler_rules (1:N 解析规则)

submitted_resources ──(审核通过转入)──> resources
import_logs        ──(批量写入)────────> resources
                                    │
                                    v
                              search_keywords (用户搜索时记录)

site_config / admin_users / cookies / transfer_cache / transfer_history (基础配置，独立)
scheduled_tasks ──< task_logs (调度与执行日志)
```

### 5.4 导入文件格式

**CSV**
```csv
title,url,password,disk_type,category,description
"流浪地球2",https://pan.quark.cn/s/abc123,1234,quark,电影,科幻大片
"三体",https://pan.baidu.com/s/xyz456,,baidu,电视剧,刘慈欣作品
```
**JSON**
```json
[
  { "title": "流浪地球2", "url": "https://pan.quark.cn/s/abc123",
    "password": "1234", "disk_type": "quark", "category": "电影",
    "description": "科幻大片", "tags": "科幻,郭帆,吴京" }
]
```
必填：`title`、`url`；其余可选；`url` 重复自动跳过。编码建议 UTF-8，GBK 由后端自动检测（jschardet）。

### 5.5 去重策略

导入与采集时：检查 `resources` 表是否已存在相同 `url`（`idx_url(128)` 保障性能），存在则跳过（记 `skipped_rows`/`duplicate_urls`），不存在则插入。数据库层未加 UNIQUE 约束，去重依靠逻辑层。

### 5.6 MySQL 与当前运行模式的关系

- **当前默认**：`data/*.json` 文件持久化，零依赖、零部署，适合单用户/管理员场景。
- **可选 MySQL**：Docker 挂载 `sql/init/*.sql`，适合多用户、历史查询、统计分析。若未来需要事务安全与并发，优先选 SQLite（单文件、零部署）而非 PostgreSQL（见 §10.2）。
- Supabase/PostgreSQL 已于 2026-07-15 彻底移除（`lib/db.js` + `pg` 依赖），原因是始终无法连接、静默回退 JSON，属死代码。

---

## 6. 夸克网盘 API 参考（逆向）

> 夸克无官方公开 API，接口可能随时变更。Host 选择关键：**`drive-pc.quark.cn`** 用于分享创建/列表/排序；**`drive-h.quark.cn`** 用于文件操作、分享 token/detail/save、任务查询。
> Base Path：`/1/clouddrive/`。认证：Cookie（登录夸克网页版后复制）。公共参数：`pr=ucpro&fr=pc&__t={timestamp}`。
> Cookie 有效期通常 7–30 天；单账号每秒约 5–10 请求，超限 429；批量建议间隔 1–2 秒。

### 6.1 核心接口

| 用途 | 方法 | Host | 路径 |
|------|------|------|------|
| 获取文件列表 | GET | drive-h | `/1/clouddrive/file` |
| 创建目录 | POST | drive-h | `/1/clouddrive/file` |
| 获取分享 token | POST | drive-h | `/1/clouddrive/share/sharepage/token` |
| 获取分享详情 | GET | drive-h | `/1/clouddrive/share/sharepage/detail` |
| 转存文件 | POST | drive-h | `/1/clouddrive/share/sharepage/save` |
| 查询任务状态 | GET | drive-h | `/1/clouddrive/task` |
| 创建分享 | POST | **drive-pc** | `/1/clouddrive/share` |
| 分享列表/详情 | GET | **drive-pc** | `/1/clouddrive/share/mypage/detail` |

### 6.2 关键错误码

| code | message | 说明 |
|------|---------|------|
| 31001 | require login | Cookie 失效/未登录 |
| 41006 | 分享不存在 | 分享链接失效或 pwd_id 错误 |
| 405 | Method Not Allowed | 方法不支持 |
| 404 | Not Found | 路径不存在 |

### 6.3 转存完整流程（lib/quark.js）

```
transfer(url, cookie)
  1. parseUrl(url)        → 正则 /pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/ 取 shareCode
  2. getShareInfo()       → POST sharepage/token → stoken；GET sharepage/detail → files[]
  3. ensureDir()          → GET/POST file，查找或创建 'pansou' 目录 → dirFid
  4. saveFiles()          → POST sharepage/save；有 task_id 则 queryTask 轮询(30s 超时)，否则 wait 2s
  5. listDir()            → 列出已保存文件
  6. createShare()        → POST /share (drive-pc) → task_id → queryTask → GET mypage/detail 匹配 share_id → share_url + pwd
```

**关键修复（2026-07-16）**：创建分享必须在 `drive-pc.quark.cn` 调用；`drive-h` 创建的任务不走分享发布流程，拿不到真实分享 URL。`lib/quark.js` 的 `api()` 已支持 `hostname` 参数以区分两个 host。

---

## 7. 百度网盘 API 与转存方案

> 百度转存尚未实现（规划中，P5）。以下为调研结论与实现方案。

### 7.1 两套 API 体系

| 体系 | 认证 | 特点 |
|------|------|------|
| 官方开放平台（PCS/xpan） | OAuth 2.0（授权码/设备码） | Access Token 30 天、Refresh 长期；每日 5000 次、单 IP 3 次/秒；需注册应用审核 |
| **非官方 BDUSS Cookie（推荐采用）** | BDUSS + STOKEN 直接调内部 API | 与夸克 Cookie 方案一致；无审批；响应快；但风险更高（接口变动/限流/泄露） |

### 7.2 推荐方案：BDUSS Cookie（方案 A）

**原理**：复用夸克设计——用户在后台粘贴 BDUSS，后端 AES-256-GCM 加密存储（`data/cookies.enc` 的 `baidu` 键），调用内部 API。

**8 步转存流程（对标夸克）：**
```
1. parseUrl()        → 正则 /pan\.baidu\.com\/s\/([a-zA-Z0-9]+)/ 取 shareid+uk+shortUrl
2. getShareDetail()  → GET /share/init?surl={shortUrl} → 文件列表 [{fs_id, filename, size}]
3. ensureDir()       → 查找/创建 'pansou' 目录
4. transferFiles()   → POST /share/transfer (shareid, from=uk, fsidlist, path)
5. queryTask()       → 轮询转存任务 (2–10s)
6. listFiles()       → 列出已转存文件
7. createShare()     → POST /share/set → shorturl + 提取码
8. 返回新链接 + 提取码
```

**关键内部接口：**
- 转存：`POST https://pan.baidu.com/share/transfer`（Cookie: BDUSS=...）
- 创建分享：`POST https://pan.baidu.com/share/set`
- 分享详情：`GET https://pan.baidu.com/share/init?surl={suffix}`

**预估改动**（~300–400 行）：新建 `lib/baidu.js`；`handlers/transfer.js` 增加 `type=baidu` 分支；`public/index.html` 弹窗支持百度自动转存；`public/admin.html` 增加 BDUSS 输入框 + 测试/保存。

### 7.3 风险评估与获取方式

- **风险**：百度 Web 端更新频繁（中风险）、非官方限流严格、BDUSS 泄露=账号被盗（需提示用户用百度小号）、违反开发者协议。
- **获取 BDUSS**：登录 `pan.baidu.com` → F12 → Application → Cookies → 复制 `BDUSS`（可选 `STOKEN`）。存储与夸克一致使用 AES-256-GCM，不向前端传明文。
- **迁回官方**：如后续官方收紧，可迁移至 OAuth 方案（需浏览器交互，无法实现"点击即转存"）。

### 7.4 官方 API 速查（参考，baidu_api_2.md 精华）

- 基础地址：REST `https://pan.baidu.com/rest/2.0/xpan/`；开放 `https://pan.baidu.com/api/`；OAuth `https://openapi.baidu.com/oauth/2.0/`。
- 通用响应：`{ "errno": 0, "request_id": "...", "error_msg": "succ" }`。
- 关键错误码：`110` token 失效、`2` 参数错误、`6` 无权限、`9100` 文件不存在、`31034` 高频限频、`31101` 文件超限。
- 容量：`GET /api/quota`；文件列表：`xpan/file?method=list`；搜索：`method=search`；转存：`xpan/share?method=transfer`；创建分享：`/share/set`；列举分享：`/share/list`；删除分享：`/share/cancel`。
- 文件操作（copy/move/rename/delete）统一走 `xpan/file?method=filemanager` 以 `opera` 区分。

---

## 8. 前端状态机

> 前台 `public/index.html` 为 Vue 3 SPA，哈希路由，暗色主题（`#0F172A` 背景，绿色 `#22C55E` 强调，Inter 字体）。

### 8.1 页面状态

```
首页 (page='home')
  ├── 加载豆瓣热榜 GET /api/douban/hot → 电影卡片网格；点击卡片 searchMovie(title) 跳转搜索
  └── 搜索框 doSearch() → page='search'
        GET /api/pansou/search?kw=xxx&src=tg&cloud_types=quark,baidu
        按网盘类型分组 (gr.value = {quark:[...], baidu:[...]})
        1s 后 caa() 触发链接检测
        筛选+排序: valid < uncertain < 无状态 < locked/unsupported < invalid
```

### 8.2 链接检测状态机（caa）

```
搜索完成 → 延迟 1s → caa()
  → 遍历 gr.value 收集所有链接 {key,type,url}，标记 checking
  → 初始化进度 {total, checked, valid, invalid}
  → 单线程每批 6 个串行 (w())
       POST /api/check/links {items:[{disk_type,url}]}
       映射 state → 显示状态 → 更新 6 卡片 + 进度 → 递归下一批
  → 全部完成，排序输出
```

**状态映射表：**

| API state | 显示标签 | CSS 颜色 | 排序权重 |
|-----------|---------|----------|----------|
| ok / valid | 有效 | 绿 #22C55E | 0 |
| uncertain / (空/超时) | 不确定 | 灰 #94A3B8 | 1 |
| (无) | 无标记 | — | 2 |
| locked | 需提取码 | 紫 #A855F7 | 3 |
| unsupported | 不支持 | 暗灰 #64748B | 3 |
| bad / invalid | 失效 | 红 #EF4444 | 4 |

**批量检测演化**：V1 一次性全发（慢/并发受限）→ V2 双线程各 5（竞态致 checked>total）→ **V3 单线程每批 6 串行（当前，无竞态）**。

**进度条**：`.detect-progress`(width100%, height26px)，`.dp-bar` 必须为 `display:block`（span 默认 inline 致 width 不生效），`.dp-text` 绝对定位覆盖居中。

### 8.3 转存弹窗状态机

```
点击"打开" → handleOpen(it)
  ├── dv=true (显示弹窗), si.value=it (封面图)
  ├── 非夸克: dd=原链接, dl=false → 直接显示二维码+链接
  └── 夸克: dl=true (loading) → POST /api/transfer/save
        成功: dd=newUrl+pwd, dl=false
        失败: dd=原链接, dl=false (回退，显示具体错误)
```
弹窗布局：标题+更新时间 / 封面图(3:4)+资源信息 / 二维码+链接+密码 / 描述 / Loading / 声明+[打开链接][关闭]。

### 8.4 前端踩坑记录

- **驼峰属性问题**：`:link-status`（kebab-case）而非 `:linkStatus`，否则浏览器小写化导致组件收不到 prop。
- **组件模板不能直接访问父作用域变量**：必须通过 prop 传递（如 `:disk-colors="diskColors"`）。
- **进度条漏 `display:block`**：`.dp-bar` 是 span，需 `display:block` 才生效。
- **`apply_patch` 工具会破坏中文**：写含中文文件一律用 Node.js `fs.writeFileSync`，勿用 PowerShell 读中文再写回。

---

## 9. 安全模型

```
密码存储:  scrypt(salt+password, N=16384) → salt:hash(64字节)  文件: data/admin.json
Session:    crypto.randomBytes(32) → hex token → 内存 Map
           进程生命周期有效（服务器重启后需重新登录，2026-07-15 已移除 24h 过期）
Cookie加密: AES-256-GCM，随机 IV(16B) + authTag(16B) + ciphertext
           密钥: data/config.json.encKey (32字节 random hex)
           格式: iv:authTag:ciphertext
Admin认证: 所有 /api/admin/* 需 Authorization: Bearer <token>（login 除外）
Cookie传输: 不向前端传明文
```

**Cookie 保存位置**：`data/cookies.enc`（密文），键 `quark`/`baidu`。密钥 `encKey` 首次启动随机生成；**删除 data/ 重建会导致旧 cookies.enc 无法解密**，备份需同时备份 `config.json` + `cookies.enc`。

**Cookie 有效期**：夸克 1–7 天（频繁调用可延长）；百度由服务器控制。本项目只负责加密存储与解密使用，不会主动令其过期。

**已知风险**：`apply_patch` 工具写中文会乱码；BDUSS 泄露等同账号被盗（建议百度小号）。

---

## 10. 优化计划与开发状态（P0–P6）

| 优先级 | 内容 | 状态 |
|--------|------|------|
| **P0** | 结构重组（server.js 拆分 modular） | ✅ 完成 2026-07-15 |
| **P1** | Cookie 管理修复（真实 API 测试 + 摘要显示） | ✅ 完成 2026-07-15 |
| **P2** | 日志 + 错误处理（logger 中间件） | ✅ 完成 2026-07-15 |
| **P3** | 转存历史（transfer_history.json + 接口） | ✅ 完成 2026-07-15 |
| **P4** | 弹窗 UI 优化 + 分享链接前缀 + 日志增强 | ✅ 完成 2026-07-15/16 |
| **P5** | 百度转存（BDUSS Cookie 方案） | ⏳ 待实现 |
| **P6** | 搜索增强（缓存 data/search_cache.json，按关键词 MD5 缓存 5 分钟） | ⏳ 待实现 |

### 10.1 P0 结构重组改动

`server.js`(300行单文件) → `server/index.js` + `router.js` + `middleware.js` + `handlers/*`；提取 `lib/storage.js` 统一 JSON 读写；`public/admin.html` 移除废弃 `quarkDir` 输入；`package.json`/`restart.bat` 入口改为 `node server/index.js`。

### 10.2 P1 Cookie 修复改动

`handlers/admin.js`：`testCookies` 改用真实 API（夸克 `/1/clouddrive/file`，百度 `/api/quota`）；`saveCookies` 先校验再保存；新增 `getCookieSummary`（解密+调 API 校验返回 valid/invalid）；输入 trim；`status` 增加 `cookieSize`。`router.js` 新增 `GET /api/admin/cookies/summary`。`admin.html` 中文提示 + 自动更新摘要 + 标题栏有效/无效状态。

### 10.3 数据存储方案评估结论

当前 JSON 文件方案对单用户/管理员场景完全够用；引入数据库属过度设计。若未来需多用户/历史/统计，优先 **SQLite**（零部署单文件、事务安全）而非 PostgreSQL。

### 10.4 Cookie 存储格式（开发者参考）

```
enc(Cookie明文, encKey)
  → crypto.createCipheriv("aes-256-gcm", Buffer.from(encKey,"hex"), randomIV)
  → 输出 "iv:authTag:ciphertext"（三段 hex 冒号分隔）
dec(密文, encKey)
  → 解析 iv/authTag/ciphertext → createDecipheriv → setAuthTag → 明文
```
手动验证：`node -e "var encKey=require('./data/config.json').encKey; var c=require('./data/cookies.enc'); console.log(require('./lib/crypto').dec(c.quark, encKey))"`

### 10.5 Session 过期处理（已修复）

原 24h 过期是 copy-paste 默认值，无安全考量。2026-07-15 改为方案 A：**移除过期判断，session 与进程生命周期绑定**（重启需重新登录）。一行改动，不影响已登录用户。

---

## 11. 修改记录（P0–P4）

| 阶段 | 文件 | 改动 |
|------|------|------|
| P0 | server.js→index/router/middleware/handlers | 模块化拆分 |
| P0 | lib/storage.js（新） | 提取 rd/wr/initData + 路径常量 |
| P0 | public/admin.html | 移除 quarkDir 输入框 |
| P0 | package.json / restart.bat | 入口改 node server/index.js |
| P1 | handlers/admin.js | testCookies 真实 API；saveCookies 先校验；getCookieSummary；trim；cookieSize |
| P1 | router.js | 新增 GET /api/admin/cookies/summary |
| P1 | admin.html | 中文提示、摘要自动更新、标题栏状态 |
| P2 | middleware.js / router.js | logger(req,res) 记录 method/path/status/耗时；统一错误捕获打印堆栈；4xx/5xx 输出 body |
| P3 | handlers/transfer.js | 转存成功写 transfer_history.json；getHistory 返回 50 条 |
| P3 | router.js | GET /api/transfer/history |
| P3 | index.html | 弹窗底部转存历史按钮+列表 |
| P4 | admin.js / transfer.js | shareUrlPrefix 配置 + 应用替换夸克链接 |
| P4 | admin.html / index.html | Share URL Prefix 输入框；封面图 @error+spinner；handleOpen 单次 fetch+错误；自动校验 Cookie |
| P4修正 | lib/quark.js | api() 支持 hostname；createShare 改 drive-pc.quark.cn + 补全参数 + mypage/detail 取真实链接；移除无效探针 |

---

## 12. 已知问题 & 错误记录

| # | 问题 | 状态 |
|---|------|------|
| 1 | `apply_patch` 写中文乱码 | 已规避：用 Node.js `fs.writeFileSync` 写中文 |
| 2 | `apply_patch` 删 JSON 属性留尾部逗号 | 已规避：用 `JSON.stringify(pkg,null,2)` 重写 |
| 3 | `lib/db.js` PostgreSQL 始终连不上 | 已移除（2026-07-15） |
| 4 | `db.setAdmin(b.newPassword)` 引用未定义 `b` | 随 db.js 移除 |
| 5 | 夸克转存 500（transfer 未导出） | 已修（2026-07-03） |
| 6 | `queryTask` 重复定义 | 已修（2026-07-03） |
| 7 | 前端封面图不显示（TG CDN/缺 images 字段） | 待调查 |
| 8 | 夸克 Cookie 保存/读取不一致（b-user-id 多值/密钥不匹配） | 待调查（用 Test 按钮验证） |
| 9 | 转存必须存到指定目录（非根目录） | 已修：ensureDir('pansou') |
| 10 | 版本兼容：Node v24.18 / Vue 3 本地 / backdrop-filter 需现代浏览器 | 已知 |
| 11 | **`sql/init/002_schema_v2.sql` 第 274 行不完整 `INSERT ... VALUES`（无内容）**，直接执行报错 | **待修**：删除该行或补全 values |
| 12 | 文档间不一致（百度转存状态、存储方案、来源类型） | 已于 §0.3 校正 |
| 13 | `docs/CRAWLER_REFERENCE.md` 二进制损坏，无法读取 | 待重新整理（见 §15） |

---

## 13. 开发日志（阶段精华）

- **阶段一 初始化**：逆向盘搜 API；确认搜索 API 开放 CORS；后端纯内置模块零依赖；豆瓣热榜正则解析；搜索/检测代理到 so.252035.xyz。
- **阶段二 UI**：暗色主题 + Inter；首页热榜+搜索；Vue3 哈希路由。
- **阶段三 搜索**：限制 cloud_types=quark,baidu；前端直连 + 后端代理备用；统计栏 + Tab。
- **阶段四 链接检测**：stateMap 演进（补 valid/invalid 映射）；批量检测 V1→V2→V3 串行；进度条。
- **阶段五 卡片 UI**：@click.stop 防双击；hover 上浮；失效卡片降透明度；排序规则。
- **阶段六 组件提取**：ResultCard 组件 + kebab-case prop；FLIP 动画回退普通 div。
- **阶段七 后台（Codex）**：独立 admin.html SPA；Cookie 加密管理；Supabase 尝试后弃用；夸克转存（百度待接）。

---

## 14. 待办清单（设计遗留）

**P0（影响正确性，均已处理）**
- resources 中文全文索引 → 加 `WITH PARSER ngram` ✅
- 批量转存无超时/进度 → 3–5 并行 + 实时进度 ✅（方案待细化防 429）
- 批量导入 CSV 编码 → 自动检测（jschardet）✅

**P1（建议补充，已处理）**
- 本地搜索排序权重：title 匹配 > description 匹配 > search_count 加分 ✅
- resources 无 URL 唯一约束 → 逻辑层去重，未加 UNIQUE（可考虑 `uk_url(url(255))`）

**P2（后续优化）**
- scheduled_tasks.task_config 无 Schema（开发时定）
- 批量操作错误不回滚，成功/失败分别列出
- **采集源频率控制细节缺失**：连续失败几次自动停用？分页延迟？UA 是否轮换？（等实现采集时处理）
- 爬虫技术选型参考（`CRAWLER_REFERENCE.md` 已损坏，待重建）

---

## 15. 爬虫引擎参考（CRAWLER_REFERENCE 缺失）

原 `docs/CRAWLER_REFERENCE.md` 因编码损坏无法读取（疑似 `apply_patch` 写入二进制）。其内容（爬虫技术选型、cheerio/puppeteer 取舍、代理池方案）尚未恢复。

**当前设计已覆盖的爬虫选型结论（来自 PROJECT_LOGIC / DESIGN_ARCHITECTURE）：**
- 第一阶段：RSS + 简单列表页，纯正则/字符串解析，零依赖。
- 第二阶段：`npm i cheerio`（CSS 选择器）、JSON API + JSONPath、自动翻页。
- 第三阶段（按需）：puppeteer/playwright（JS 渲染）、登录态 Cookie、代理 IP 池、自定义脚本。
- **不引入**：puppeteer/playwright（太重）、jsdom（偏重）。

> 实现采集功能前，应重建 `CRAWLER_REFERENCE.md`，补充：频率控制阈值、失败自动停用次数、分页延迟、UA 轮换策略。

---

## 附录 A：常用命令

```
# 启动
node server/index.js

# 解密查看已保存 Cookie（验证存储）
node -e "var k=require('./data/config.json').encKey,c=require('./data/cookies.enc');console.log(require('./lib/crypto').dec(c.quark,k))"

# Docker
docker compose up -d --build
docker compose logs -f

# 重建 MySQL 表（可选）
# 挂载 sql/init/001_schema.sql + 002_schema_v2.sql，首次启动自动执行
```

## 附录 B：外部服务依赖

| 服务 | 地址 | 用途 | 备注 |
|------|------|------|------|
| 盘搜 | so.252035.xyz | 全网搜索 + 链接检测代理 | 第三方，可能变动 |
| 豆瓣 | movie.douban.com/chart | 电影热榜 | HTML 正则解析 |
| 夸克 | drive-h/drive-pc.quark.cn | 转存/分享 | 逆向 API，Cookie 认证 |
| 百度 | pan.baidu.com | 转存（规划） | BDUSS 非官方方案 |
