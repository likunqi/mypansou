# 开发日志 & 技术决策记录

## 项目概述

云盘搜 — 基于盘搜 (PanSou) API 的网盘资源搜索引擎，聚合豆瓣电影热榜，支持链接可用性检测。

- 前端：Vue 3 (CDN, Composition API, in-DOM 模板)
- 后端：Node.js (纯内置模块, 零外部依赖)
- 设计：ui-ux-pro-max 系统输出暗色主题 + Inter 字体

## 开发阶段

### 阶段一：项目初始化与 API 适配

**初始搭建**
- 分析盘搜前端 JS 逆向出 API 结构
- 确认 CORS 策略：搜索 API 开放 CORS
- 决定：搜索直连盘搜 API，链接检测走本地后端代理

**后端设计**
- server.js 使用纯 Node.js 内置模块，零 npm 依赖
- 豆瓣热榜爬取 movie.douban.com/chart，正则解析 HTML
- 搜索代理：/api/pansou/search → so.252035.xyz/api/search
- 链接检测代理：/api/check/links → so.252035.xyz/api/check/links
- 上游 API 返回非 JSON 时返回 502 JSON 错误

### 阶段二：前端 UI 设计

**设计系统 (ui-ux-pro-max)**
- 暗色背景 #0F172A，绿色强调 #22C55E
- Inter 字体，Exaggerated Minimalism 风格
- 卡片 hover 上浮 6px + 绿色阴影，300ms 过渡

**页面布局**
- 首页：豆瓣电影热榜 + 搜索框
- 搜索页：统计栏 + 选项卡 + 卡片列表
- Vue 3 哈希路由

### 阶段三：搜索功能

- 限制 cloud_types=quark,baidu
- 前端直连盘搜 API（CORS 开放）
- 后端代理备用（/api/pansou/search 转发）
- 非 JSON 容错：r.text() 再 JSON.parse()
- 统计栏：找到 N 个资源 | 用时 | 最后更新 | 重新检索
- 选项卡：全部 / 夸克网盘 / 百度网盘

### 阶段四：链接检测系统

**状态映射**

| API state | 内部状态 | 显示 | CSS | 排序 |
|-----------|---------|------|-----|------|
| ok | valid | ✓ 有效 | 绿色 | 0 |
| uncertain | uncertain | ? 不确定 | 灰色 | 1 |
| (无) | (无) | 无标记 | - | 2 |
| locked | locked | 🔒 需提取码 | 紫色 | 3 |
| unsupported | unsupported | ⚠ 不支持 | 暗灰 | 3 |
| bad | invalid | ✗ 失效 | 红色 | 4 |

**stateMap 演进**
- 第一版：只映射 ok→valid, bad→invalid
- 后端回退检测返回 state:valid 而非 state:ok，遗漏映射 → 全部显示不确定
- 修复：添加 valid:valid, invalid:invalid

**批量检测演化**
- V1：一次性全部发送 → 链接过多响应慢
- V2：双线程各取 5 个并发 → 竞态条件导致 checked > total
- V3（当前）：单线程每批 6 个串行 → 无竞态，安全

**检测流程**
搜索完成 → 1s 等待 → caa() 启动 → 收集全部链接 → 单线程每批 6 个 POST → 更新状态进度

**进度显示**
绿色进度条：检测 N/N · ✓N · ✗N

### 阶段五：卡片 UI

- @click.stop 防止双击
- 卡片标题无链接，仅"打开"按钮可跳转
- hover scale(1.02)
- 失效卡片 opacity:0.6 + scale(0.98)
- 排序：valid < uncertain < 无状态 < locked/unsupported < invalid
- 同权重按分享时间降序

### 阶段六：组件提取

**ResultCard 组件**
- app.component 注册
- &lt;template id="rc-tmpl"&gt; 存放 HTML
- Props: item, linkStatus, diskColors, diskNames, formatDate

**坑：驼峰属性问题**
- 浏览器将 :linkStatus 转为 :linkstatus → 组件收不到 prop
- 修复：使用 kebab-case :link-status="linkStatus"

**滑动动画 (FLIP)**
- 尝试 transition-group 实现 FLIP 动画
- 问题：组件渲染未完成时读取 DOM → getBoundingClientRect on null
- 当前：回退到普通 div，无滑动动画

## 文件结构

cloud-disk-search/
├── server.js              # Node.js 后端
├── package.json           # 项目配置
├── README.md              # 项目文档
├── docs/CHATLOG.md        # 开发日志
└── public/
    ├── index.html         # Vue 3 SPA
    └── vue.global.prod.js # Vue 3 库

## 启动方式

cd cloud-disk-search
node server/index.js
访问 http://localhost:3090

---

## 阶段七：管理后台系统 (Codex 追加)

