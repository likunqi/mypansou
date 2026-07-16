# 云盘搜 (Cloud Disk Search)

基于盘搜 (PanSou) API 的网盘资源搜索引擎。聚合豆瓣电影热榜，支持夸克、百度网盘资源的全文检索与链接可用性检测，并提供夸克网盘一键转存服务。

## 快速开始

### 前置要求

- Node.js >= 18
- 无需 npm install（零外部依赖）

### 启动

`ash
node server/index.js
`

### 访问

| 页面 | 地址 | 说明 |
|------|------|------|
| 前台搜索 | http://localhost:3090 | 资源检索 + 链接检测 + 转存 |
| 后台管理 | http://localhost:3090/admin.html | Cookie 管理 / 配置 / 缓存 |

> 后台默认密码: **admin123**（可在 data/admin.json 中修改）

## 项目结构

`
server/                   # 后端服务
  index.js                # 入口文件，监听 3090 端口
  router.js               # 路由分发
  middleware.js            # 中间件：CORS / JSON / 静态文件 / 日志
  handlers/
    douban.js             # 豆瓣电影热榜
    pansou.js             # 盘搜搜索代理
    check.js              # 链接批量检测（盘搜代理 + 本地回退）
    transfer.js           # 夸克/百度网盘转存服务
    admin.js              # 后台管理 API
lib/                      # 工具库
  storage.js              # JSON 文件读写 + 数据初始化
  crypto.js               # AES-256-GCM 加密 / scrypt 哈希
  auth.js                 # Session 鉴权（内存 token）
  quark.js                # 夸克网盘 API 封装
  baidu.js                # 百度网盘 API 封装
public/                   # 前端静态文件
  index.html              # Vue 3 SPA（前台搜索）
  admin.html              # Vue 3 SPA（后台管理）
  vue.global.prod.js      # Vue 3 运行时（本地加载）
data/                     # 数据存储（JSON 文件）
  config.json             # 盘搜地址 / 加密密钥 / 分享前缀
  admin.json              # 管理员密码哈希（scrypt）
  cookies.enc             # Cookie（AES-256-GCM 加密）
  cache.json              # 转存结果缓存
docs/                     # 技术文档
  CHATLOG.md              # 开发日志
  KNOWLEDGE_GRAPH.md      # 项目知识图谱
  OPTIMIZATION_PLAN.md    # 优化计划（P0-P6）
  MODIFICATION_RECORD.md  # 修改记录
  baidu_api.md            # 百度网盘 API 调研
  baidu_api_2.md          # 百度官方 API 文档
  quark_api.md            # 夸克网盘 API 文档
`

## 核心业务流程

`
用户访问首页
  |
  +-- 豆瓣热榜加载 -> GET /api/douban/hot -> 展示电影卡片
  |     点击卡片 -> 自动搜索电影名
  |
  +-- 搜索框输入 -> doSearch()
        |
        +-- GET /api/pansou/search?kw=xxx&cloud_types=quark,baidu
        |     盘搜 API 返回夸克/百度网盘资源列表
        |
        +-- 1s 后自动触发链接检测 (caa)
        |     POST /api/check/links (批量 6 个/批, 单线程串行)
        |       -> 优先代理盘搜检测 API
        |       -> 失败则本地 HEAD 请求回退
        |
        +-- 结果排序: 有效 < 不确定 < 无状态 < 需提取码 < 失效
              |
              +-- 点击打开 -> handleOpen()
                    +-- 夸克: POST /api/transfer/save
                    |     解析链接 -> 获取文件 -> 转存 -> 轮询 -> 新分享
                    +-- 百度: POST /api/transfer/save (type=baidu)
                    |     同上, 基于 BDUSS Cookie
                    +-- 其他: 直接显示原链接
`

## 功能特性

### 资源搜索
- 夸克网盘 / 百度网盘双源检索
- 关键词智能匹配, 结果按网盘类型分组
- 支持 tab 切换筛选（全部 / 夸克 / 百度）

### 豆瓣电影热榜
- 自动爬取 movie.douban.com/chart 排行榜
- 电影卡片展示（封面图 + 评分）
- 点击卡片一键搜索该电影资源

### 链接检测系统
- 搜索完成后 1s 自动触发批量检测
- 单线程 6 个/批串行请求, 避免并发竞态
- 检测状态: 有效 / 失效 / 不确定 / 需提取码 / 不支持
- 结果按状态排序 + 更新时间降序
- 进度条实时显示检测进度

### 夸克网盘转存
- 点击打开按钮触发完整转存流程:
  1. 解析分享链接提取短码
  2. 获取分享详情 + 文件列表
  3. 创建或查找 pansou 目录
  4. 提交转存任务
  5. 轮询等待任务完成（30s 超时）
  6. 列出已保存文件
  7. 创建新分享链接
  8. 返回新 URL + 提取码
- 支持 URL 前缀替换（后台可配置）
- 转存历史记录可查

