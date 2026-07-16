# 云盘搜 - 网盘资源搜索引擎

基于盘搜 (PanSou) API 的网盘资源搜索引擎，聚合豆瓣电影热榜，支持链接可用性检测。

## 快速开始

`
cd cloud-disk-search
node server/index.js
# 前台: http://localhost:3090
# 后台: http://localhost:3090/admin.html
# 后台密码: admin123
`

无需 npm install。Vue 3 库文件本地保存，不依赖 CDN。

## 架构

```
cloud-disk-search/
├── server/
│   ├── index.js         # 入口
│   ├── router.js        # 路由分发
│   ├── middleware.js     # 中间件 (CORS/json/serveStatic)
│   └── handlers/
│       ├── douban.js    # 豆瓣热榜
│       ├── pansou.js    # 盘搜代理
│       ├── check.js     # 链接检测
│       ├── transfer.js  # 夸克转存
│       └── admin.js     # 后台 API
├── lib/
│   ├── storage.js       # JSON 读写 + 初始化
│   ├── crypto.js        # 加密
│   ├── auth.js          # Session 管理
│   └── quark.js         # 夸克 API
├── public/              # 前端静态文件
├── data/                # JSON 文件存储
└── docs/                # 文档
```


`
浏览器 → Node.js 服务器 (:3090) → 盘搜 API / 豆瓣
  │              │
  │  /api/douban/hot        ← 爬取 movie.douban.com/chart
  │  /api/pansou/search     ← 代理盘搜搜索 API
  │  /api/check/links       ← 代理链接检测 API
  │  /api/transfer/save     ← 夸克转存服务
  │  /api/admin/*           ← 后台管理 API
`

前端 Vue 3 SPA 通过同源后端代理调用外部 API。管理后台独立 SPA (admin.html)。

## 核心功能

- 资源搜索（夸克/百度网盘）
- 豆瓣电影热榜展示
- 链接可用性检测（自动批量检测，状态展示）
- 夸克转存服务（点击"打开"→ 自动转存到站长网盘 → 返回新链接）
- 管理后台（Cookie 加密管理、API 配置、缓存管理）
- PostgreSQL 数据持久化 + JSON 文件双保险

## 后台 API

| 路由 | 方法 | 说明 |
|------|------|------|
| /api/douban/hot | GET | 豆瓣电影排行榜 |
| /api/pansou/search | GET | 搜索代理，参数: kw, src, cloud_types |
| /api/check/links | POST | 链接批量检测 |
| /api/transfer/save | POST | 夸克转存，参数: {url} |
| /api/admin/login | POST | 管理员登录 |
| /api/admin/status | GET | 系统状态 |
| /api/admin/config | GET/POST | 配置管理 |
| /api/admin/cookies | POST | Cookie 加密存储 |
| /api/admin/cache | GET | 缓存统计 |
| /api/admin/cache/clear | POST | 清空缓存 |
| /api/admin/password | POST | 修改密码 |

## 开发状态

- 前台搜索 + 链接检测：✅ 完成
- 后台管理 + Cookie 加密：✅ 完成
- PostgreSQL 数据持久化：✅ 完成
- 夸克转存服务：✅ 基本完成（需配置 Cookie 后生效）
- 百度转存服务：⏳ 待接入
- 用户注册系统：📋 规划中

## 注意事项

### 乱码问题
apply_patch 工具在写入文件时会破坏所有非 ASCII 字符。编辑含中文的文件时必须：
1. 使用 Node.js 脚本写文件（fs.writeFileSync）
2. 中文用 \uXXXX 或 String.fromCharCode() 构造
3. 绝不用 Get-Content 读中文文件再写回去

### 进度条 CSS
- .dp-bar { display:block; } 必须加（span 默认 inline 不认 width）
- .detect-progress { width:100%; } 必须加（flex 容器里默认收缩为 0）

### 服务器重启
- 会话存在内存中，重启后需重新登录后台
- 双击 restart.bat 一键重启

## License

MIT