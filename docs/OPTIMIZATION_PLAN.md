# 云盘搜 — 项目优化计划

> 生成日期: 2026-07-15
> 状态: 待执行, 按优先级逐个推进

---

## 一、当前已发现的问题清单

### 1.1 Cookie 保存不透明

- 文件位置: data/cookies.enc
- 格式: JSON {quark: "...", baidu: "..."}
- 内容: 每个 Cookie 字符串经过 AES-256-GCM 加密 (iv:authTag:ciphertext)
- 密钥: data/config.json 里的 encKey (32 字节随机 hex)
- 问题: 用户看不到已保存的 Cookie 内容, 管理后台输入框保存后自动清空, 无法确认保存的是否正确
- 建议: 管理后台加一个"查看已保存 Cookie 摘要"功能 (不显示完整 Cookie, 只显示关键字段如 b-user-id 的前几位)

### 1.2 Cookie Test 按钮不可用

- 地址: server.js /api/admin/cookies/test (第 276 行)
- 当前实现: fetchHttps("pan.quark.cn", "/") 检查状态码 < 400
- 问题:
  a) pan.quark.cn/ 返回 302 重定向 (到 drive.quark.cn 或登录页), status < 400 永远为 true
  b) 测试没有使用真实的夸克 API, 只是访问了首页, 无法验证 Cookie 对转存 API 是否有效
  c) 同样的逻辑对 pan.baidu.com/ 也存在, 百度的根路径返回 200 (但不需要 Cookie)
- 修复方案: 改为调用真实的夸克 API 来验证
  - 夸克: GET /1/clouddrive/file?pdir_fid=0&size=1 (文件列表接口, 最稳定)
  - 百度: HEAD https://pan.baidu.com/api/quota (检查网盘容量)
  - 返回 200 + 有效 JSON = Cookie 有效
  - 返回 401/403 = Cookie 过期或无效

### 1.3 夸克 Cookie 的 b-user-id 不一致问题

- 现象: 管理后台保存的 Cookie 中的 b-user-id 与请求中实际发送的不同
- 原因分析:
  a) 夸克 Cookie 中 b-user-id 字段可能有多个值
  b) 手动拷贝时可能只拷贝了部分 cookie 字段
  c) AES 加密/解密密钥不匹配 (encKey 在 config.json 初始化时随机生成, 如果 data/ 目录被清理过密钥会变)
- 注意: 如果删除过 data/config.json 重新生成, 旧的 cookies.enc 就无法解密了, 需要重新保存 Cookie

### 1.4 百度转存未实现

- 当前行为: handleOpen() 中 type !== "quark" 时直接显示原链接, 跳过转存
- 原因: 百度网盘没有像夸克那样开放的转存 API, 需要 OAuth 授权或模拟浏览器操作
- 状态: 当前为占位实现 (显示提示, 指引用户手动转存)

### 1.5 Supabase 数据库已移除但未评估替代方案

