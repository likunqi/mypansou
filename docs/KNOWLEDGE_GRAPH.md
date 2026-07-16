# Cloud Disk Search — 项目知识图谱

> 生成日期: 2026-07-15
> 项目: 云盘搜 (cloud-disk-search)
> 零外部依赖 (Node.js 内建模块 + Vue 3 CDN)

---

## 一、文件结构一览

```
cloud-disk-search/
  server/
    index.js             # 入口 (监听 3090)
    router.js            # 路由分发 + 中间件链
    middleware.js         # CORS / json / serveStatic / fetchHttps
    handlers/
      douban.js          # 豆瓣热榜
      pansou.js          # 盘搜搜索代理
      check.js           # 链接检测 (盘搜代理 + 本地回退)
      transfer.js        # 夸克转存
      admin.js           # 后台管理 API (登录/状态/Cookie/配置/缓存/密码)
  lib/
    storage.js           # JSON 读写 + initData + 路径常量
    quark.js             # # storage: JSON 读写 + initData (+ PANSOU_BASE 常量)
    auth.js              # Session 鉴权 (内存 token, 永久有效)
    crypto.js            # AES-256-GCM + scrypt 密码哈希
  public/
    index.html           # Vue 3 SPA 前端 (搜索/豆瓣/转存弹窗)
    admin.html           # 管理后台 SPA (quarkDir 已移除)
    vue.global.prod.js   # Vue 3 运行时 (本地加载)
  data/
    config.json          # pansou 地址 / 加密密钥 / baiduDir
    admin.json           # 管理员密码哈希 (scrypt)
    cookies.enc          # AES-256-GCM 加密的网盘 Cookie
    cache.json           # 转存结果缓存
  docs/
    CHATLOG.md
    KNOWLEDGE_GRAPH.md
    OPTIMIZATION_PLAN.md
    MODIFICATION_RECORD.md
  restart.bat            # 双击重启脚本
  server.js.bak          # 原始单文件备份
  package.json
  test_supabase_db.py    # 数据库测试脚本 (已弃用)
  README.md
```

**历史删除:**
- `lib/db.js` -- PostgreSQL 客户端 (Supabase), 从未成功连接, 2026-07-15 移除
- `pg` npm 依赖 -- 项目唯一外部依赖, 随 db.js 一起移除

---

## 二、后端路由图 (server/index.js -- 模块化路由)

```
客户端请求 (http://localhost:3090)
  |
  +-- OPTIONS -> 204 CORS 预检
  +-- GET  /              -> serveStatic -> public/index.html
  +-- GET  /api/douban/hot    -> 爬虫解析 movie.douban.com/chart HTML
  +-- GET  /api/pansou/search  -> 代理到 so.252035.xyz/api/search
  +-- POST /api/check/links    -> 批量链接可用性检测
  +-- POST /api/transfer/save  -> 夸克转存 + 创建新分享
  +-- POST /api/admin/login    -> scrypt 验证密码 + 生成 session token
  +-- GET  /api/admin/status   -> 系统状态 (Pansou/夸克Cookie/缓存)
  +-- POST /api/admin/logout   -> 注销 token
  +-- POST /api/admin/cookies  -> AES 加密存储 Cookie
  +-- POST /api/admin/cookies/test -> 测试 Cookie 连通性
  +-- GET  /api/admin/config    -> 读取 pansouBase / baiduDir
  +-- POST /api/admin/config    -> 保存配置
  +-- GET  /api/admin/cache     -> 缓存统计
  +-- POST /api/admin/cache/clear -> 清空缓存
  +-- POST /api/admin/password  -> 修改管理员密码
```

### 路由设计特点
- 纯内建模块, 无框架, 手动解析 URL + method 做路由
- CORS: 所有响应头带 `Access-Control-Allow-Origin: *`
- Admin 路由统一前缀 `/api/admin/`, 除 login 外都需要 Bearer token
- 静态文件回退: SPA 模式, 找不到路径时返回 index.html

---

## 三、夸克转存流程 (lib/quark.js)

```
transfer(url, cookie)
  |
  +-- 1. parseUrl(url)
  |    -> /pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/ -> shareCode
  |
  +-- 2. getShareInfo(shareCode, passcode, cookie)
  |    -> POST /1/clouddrive/share/sharepage/token -> stoken
  |    -> GET  /1/clouddrive/share/sharepage/detail -> files[]
  |    -> 返回 {files: [{fid, name, token}], stoken}
  |
  +-- 3. ensureDir(cookie, 'pansou', '0')
  |    -> GET /1/clouddrive/file -> 查找'pansou' 目录
  |    -> 不存在则 POST 创建 -> 返回 dirFid
  |
  +-- 4. saveFiles(...) -> 转存到 pansou 目录
  |    -> 如果返回 task_id -> queryTask() 轮询等待 (30s 超时)
  |    -> 否则 wait(2000ms)
  |
  +-- 5. listDir(pansouFid) -> 查找已保存的文件
  |
  +-- 6. createShare(file.fid) -> 新分享链接
       -> 返回 {url: 'https://pan.quark.cn/s/...', pwd: 'xxxx'}
```