### 百度网盘转存
- 基于 BDUSS Cookie 的非官方方案（与夸克方案一致）
- 同样支持 8 步完整转存流程
- 需先在后台配置 BDUSS

### 后台管理系统
- Cookie 加密管理: 夸克 Cookie + 百度 BDUSS
  - AES-256-GCM 加密存储（data/cookies.enc）
  - 保存前自动校验 Cookie 有效性
  - 状态面板显示 Cookie 有效/无效状态
- API 地址配置: 盘搜源地址 / 分享 URL 前缀
- 缓存管理: 查看缓存统计 / 清空缓存
- 密码修改

## 安全设计

| 层面 | 措施 |
|------|------|
| Cookie 存储 | AES-256-GCM 加密, 随机 IV（16 字节）+ auth tag（16 字节）|
| 密码存储 | scrypt（N=16384）+ salt 哈希 |
| 会话管理 | 内存 token（进程生命周期, 重启后需重新登录）|
| 权限控制 | 所有 /api/admin/* 路由需 Bearer token 鉴权（/login 除外）|
| Cookie 传输 | 不向前端传递明文 Cookie |

## API 接口

| 路由 | 方法 | 认证 | 说明 |
|------|------|------|------|
| /api/douban/hot | GET | 无 | 豆瓣电影排行榜 |
| /api/pansou/search | GET | 无 | 盘搜资源搜索（参数: kw, src, cloud_types）|
| /api/check/links | POST | 无 | 链接批量检测 |
| /api/transfer/save | POST | 无 | 网盘转存（参数: {url, type}）|
| /api/transfer/history | GET | 无 | 转存历史（最近 50 条）|
| /api/admin/login | POST | 无 | 管理员登录 |
| /api/admin/status | GET | Bearer | 系统状态 |
| /api/admin/config | GET/POST | Bearer | 配置管理 |
| /api/admin/cookies | POST | Bearer | 保存 Cookie |
| /api/admin/cookies/test | POST | Bearer | 测试 Cookie |
| /api/admin/cookies/summary | GET | Bearer | Cookie 状态摘要 |
| /api/admin/cache | GET | Bearer | 缓存统计 |
| /api/admin/cache/clear | POST | Bearer | 清空缓存 |
| /api/admin/password | POST | Bearer | 修改密码 |
| /api/admin/logout | POST | Bearer | 退出登录 |

## 数据存储

当前使用 JSON 文件系统存储（data/ 目录）, 无需数据库:

| 文件 | 内容 | 读写频率 |
|------|------|---------|
| config.json | 盘搜地址 / 加密密钥 / 百度目录 / 分享前缀 | 极低 |
| admin.json | 管理员密码哈希（scrypt）| 极低 |
| cookies.enc | 夸克 + 百度 Cookie（AES-256-GCM 加密）| 极低 |
| cache.json | 转存结果缓存 | 中等 |
| transfer_history.json | 转存操作历史记录 | 中等 |

> JSON 文件方案适用于单用户/管理员工具场景。如需多用户并发, 建议迁移至 SQLite。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | Vue 3 (Composition API, CDN, 本地 vue.global.prod.js) |
| 后端 | Node.js 纯内置模块（http, crypto, fs, https）|
| 数据 | JSON 文件系统 |
| 加密 | AES-256-GCM + scrypt（Node.js crypto 内置）|
| 会话 | 内存 Map（crypto.randomBytes 32 字节 token）|
| 外部 API | so.252035.xyz（盘搜）/ movie.douban.com（豆瓣）/ drive-h.quark.cn（夸克）/ pan.baidu.com（百度）|

## 开发状态

| 模块 | 状态 | 备注 |
|------|------|------|
| 资源搜索 + 链接检测 | 完成 | V3 单线程 6 个/批 |
| 豆瓣热榜 | 完成 | 爬取 movie.douban.com/chart |
| 后台管理 + Cookie 加密 | 完成 | AES-256-GCM + 校验 |
| 夸克转存 | 完成 | 8 步完整流程 |
| 转存历史 | 完成 | data/transfer_history.json |
| 分享 URL 前缀替换 | 完成 | 后台可配置 |
| 百度转存 | 待接入 | BDUSS Cookie 方案, 文档已就绪 |
| 搜索缓存 | 待接入 | 关键词 MD5 缓存 5 分钟 |
| 多用户系统 | 规划中 | 单用户工具, 暂不需要 |

## 注意事项

### 编码问题
编辑含中文的文件时, 不要使用 apply_patch 工具, 它会破坏非 ASCII 字符。应使用 Node.js 脚本（fs.writeFileSync）写入文件。

### 服务器重启
- Session 存储在内存中, 重启后需重新登录后台
- 双击 restart.bat 一键重启

### Cookie 有效期
- 夸克 Cookie: 通常 7-30 天, 频繁调用 API 可延长寿命
- 百度 BDUSS: 约 30 天
- 同一 Cookie 不要在多处同时使用（会被踢下线）

## License

MIT