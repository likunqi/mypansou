# 云盘搜 (Cloud Disk Search)
基于盘搜 (PanSou) API 的网盘资源搜索引擎，聚合豆瓣电影热榜，支持夸克、百度网盘资源检索与链接可用性检测。

## 快速开始

`ash
node server/index.js
# 前台: http://localhost:3090
# 后台: http://localhost:3090/admin.html
# 后台密码: admin123
`

> 无需 npm install，Vue 3 库文件本地保存，不依赖外网 CDN。

## 架构

`
server/                  # Node.js 后端
  index.js               # 入口，监听 3090 端口
  router.js              # 路由分发
  middleware.js           # CORS / JSON / 静态文件服务
  handlers/
    douban.js            # 豆瓣电影热榜
    pansou.js            # 盘搜搜索代理
    check.js             # 链接可用性检测
    transfer.js          # 网盘转存服务
    admin.js             # 后台管理 API
lib/
  storage.js             # JSON 文件读写
  crypto.js              # AES-256-GCM 加密
  auth.js                # Session 管理
  quark.js               # 夸克网盘 API 封装
  baidu.js               # 百度网盘 API 封装
public/                  # 前端静态文件
data/                    # 数据存储 (JSON)
docs/                    # 技术文档
`

整体流程：
`
浏览器  -->  Node.js服务器(:3090)  -->  盘搜 API / 豆瓣 / 夸克
`

## 核心功能

- **资源搜索** — 支持夸克网盘、百度网盘资源检索
- **豆瓣热榜** — 展示豆瓣电影排行榜，点击直接搜索
- **链接检测** — 自动批量检测链接可用性，标记有效/失效/不确定
- **夸克转存** — 点击“打开”自动转存到站长网盘，返回新的分享链接
- **后台管理** — Cookie 加密管理、API 地址配置、缓存管理
- **转存历史** — 记录每次转存操作，支持历史查看

## API 参考

| 路由 | 方法 | 说明 |
|------|------|------|
| /api/douban/hot | GET | 豆瓣电影热榜 |
| /api/pansou/search | GET | 搜索代理（参数: kw, src, cloud_types）|
| /api/check/links | POST | 链接批量检测 |
| /api/transfer/save | POST | 网盘转存（参数: {url, type}）|
| /api/transfer/history | GET | 转存历史记录 |
| /api/admin/login | POST | 后台登录 |
| /api/admin/status | GET | 系统状态 |
| /api/admin/config | GET/POST | 配置管理 |
| /api/admin/cookies | POST | 保存 Cookie |
| /api/admin/cookies/test | POST | 测试 Cookie |
| /api/admin/cache | GET | 缓存统计 |
| /api/admin/cache/clear | POST | 清空缓存 |
| /api/admin/password | POST | 修改密码 |

## 技术栈

- **前端**: Vue 3 (CDN，本地 vue.global.prod.js)
- **后端**: Node.js 纯内置模块，零外部依赖
- **数据**: JSON 文件存储 (data/)
- **安全**: AES-256-GCM Cookie 加密，scrypt 密码哈希

## 开发状态

- 前台搜索 + 链接检测: ✅ 完成
- 后台管理 + Cookie 加密: ✅ 完成
- 夸克转存服务: ✅ 完成
- 百度转存服务: ⏳ 待接入
- 多用户注册系统: ⭕ 规划中

## License

MIT