### 关键 API 路径 (host: drive-h.quark.cn)

- `POST /1/clouddrive/share/sharepage/token` -- 获取分享 stoken
- `GET  /1/clouddrive/share/sharepage/detail` -- 获取文件列表
- `POST /1/clouddrive/share/sharepage/save` -- 转存文件
- `GET  /1/clouddrive/task` -- 查询转存任务状态
- `GET  /1/clouddrive/file` -- 列出目录/文件
- `POST /1/clouddrive/share` -- 创建新分享

---

## 四、前端状态机 (index.html -- Vue 3 CDN SPA)

```
首页 (page='home')
  |
  +-- 加载豆瓣热榜 -> ld()
  |   -> GET /api/douban/hot -> 显示电影卡片网格
  |   -> 点击卡片 -> searchMovie(title) -> 跳转搜索
  |
  +-- 搜索框 -> doSearch()
      -> page='search'
      -> GET /api/pansou/search?kw=xxx&src=tg&cloud_types=quark,baidu
      -> 结果按网盘类型分组 (gr.value = {quark: [...], baidu: [...]})
      -> 1s 后自动触发链接检测 caa()
      -> 筛选 + 排序: valid < uncertain < 无状态 < locked < invalid
```

### 链接检测状态机 (caa)

| API state | 显示标签 | CSS 颜色 | 排序权重 |
|-----------|---------|----------|----------|
| ok/valid | 有效 | 绿色 #22C55E | 0 |
| uncertain | 不确定 | 灰色 | 1 |
| (无) | 无标记 | - | 2 |
| locked | 需提取码 | 紫色 | 3 |
| unsupported | 不支持 | 暗灰 | 3 |
| bad/invalid | 失效 | 红色 #EF4444 | 4 |

检测策略: 单线程每批 6 个, 收集全部链接后依次 POST /api/check/links

### 转存弹窗状态机

```
点击"打开"-> handleOpen(it)
  |
  +-- dv=true (show modal)
  |   si.value=it (设置封面图, images数组)
  |
  +-- 非夸克: dd=原链接, dl=false -> 直接显示二维码+链接
  |
  +-- 夸克: dl=true (loading)
       -> POST /api/transfer/save
       -> 成功: dd=newUrl+pwd, dl=false
       -> 失败: dd=原链接, dl=false (回退)
```

弹窗布局:
```
+------------------------------------------+
| 标题 + 更新时间                  [关闭] |
+------------+-----------------------------+
| 封面图     | 资源信息                    |
| (3:4)     | 更新时间 + 链接状态        |
|           +-----------------------------+
| 二维码     | 链接信息 (v-if="!dl")          |
| (dl时隐藏)| URL + 复制                    |
|           | 密码 + 复制密码            |
|           +-----------------------------+
|           | 资源描述                    |
|           | Loading (v-if="dl")          |
+------------+-----------------------------+
| 声明 + [打开链接] [关闭]           |
+------------------------------------------+
```

---


### 链接检测逻辑 (caa 函数)

#### 客户端 (index.html)

```
搜索完成
  |
  +-- 1s 延迟等待搜索渲染稳定
  +-- caa() 启动
  |    |
  |    +-- 遍历 gr.value (按网盘类型分组的结果)
  |    |   收集所有链接: {key, type, url}
  |    |
  |    +-- 全部标记为 status=checking
  |    |   触发 Vue 响应式更新 (ls.value = Object.assign({}, ls.value))
  |    |
  |    +-- 初始化进度: {total, checked=0, valid=0, invalid=0}
  |    |
  |    +-- 开始串行分批处理 (内部函数 w())
  |         |
  |         +-- 每批 6 个, idx逐步推进
  |         |
  |         +-- POST /api/check/links
  |         |   body: {items: [{disk_type, url}]}
  |         |
  |         +-- 映射 API state -> 显示状态
  |         |   ok/valid -> valid, bad/invalid -> invalid
  |         |   locked -> locked, unsupported -> unsupported
  |         |   uncertain/其他 -> uncertain
  |         |
  |         +-- 更新 6 个卡片状态 + 进度计数
  |         |   ls.value = Object.assign({}, ls.value)
  |         |   cs.value = Object.assign({}, cs.value)
  |         |
  |         +-- 递归调用 w() 处理下一批
  |             (直到全部完成, 设 ca.value=false)
  |
  +-- 排序输出 sortedResults
       valid < uncertain < 无状态 < locked/unsupported < invalid
       同级按 datetime 降序
```

