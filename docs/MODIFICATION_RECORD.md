# 修改记录

> 生成日期: 2026-07-15
> 来源: 根据 README.md + docs/*.md 内容与实际项目代码对比，发现并修正不一致/损坏项

---

## 1. README.md

| 原内容 | 修改后 | 说明 |
|--------|--------|------|
| BELL(0x07) + dmin.html | admin.html | “apply_patch” 工具遗留的编码损坏（非ASCII字符被替换为控制字符） |
| BELL(0x07) + pply_patch | apply_patch | 同上，“apply_patch” 工具名损坏 |
| 换行后 pm install。 | npm install。 | “npm” 的 “n” 被上一行非ASCII字符吃掉 |
| FF(0x0C) + s.writeFileSync | fs.writeFileSync | “fs” 的 “f” 被替换为 Form Feed 字符 |
| CR(0x0D) + estart.bat | restart.bat | “restart” 的 “r” 被替换为 CR 字符 |

## 2. docs/CHATLOG.md

| 原内容 | 修改后 | 说明 |
|--------|--------|------|
| lib/db.js 出现在“阶段七”文件结构中 | 已移除 | lib/db.js 已于 2026-07-15 删除，文件结构不再引用 |

## 3. docs/OPTIMIZATION_PLAN.md

| 原内容 | 修改后 | 说明 |
|--------|--------|------|
| ## 九、Admin Session 过期时间问题 | ## 九、Admin Session 过期时间问题（已修复） | Section IX 的方案 A 已实施 |
| 缺少执行状态记录 | 在“改动影响”末追加执行状态行 | 记录 auth.js 已于 2026-07-15 完成修改 |

## 4. docs/KNOWLEDGE_GRAPH.md

| 原内容 | 修改后 | 说明 |
|--------|--------|------|
| 24h 过期自动删除 | 进程生命周期有效（服务器重启后需重新登录） | 安全模型—Session 描述同步 auth.js 改动 |
| (内存 token, 24h 过期) | (内存 token, 永久有效) | 文件结构注释同步更新 |

## 5. lib/auth.js

| 原内容 | 修改后 | 说明 |
|--------|--------|------|
| if (Date.now() - sessions[t] > 86400000) { delete sessions[t]; return false; } | 已移除，增加注释说明 | 24h session 过期限制改为进程生命周期绑定（OPTIMIZATION_PLAN.md IX 方案 A） |

---

### 关联说明

改动 5 (auth.js) 触发改动 3 (OPTIMIZATION_PLAN.md) 和改动 4 (KNOWLEDGE_GRAPH.md) 的状态同步。
改动 1 和 2 是独立的文档/代码不一致修正。

### 未改动文件

- docs/KNOWLEDGE_GRAPH.md 的其他内容（pg 移除、db.js 删除等）与实际代码一致，无需修改。
## 6. P0 — 结构重组 (2026-07-15)

| 文件 | 改动 | 说明 |
|------|------|------|
| server.js → server/index.js + ... | 拆分为 server/index.js + router.js + middleware.js + handlers/ (douban/pansou/check/transfer/admin) | 单文件300行拆分为模块化架构 |
| lib/storage.js（新建） | 提取 rd/wr/initData + 路径常量 + PANSOU_BASE | 替代散落在 server.js 中的 JSON 读写 |
| public/admin.html | 移除 quarkDir 输入框和 Vue 数据绑定 | 该字段未写入 config.json，已废弃 |
| package.json | start 脚本改为 node server/index.js | 入口变更 |
| restart.bat | 启动命令从 node server.js 改为 node server/index.js | 入口变更 |
| README.md / docs/* | 同步项目结构描述 | 目录树/启动命令/文件结构更新 |

## 7. P1 — Cookie 管理修复 (2026-07-15)

| 文件 | 改动 | 说明 |
|------|------|------|
| server/handlers/admin.js | testCookies 改用真实 API（夸克 drive-h.quark.cn/file，百度 pan.baidu.com/api/quota） | 之前只测首页302，虚警 |
| server/handlers/admin.js | saveCookies 改为先校验再保存 | 校验不通过不写入 cookies.enc |
| server/handlers/admin.js | 新增 getCookieSummary（自动解密+调API校验，返回 valid/invalid） | 进入后台时调用，显示有效/无效 |
| server/handlers/admin.js | testCookies/saveCookies 增加输入 trim | 去除前后空格和空白行 |
| server/handlers/admin.js | status 增加 cookieSize 字段 | 显示已保存 Cookie 文件大小 |
| server/router.js | 新增 GET /api/admin/cookies/summary 路由 | 指向 getCookieSummary |
| public/admin.html | 保存/测试结果改为中文提示 | 夸克网盘Cookie已保存 / 验证失败，服务器返回401 |
| public/admin.html | 保存成功后自动更新摘要+状态 | ldcs() + loadst() |
| public/admin.html | 标题栏自动显示 Cookie 有效/无效状态 | 夸克:✔有效 / 夸克:✘无效 |
| public/admin.html | 去掉顶部摘要卡片（File/Size/b-user-id） | 精简界面 |
| public/admin.html | 修复百度保存成功提示显示 undefined | bs.error → bs.saved? 判断 |

## 8. P2 — 日志 + 错误处理 (2026-07-15)

| 文件 | 改动 | 说明 |
|------|------|------|
| server/middleware.js | 新增 logger(req, res) 函数 | 拦截 res.writeHead，记录 method/path/status/耗时 |
| server/router.js | 集成 logger 并增强错误处理 | 每个请求开始调用 logger()，未捕获异常打印堆栈 |

**日志格式:** POST /api/admin/login 200 22ms

## 9. P3 — 转存历史 (2026-07-15)

| 文件 | 改动 | 说明 |
|------|------|------|
| server/handlers/transfer.js | 转存成功后写入 data/transfer_history.json | 记录 originalUrl, newUrl, pwd, 时间等 |
| server/handlers/transfer.js | 新增 getHistory 函数 | 返回最近 50 条转存记录 |
| server/router.js | 新增 GET /api/transfer/history 路由 | - |
| public/index.html | 弹窗底部新增转存历史按钮 + 列表 | 点击展开，显示日期/URL/查看链接 |

**历史记录示例:** {originalUrl, newUrl, pwd, type, success, createdAt, title}

## 10. P4 + 分享链接前缀 + 日志增强 (2026-07-15)

| 文件 | 改动 | 说明 |
|------|------|------|
| server/handlers/admin.js | getConfig/saveConfig 新增 shareUrlPrefix | 替换转存后分享链接 |
| server/handlers/transfer.js | 转存成功后应用 shareUrlPrefix | 用配置前缀替换 Quark 链接 |
| public/admin.html | API 配置页新增 Share URL Prefix 输入框 | - |
| public/index.html | 封面图 @error + spinner + 错误显示 + 加载动画 | P4 UI 优化 |
| public/index.html | handleOpen 修复（单次 fetch + 错误处理） | 重复 fetch 问题修复 |
| public/index.html | 进入后台自动校验 Cookie 有效/无效 | - |
| public/index.html | 输入自动 trim + 状态变量 de 用于错误消息 | - |
| server/middleware.js | logger 输出 4xx/5xx 响应 body | 日志显示具体错误原因 |


## 12. P4 修正 — 分享链接获取修复 (2026-07-16)

| 文件 | 改动 | 说明 |
|------|------|------|
| lib/quark.js | api() 函数新增 hostname 参数 | 支持指定 API 域名，不全用 drive-h.quark.cn |
| lib/quark.js | createShare 改用 drive-pc.quark.cn + 补全参数 | 原 drive-h 创建分享不返回真实分享链接 |
| lib/quark.js | createShare 新增 drive-pc 列表查询分享 URL | 任务完成后 GET /share/mypage/detail 找到分享链接 |
| lib/quark.js | 移除所有无效探针（sharepage/token、share/list 等） | 精简代码，减少请求耗时 |

**修复关键:** 分享创建 API 必须在 drive-pc.quark.cn 上调，drive-h.quark.cn 创建的任务不走分享发布流程。

**最终分享 URL 获取流程:** POST /share (drive-pc) → task_id → queryTask → GET /mypage/detail (drive-pc) → 列表按 share_id 匹配 → share_url