### 管理后台页面
- 利用 Vue 3 CDN 独立 SPA（admin.html），暗色主题
- 功能：登录、夸克/百度 Cookie 管理、API 地址配置、缓存管理、修改密码
- 注意：`apply_patch` 工具会破坏非 ASCII 字符，每次写中文都会乱码
- 解决：使用 Node.js 脚本 + `\uXXXX` 或 `String.fromCharCode()` 构造中文
- 不要用 PowerShell `Get-Content` 读取含中文的文件再写回去（编码不一致会二次破坏）

### 数据库迁移 (Supabase PostgreSQL)
- 使用用户 Python 脚本的连接参数（pooler 地址 + `postgres.项目引用` 用户名）
- 连接：`host=aws-1-ap-southeast-1.pooler.supabase.com, user=postgres.ykrvvngruxvjddwloujx`
- 表结构：`app_config`, `admin_settings`, `encrypted_cookies`, `link_cache`
- 兼容两种模式：数据库连接失败时自动回退到 JSON 文件

### 转存服务 (Phase 3)
- 点击"打开"按钮 → 调用 `/api/transfer/save`
- 后端使用夸克 API 转存文件到站长网盘
- 检查缓存 → 转存 → 创建新分享链接 → 返回新链接
- 目前只实现了夸克，百度待接入

### 已知问题 / 注意事项

1. **乱码问题**：`apply_patch` 工具在写入文件时会破坏所有非 ASCII 字符（中文、特殊符号等）
   - 解决：使用 Node.js 脚本写文件（`fs.writeFileSync`），中文用 `\uXXXX` 转义或 `String.fromCharCode()`
   - 不要用 PowerShell `Get-Content` 读取含中文的文件再写回去
   
2. **进度条漏了 `display:block`**：`.dp-bar` 是 `<span>`，默认 inline，width 不生效
   - 进度条显示不出来是因为这个，加上 `display:block` 即可
   
3. **Vue 组件模板不能直接访问父作用域变量**
   - 组件模板只能用 props，不能直接用 `DC`、`D` 这种父作用域变量
   - 必须通过 `:disk-colors="diskColors"` 传 prop

4. **服务器重启后 token 失效**
   - 会话存在内存里，重启后需重新登录
   - `ap` 函数已加 401 自动跳登录逻辑

### 链接检测逻辑 (核心)

```
搜索完成 → 1s 后自动触发检测
  ↓
caa() 收集 gr.value 所有链接
  ↓
单线程每次 6 个
  ↓
POST /api/check/links (批量 6 个)
  ↓
返回后更新 6 个卡片状态 + 进度
  ↓
重复直到全部完成 (30 秒超时)
```

### 状态映射

| API state | 显示标签 | CSS 颜色 | 排序权重 |
|-----------|---------|----------|----------|
| ok | ✓ 有效 | 绿色 | 0 |
| uncertain | ? 不确定 | 灰色 | 1 |
| (无) | 无标记 | - | 2 |
| locked | 🔒 需提取码 | 紫色 | 3 |
| unsupported | ⚠ 不支持 | 暗灰 | 3 |
| bad | ✗ 失效 | 红色 | 4 |

排序规则：valid < uncertain < 无状态 < locked/unsupported < invalid
同权重按分享时间降序

### 进度条 CSS 要点

- `.detect-progress { width:100%; height:26px; }` — 必须在 flex 容器外或用 width:100%
- `.dp-bar { display:block; height:100%; }` — span 必须 display:block width 才生效
- `.dp-text { position:absolute; display:flex; }` — 文字居中覆盖在绿色条上
- `overflow:hidden` + `border-radius:13px` 做圆角裁剪

### 当前文件结构 (2026-07)

```
cloud-disk-search/
├── server/
│   ├── index.js         # 入口
│   ├── router.js        # 路由 + 中间件链
│   ├── middleware.js     # CORS / json / serveStatic
│   └── handlers/
│       ├── douban.js    # 豆瓣热榜
│       ├── pansou.js    # 盘搜搜索代理
│       ├── check.js     # 链接检测
│       ├── transfer.js  # 夸克转存
│       └── admin.js     # 后台管理 API
├── lib/
│   ├── storage.js       # JSON 读写 + 初始化
│   ├── crypto.js        # AES-256-GCM 加密 / scrypt
│   ├── auth.js          # Session 管理
│   └── quark.js         # 夸克 API 封装
├── public/
│   ├── index.html       # 前台 SPA
│   ├── admin.html       # 后台 SPA (quarkDir 已移除)
│   └── vue.global.prod.js
├── data/                # JSON 文件存储
├── docs/
│   ├── CHATLOG.md
│   ├── KNOWLEDGE_GRAPH.md
│   ├── OPTIMIZATION_PLAN.md
│   └── MODIFICATION_RECORD.md
├── restart.bat          # 双击重启
├── server.js.bak        # 原始单文件备份
├── package.json
└── README.md
```