#### 服务端 (server.js /api/check/links)

```
POST /api/check/links
  |
  +-- 解析 body: {items: [{disk_type, url}]}
  |
  +-- 优先: 代理到盘搜 API
  |    POST so.252035.xyz/api/check/links
  |    成功 -> 直接返回 {results: [{state, ...}]}
  |
  +-- 回退: 本地单链接检测 (fallback)
  |    HEAD 请求每个链接 (8s 超时)
  |    状态码 < 400 -> valid
  |    状态码 >= 400 -> invalid (含 403, 401)
  |    异常/超时 -> uncertain
  |    跟随最多 5 次重定向
  |
  +-- 返回 {code: 0, results: [{disk_type, url, state, checked_at}]}
```

#### 状态映射表

| API state | 内部状态 | 显示标签 | CSS 颜色 |
|-----------|---------|---------|----------|
| ok | valid | 有效 | 绿色 #22C55E |
| bad | invalid | 失效 | 红色 #EF4444 |
| valid | valid | 有效 | 绿色 #22C55E |
| invalid | invalid | 失效 | 红色 #EF4444 |
| locked | locked | 需提取码 | 紫色 #A855F7 |
| unsupported | unsupported | 不支持 | 暗灰 #64748B |
| uncertain | uncertain | 不确定 | 灰色 #94A3B8 |
| (空/超时) | uncertain | 不确定 | 灰色 #94A3B8 |

#### 批量检测演化

| 版本 | 策略 | 问题 |
|------|------|------|
| V1 | 一次性全部发送 POST | 链接过多响应慢, 浏览器并发限制 |
| V2 | 双线程各取 5 个并发 | 竞态条件导致 checked > total, 进度异常 |
| V3 (当前) | 单线程每批 6 个串行 | 无竞态, 安全。每批返回后递归调用下一批 |

#### 进度显示

```
+--------------------------------------------------------+
| 检测 N/N  validCount  invalidCount  |
| [=================                   ] 65%              |
+--------------------------------------------------------+
```

样式实现:
- .detect-progress 容器: width=100%, height=26px, border-radius=13px
- .dp-bar (绿色条): display=block, 宽度通过内联 style 动态设置
- .dp-text (覆盖文字): position=absolute, 居中覆盖在绿色条上


### 常见错误: caa 进度异常

- 症状: checked > total, 进度条超过 100%
- 原因: V2 时期双线程并发导致竞态条件, idx和cs.value不同步
- 修复: V3 改为纯串行, 每批完成后才推进 idx
- 当前状态: 稳定


## 五、数据持久化