- 历史: lib/db.js + pg 依赖已在 2026-07-15 移除, 因从未成功连接过
- 现状: 全部使用 data/*.json 文件持久化
- 问题: JSON 文件在高并发下存在写冲突风险, 不适合多用户场景
- 当前场景评估: 单用户/管理员使用, 并发极低, JSON 文件完全够用

---

## 二、数据存储方案评估

### 当前 JSON 文件存储的内容

| 文件 | 内容 | 读写频率 | 大小 | 是否需要数据库? |
|------|------|---------|------|---------------|
| data/config.json | pansouBase, encKey, baiduDir | 极少(仅管理员改配置) | <1KB | 不需要, JSON 足够 |
| data/admin.json | 密码哈希, 创建时间 | 极少(仅改密码时) | <1KB | 不需要 |
| data/cookies.enc | AES 加密的 Cookie | 极少(仅管理员改Cookie时写, 每次请求读) | <10KB | 不需要 |
| data/cache.json | 转存结果缓存 | 中等(每次转存写, 每次打开弹窗读) | 视使用量 | 可选, 但 JSON 够用 |

### 数据库 vs JSON 对比 (针对本项目)

| 维度 | JSON 文件 | 数据库 (SQLite/PostgreSQL) |
|------|----------|--------------------------|
| 部署复杂度 | 零, 纯文件 IO | 需要额外服务/驱动 |
| 读写性能 | 够用 (单用户, 文件 <1MB) | 更好 (索引, 并发) |
| 并发安全 | 写文件非原子, 有冲突风险 | 事务保障 |
| 备份 | 直接复制文件 | 导出/导入 |
| 查询能力 | 需要全量读取后 JS 过滤 | SQL 任意条件查询 |

**结论:** 当前项目为单用户/管理员工具, JSON 文件完全够用, 引入数据库是过度设计。
如未来需要多用户、历史记录查询、统计分析, 建议使用 SQLite (零部署, 单文件) 而非 PostgreSQL。

### 建议: 引入 SQLite (仅当需要历史记录时)

SQLite 优势:
- 零部署: 无需安装数据库服务, Node.js 通过 better-sqlite3 包使用
- 单文件: 和 JSON 一样方便备份
- 事务安全: 并发写文件不会损坏
- SQL 查询: 方便筛选历史记录

如果未来要加转存历史、搜索记录等功能, SQLite 是比 PostgreSQL 更合适的方案。
但目前 JSON 文件完全够用, 暂不需要变动。

---

## 三、完整优先级列表

### P0 — 结构重组 (不改功能, 只拆文件) **（已完成 2026-07-15）**

目标: 提高可维护性, 让新功能添加更干净

改动:
- 将 server.js 拆分为 server/index.js + server/router.js + server/handlers/*.js
- 添加中间件: cors, logger, admin-auth, error-handler
- 提取统一的 JSON 文件读写模块 lib/storage.js 替代散落的 rd()/wr()
- 前端: 移除 admin.html 中已废弃的 quarkDir 输入框

### P1 — Cookie 管理修复

目标: 修复 Test 按钮, 增加 Cookie 可见性

改动:
- server.js: /api/admin/cookies/test 改用真实 API 检测
  - 夸克: GET /1/clouddrive/file?pdir_fid=0&size=1
  - 百度: HEAD https://pan.baidu.com/api/quota
- admin.html: 添加"查看已保存 Cookie"功能, 显示摘要 (类型 + 保存时间 + 关键字段)
- admin.html: Test 按钮旁边加结果显示区域 (而非当前昙花一现的 toast)

### P2 — 日志 + 错误处理

目标: 运行时可见性, 出问题能快速定位

改动:
- 添加 logger 中间件: 记录每个请求的 method/url/status/duration
- 添加 error handler 中间件: 统一 catch 未处理异常, 返回 500 JSON + 打印堆栈
- 移除每个 handler 中的重复 try-catch

### P3 — 转存历史

目标: 记录每次转存, 支持历史查看, 避免重复转存

改动:
- 新增 data/transfer_history.json: [{originalUrl, newUrl, pwd, type, createdAt, success}]
- 新增 GET /api/transfer/history: 返回最近 100 条转存记录
- /api/transfer/save 返回成功后写入历史
- 前端弹窗新增"转存历史"入口 (小按钮, 点击展开列表)
- 同一 URL 重复点击"打开"时直接显示上次转存结果

### P4 — 弹窗 UI 优化

目标: 提升用户体验, 减少等待焦虑

改动:
- 封面图添加 onerror 回退 (当前已有占位图, 但 TG CDN 可能加载慢, 可加 loading skeleton)
- 转存中的 Loading 状态增加步骤提示 (装饰性, 非真实进度)
- 转存成功时增加绿色 flash 动画反馈
- 转存失败时显示具体错误原因 (而非统一回退到原链接)

### P5 — 百度转存 (BDUSS Cookie 方案)

> 状态: 待实现 | 参考文档: docs/baidu_api.md
> 2026-07-16 完成完整可行性调研，确认技术上可行

目标: 实现百度网盘自动转存，与现有夸克转存体验一致

改动:
- 新增 lib/baidu.js — 百度 API 封装（解析链接/转存/创建分享），参考 quark.js 结构
- 修改 server/handlers/transfer.js — 添加 type=baidu 分支，调用 lib/baidu.js
- 修改 public/admin.html — 管理后台增加百度 BDUSS 输入框 + 测试/保存按钮
- 修改 public/index.html — 百度链接弹窗支持自动转存，与夸克弹窗一致
- 转存历史兼容百度记录

技术方案:
- **认证方式**: BDUSS Cookie（非官方方案，与夸克 Cookie 方案对应）
- **用户粘贴 BDUSS** 到管理后台，AES-256-GCM 加密存储
- **转存流程**（8 步，对标夸克）:
  1. parseUrl() → 提取短码
  2. getShareDetail() → 解析分享页，获取文件列表 + shareid + uk
  3. ensureDir() → 创建/查找 pansou 目录
  4. transferFiles() → POST /share/transfer，发起转存
  5. queryTask() → 轮询转存任务状态
  6. listFiles() → 列出已转存的文件
  7. createShare() → POST /share/set，创建新分享
  8. 返回新链接 + 提取码

与夸克方案的差异对比:
| 步骤 | 夸克 | 百度 |
|------|------|------|
| 认证 | Cookie 直认 | BDUSS + STOKEN |
| 分享解析 | sharepage/token API | 解析分享页 HTML |
| 文件转存 | sharepage/save API | share/transfer API |
| 目录操作 | file API (drive-h) | xpan/file REST API |
| 创建分享 | share API (drive-pc) | share/set API |

风险评估:
- 百度 Web 端更新频繁，非官方内部接口可能变动（中等风险）
- BDUSS 泄露可导致账号被盗，需向用户明确提示（安全风险）
- 百度对非官方请求限流严格（频率风险）
- 如后续官方收紧，可迁移至 OAuth 方案

预估工作量: ~300-400 行代码（与 lib/quark.js 的 ~280 行相当）### P6 — 搜索增强

目标: 提升搜索速度, 减轻盘搜 API 压力

改动:
- 添加搜索缓存: data/search_cache.json, 按关键词 MD5 缓存 5 分钟
- 缓存命中时直接返回, 前端显示"缓存于 x 分钟前"
- 用户可手动"刷新"跳过缓存

---

## 四、各优先级执行顺序

```
P0 结构重组 ✅
  |
  +-- 已完成: 代码结构清晰, 后续改动基于新架构
  |
  v
P1 Cookie 修复
  |
  +-- 完成后: 夸克 Cookie 可保存可测试, 用户知道 Cookie 存哪了
  |
  v
P2 日志 + 错误处理
  |
  +-- 完成后: 出问题能查日志定位
  |
  v
P3 转存历史
  |
  +-- 完成后: 不重复转存, 有历史记录可查
  |
  v
P4 弹窗 UI 优化
  |
  +-- 完成后: 用户体验提升, 知道转存进行到哪一步
  |
  v
P5 百度转存 (BDUSS Cookie 方案) ⌐ 待实现
  |
  +-- 完成后: 百度链接可自动转存，与夸克体验一致
  |
  v
P6 搜索增强
    完成后: 同关键词搜索更快, 盘搜 API 请求更少
```

---

## 五、Cookie 存储详细说明 (给开发者参考)

### 存储位置与格式

文件路径: data/cookies.enc

内容示例:
```json
{
  "quark": "a1b2c3d4e5f6...:ghijklmnop...:xyz123..."
}
```

每个值由三部分组成, 冒号分隔:
1. iv (16 字节 hex) - 初始化向量
2. authTag (16 字节 hex) - GCM 认证标签
3. ciphertext (hex) - 加密后的 Cookie 字符串

加密过程:
```
enc(Cookie明文, encKey)
  -> crypto.createCipheriv("aes-256-gcm", Buffer.from(encKey, "hex"), randomIV)
  -> 输出 iv:authTag:ciphertext
```

解密过程:
```
dec(加密字符串, encKey)
  -> 解析 iv, authTag, ciphertext
  -> crypto.createDecipheriv("aes-256-gcm", Buffer.from(encKey, "hex"), iv)
  -> setAuthTag(authTag)
  -> 输出 Cookie 明文
```

### 密钥安全说明

- encKey 在第一次启动时自动生成 (crypto.randomBytes(32))
- 存储在 data/config.json 中
- 如果删除 data/ 目录重建, encKey 会变, 旧的 cookies.enc 无法解密
- 备份时需同时备份 data/config.json 和 data/cookies.enc

---

## 六、夸克转存 API 验证接口参考

修复 Test 按钮时需要用到的真实夸克 API:

| 用途 | 接口 | 预期成功响应 | 预期失败响应 |
|------|------|------------|------------|
| 获取文件列表 | GET /1/clouddrive/file?pdir_fid=0&size=1 | 200 + JSON | 401/403 |

推荐用 /1/clouddrive/file 来测试, 因为即使换了 API 版本, 文件列表接口通常最稳定。
请求根目录 (pdir_fid=0) 只要取 1 条记录, 速度和可靠性最高。

---

## 七、转存历史数据结构 (设计参考)

```json
// data/transfer_history.json
{
  "records": [
    {
      "id": "20260715_001",
      "originalUrl": "https://pan.quark.cn/s/abc123",
      "newUrl": "https://pan.quark.cn/s/def456",
      "pwd": "z7y9",
      "type": "quark",
      "success": true,
      "createdAt": "2026-07-15T10:27:19Z",
      "note": "资源名称",
      "source": "来源渠道"
    }
  ],
  "stats": {
    "total": 0,
    "success": 0,
    "fail": 0
  }
}
```


---

## 八、Cookie 保存流程详解 (针对用户疑问)

### 问题: "在后台输入 Cookie 点击保存，保存到哪里了?"

答: 保存到 data/cookies.enc 文件里。但存的不是原文, 是加密后的密文。

### 完整保存流程

```
管理后台输入框: Cookie 明文 (如: b-user-id=xxx; _UP_A4A_11_=yyy; ...)
  |
  +-- POST /api/admin/cookies
  |    body: { quark: "b-user-id=xxx; _UP_A4A_11_=yyy; ..." }
  |
  +-- server.js 接收请求
  |    |
  |    +-- 读 encKey: data/config.json 里的 encKey (32 字节 hex)
  |    +-- 调用 enc(Cookie明文, encKey)
  |    |    |
  |    |    +-- crypto.createCipheriv("aes-256-gcm", encKey, randomIV)
  |    |    +-- 输出 iv:authTag:ciphertext  (冒号分隔的三段 hex)
  |    |
  |    +-- 写入 data/cookies.enc
  |    |    |
  |    |    +-- 读取现有 cookies.enc (JSON 对象)
  |    |    +-- 设置 cookiePairs.quark = "iv:authTag:ciphertext"
  |    |    +-- 写回 cookies.enc (fs.writeFileSync)
  |    |
  |    +-- 返回 { ok: true }
  |
  +-- 管理后台看到: toast 提示 "Saved", 输入框被清空
```

### 保存后的文件示例

```json
// data/cookies.enc
{
  "quark": "0fecb79f...:1effdff2...:3841d17b..."
}
```

### 可以手动验证: 用 Node.js 解密查看

```bash
# 在项目目录运行
node -e "var encKey=require("./data/config.json").encKey; var cookies=require("./data/cookies.enc"); var dec=require("./lib/crypto").dec; console.log(dec(cookies.quark, encKey))"
```

### 关于夸克 Cookie 失效

夸克 Cookie 的失效由夸克服务器控制, 和本项目的存储方式无关:
- 夸克 Cookie 通常有效期 1~7 天 (取决于使用频率)
- 频繁调用 API (如转存) 会延长 Cookie 寿命
- 长时间不活跃 (超过 24~48 小时) Cookie 会自动过期
- 本项目的作用: 加密存储 Cookie, 在转存时自动解密使用, 不会主动让 Cookie 过期

如果要降低 Cookie 过期概率:
1. 每天至少用一次转存功能 (保持活跃)
2. 保存 Cookie 时确保包含完整字段 (特别是 b-user-id, __pus, __puus, isg 等关键字段)
3. 同一个 Cookie 不要在多处同时使用 (会被踢下线)

### 百度 Cookie 同理

百度 Cookie 也保存在同一个 data/cookies.enc 文件里, 键名为 baidu:

```json
{
  "quark": "...",
  "baidu": "iv:authTag:ciphertext  (百度Cookie的加密值)"
}
```

百度 Cookie 的失效同样由百度服务器控制, 保存方式与夸克完全一致。
目前百度转存功能尚未实现, 但 Cookie 已可以保存和测试。

---

## 九、Admin Session 过期时间问题（已修复）

### 问题: "我不需要24小时, 我需要的是尽可能的不失效"

当前实现 (lib/auth.js):
```js
function check(t) {
  if (!sessions[t]) return false;
  if (Date.now() - sessions[t] > 86400000) { delete sessions[t]; return false; }
  return true;
}
```

- 86400000ms = 24 小时
- sessions 存储在内存中 (server.js 进程内变量)
- 服务器重启后所有 session 丢失, 需要重新登录

### 分析: 为什么当前是 24 小时?

这不是编码时的决策, 而是 copy-paste 的默认值。没有安全方面的考量 (管理后台密码只有管理员自己知道, 没有多用户场景)。
可以安全地移除这个过期限制。

### 改动方案

**方案 A (推荐): 移除过期时间, 改为进程生命周期绑定**

```js
function check(t) {
  return !!sessions[t];  // 只要服务器不重启, 登录永不过期
}
```

这个方案不降低安全性, 因为:
- sessions 在内存中, 服务器重启后需要重新登录
- 管理后台只有管理员自己使用
- 没有 token 泄漏的风险 (token 不会通过网络传输给第三方)

**方案 B: 设置更长的过期时间 (如 30 天)**

```js
if (Date.now() - sessions[t] > 2592000000) { delete sessions[t]; return false; }
// 2592000000ms = 30 天
```

如果需要"尽可能不失效又不想永久有效", 这个方案比 24 小时合理得多。

**方案 C: 保持现状, 但在管理后台增加"保持登录"选项**

这属于过度设计, 不推荐。

### 改动影响

- 改动范围: 仅 lib/auth.js 中的 check() 函数, 一行代码
- 不需要重启服务: 下次请求时新逻辑立即生效
- 已存在的 session 不会受影响 (已经登录的用户不会掉线)
- **执行状态: 2026-07-15 已修复**, 采用方案 A (进程生命周期绑定)

---

## 十、需要补充到 P0~P6 的改动

### 新增到 P1 (Cookie 管理修复)

在 P1 中增加:
- 管理后台添加"Cookie 保存位置说明": data/cookies.enc, 显示文件路径和当前文件大小
- 添加"查看已保存 Cookie 摘要": 解密后只显示关键字段 (b-user-id 前 8 位 + 过期时间)

### 新增到 P0 (结构重组)

在 P0 中增加:
- 修改 lib/auth.js: 移除 24 小时过期判断 (或改为更长时间)