| 层级 | 技术 | 用途 | 可靠性 |
|------|------|--------|--------|
| 内存 | server/index.js | sessions, 运行时缓存 | 重启丢失 |
| JSON 文件 | data/*.json | config, admin, cookies(加密), cache | 主要持久化 |

> PostgreSQL (Supabase) 已在 2026-07-15 移除, 原因: 始终无法连接, 连接失败时静默回退 JSON

---

## 六、安全模型

```
密码存储:
  scrypt(salt + password, N=16384) -> salt:hash (64 字节)
  文件: data/admin.json

Session:
  crypto.randomBytes(32) -> hex token -> 内存 Map
  进程生命周期有效（服务器重启后需重新登录）

Cookie 加密:
  AES-256-GCM
  随机 IV (16 字节)
  16 字节 auth tag
  密钥来源: data/config.json.encKey (32 字节 random hex)
  格式: iv:authTag:ciphertext

Admin 认证:
  所有 /api/admin/* 路由需带 Authorization: Bearer <token>
  login 接口免认证
```

---

## 七、已知问题 & 错误记录

### 1. 编码问题: apply_patch 破坏非 ASCII 字符
- 问题: 使用 `apply_patch` 工具编辑含中文的文件时, 所有非 ASCII 字符都会被破坏
- 影响: public/index.html, admin.html, data/config.json 等含中文文件
- 解决: 用 Node.js 脚本 + fs.writeFileSync() 替代; 不要用 PowerShell Get-Content 读取含中文文件再写回去

### 2. JSON 格式破坏: 尾部多余逗号
- 问题: apply_patch 移除 JSON 属性时会留下尾部逗号, 导致 JSON 解析失败
- 影响: package.json, data/*.json
- 解决: 移除属性后用 Node.js 重新写 JSON.stringify(pkg, null, 2); 或用正则替换尾部逗号

### 3. db.js 问题: PostgreSQL 始终无法连接
- 问题: Supabase 连接超时 (15s), 静默回退到 JSON 文件
- 影响: 所有 db.* 操作都是死代码, 从未真正执行
- 解决: 2026-07-15 已彻底移除 lib/db.js 和 pg 依赖

### 4. db.setAdmin(b.newPassword) -- 引用未定义变量
- 地址: server.js initData() 函数内
- 问题: 变量 `b` 未定义, 如果 db 真的连接成功会直接崩溃
- 状态: 因 db 从未连接成功而从未触发, 2026-07-15 随 db.js 一起移除

### 5. 夸克转存 500 Internal Server Error
- 问题: 点击"打开"后 POST /api/transfer/save 返回 500
- 原因: lib/quark.js 的 module.exports 导出了 transfer, 但函数未定义 (undefined)
- 状态: 2026-07-03 已补齐 transfer() 函数

### 6. queryTask 函数重复定义
- 地址: lib/quark.js
- 问题: 同名函数定义了两遍, 第一个用裸 https.request, 第二个用 api() 包装
- 影响: 第一个被第二个覆盖, 但代码混乱
- 状态: 2026-07-03 已移除重复定义

### 7. 前端图片不显示
- 问题: 弹窗封面图不显示
- 原因分析:
  a) Telegram CDN (cdn4.telesco.pe) 可能被阻断或需要特定 Referer
  b) 盘搜 API 可能不返回 images 字段 (只部分条目有)
  c) 之前转存接口报错导致整个弹窗交互失败
- 状态: 待调查。可在浏览器 DevTools Network 栏检查图片请求状态

### 8. 夸克 Cookie 保存/读取问题
- 问题: 管理后台保存的 Cookie 与请求中发送的 Cookie 不一致
- 原因分析:
  a) 可能是拷贝时丢失了部分 cookie 字段
  b) 夸克 cookie 的 b-user-id 可能有多个值, 需确保只保留最新的
  c) AES 加密/解密可能失败 (密钥不匹配)
- 状态: 待调查。可在管理后台点"Test"按钮测试 Cookie 连通性

### 9. 转存时的文件目录问题
- 问题: 转存不能存到根目录, 需要存到指定目录
- 解决: ensureDir(cookie, 'pansou', '0') 自动创建或查找 pansou 目录, 转存到该目录
- 状态: 2026-07-03 已实现

### 10. 版本兼容问题
- Node.js 版本: v24.18.0
- Vue 3 版本: 通过 vue.global.prod.js 本地加载, 不受外网影响
- 浏览器兼容: 使用了 `backdrop-filter`, 需要现代浏览器

---

## 八、已完成的修复

| 日期 | 修复内容 |
|------|--------|
| 2026-07-03 | 补齐 quark.transfer() 函数, 修复 500 错误 |
| 2026-07-03 | 移除 queryTask 重复定义 |
| 2026-07-03 | 转存目录从根目录改为 pansou 目录 |
| 2026-07-15 | 移除 lib/db.js + pg 依赖 (零外部依赖) |
| 2026-07-15 | 清除 server.js 中所有 db.* 引用 |
| 2026-07-15 | 移除已废弃的 quarkDir 配置项 |
| 2026-07-15 | 修复 initData() 中 db.setAdmin(b.newPassword) bug |
| 2026-07-15 | package.json 零外部依赖 |
| 2026-07-15 | **P0 结构重组**: server.js 拆分为 server/index.js + router.js + middleware.js + handlers/*.js |
| 2026-07-15 | 提取 lib/storage.js 统一 JSON 读写 |
| 2026-07-15 | admin.html 移除已废弃 quarkDir 输入框 |

---

## 九、开发记录

- 框架: Node.js 内建模组 + Vue 3 CDN (vue.global.prod.js 本地加载)
- 设计风格: 暗色主题 (#0F172A), 绿色强调 (#22C55E), Inter 字体
- 外部 API: so.252035.xyz (盘搜搜索), movie.douban.com (豆瓣), drive-h.quark.cn (夸克)
- 转存目录: pansou (自动创建)

### 核心业务流程

```
豆瓣热榜 -> 点击电影 -> 搜索盘搜 -> 链接检测 -> 点击打开
                                                    |
                            夸克: /api/transfer/save (8步: 解析 -> 获取 -> 目录 -> 转存 -> 等待 -> 列表 -> 分享 -> 返回)
                            非夸克: 直接显示原链接
```
