# 百度网盘 API 调研与可行性分析 (baidu_api)

> 生成日期: 2026-07-16
> 来源: 百度网盘开放平台官方文档 + GitHub 开源项目调研 + 逆向分析总结
> 目的: 评估在云盘搜项目中接入百度网盘转存的可行性

---

## 一、百度网盘开放平台官方 API 体系

百度网盘开放平台（https://pan.baidu.com/union/doc）提供多套 API 体系。

### 1.1 个人版 API（PCS API / xpan API）

| 项目 | 说明 |
|------|------|
| **认证** | OAuth 2.0（授权码模式/简化模式/设备码模式） |
| **Token 有效期** | Access Token 30 天，Refresh Token 长期有效 |
| **接口路径** | `https://pan.baidu.com/rest/2.0/xpan/...` |
| **调用限制** | 单应用每日 5,000 次，单 IP 每秒 3 次 |
| **适用场景** | 个人自动化备份、轻量级文件管理 |

**核心限制：**
- 必须走 OAuth 授权流程，需用户浏览器中登录百度账号授权
- 不支持直接用 Cookie 调用（与夸克不同）
- 旧版 PCS 接口（`/rest/2.0/pcs/`）已废弃，迁移至 xpan 接口

### 1.2 企业版 API

| 项目 | 说明 |
|------|------|
| **部署方式** | 支持私有化部署 |
| **权限控制** | 细粒度角色权限、操作审计日志 |
| **并发支持** | 企业级 QPS 无硬性限制 |
| **适用场景** | ERP/OA 系统集成 |
| **接入门槛** | 需提交企业资质审核，周期 1-2 周 |

### 1.3 MCP Server（2026 年新增）

百度网盘近期推出 MCP Server 支持，提供标准化 AI 代理接入。

| 项目 | 说明 |
|------|------|
| **协议** | Model Context Protocol (MCP) |
| **SDK** | Python SDK（Stdio 模式） |
| **能力** | 文件搜索、读取、管理 |
| **适用场景** | AI Agent 集成 |

---

## 二、核心 API 接口详解

### 2.1 认证与 Token 管理

#### 获取 Access Token

```
POST https://openapi.baidu.com/oauth/2.0/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "授权码（OAuth流程获取）",
  "client_id": "应用 API Key",
  "client_secret": "应用 Secret Key",
  "redirect_uri": "oob"
}
```

**返回字段：**
- `access_token`：调用凭证（有效期 30 天）
- `refresh_token`：长效刷新凭证（长期有效）
- `expires_in`：过期时间戳

#### 刷新 Token

```
POST https://openapi.baidu.com/oauth/2.0/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "当前 refresh_token",
  "client_id": "API Key",
  "client_secret": "Secret Key"
}
```

**注意：** 必须在 access_token 过期前刷新，否则需重新 OAuth 授权。

### 2.2 文件操作接口

#### 获取文件列表

```
GET https://pan.baidu.com/rest/2.0/xpan/file?method=list&access_token={token}&dir={路径}&order=time&desc=1&num=100&page=1
```

**关键参数：** dir（目标路径，以 / 开头）、recursion（0/1）、order（name/time/size）

**返回字段：** server_filename, fs_id（文件唯一ID）, path, size, isdir

#### 文件上传

```
# 预上传
GET https://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token={token}

# 分片上传（POST 到上传域名）
POST https://c.pcs.baidu.com/rest/2.0/pcs/file?method=upload&access_token={token}

# 合并分片创建文件
GET https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token={token}
```

大文件分片要求：单分片为 4MB 整数倍。

#### 文件下载

```
GET https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&access_token={token}&fsids=[{fs_id}]&dlink=1
```

返回 `list[].dlink` 为临时下载链接（10-30 分钟内有效）。

### 2.3 分享功能接口（新版，2026）

#### 创建分享链接

```
POST https://pan.baidu.com/share/set
Cookie: BDUSS={登录态}
Content-Type: application/x-www-form-urlencoded

schannel=4&fid_list=["{fs_id}"]&shareanony=0&pwd=1234&period=0
```

| 参数 | 说明 |
|------|------|
| schannel | 渠道标识，固定 4 |
| fid_list | JSON 数组格式的 fs_id 列表 |
| shareanony | 0=公开分享，1=私密分享 |
| pwd | 4 位提取码（私密分享时必填） |
| period | 有效期（0=永久，1=7天） |

**返回：** shorturl（短链接）、shareid、link

#### 分享转存（关键接口）

```
POST https://pan.baidu.com/share/transfer
Cookie: BDUSS={登录态}
Content-Type: application/x-www-form-urlencoded

shareid={shareid}&from={分享者UK}&fsidlist=[{fs_id1},{fs_id2}]&path={目标路径}
```

| 参数 | 说明 |
|------|------|
| shareid | 分享的任务 ID |
| from | 分享者的用户 UK |
| fsidlist | 要转存的文件 fs_id 列表（JSON 数组） |
| path | 转存到的目标路径 |

**返回：** `{errno:0, task_id:"...", task_info:"..."}`

#### 查询分享详情

```
GET https://pan.baidu.com/share/init?surl={短链接后缀}
```

返回分享文件列表、是否加密等信息。

---

## 三、BDUSS Cookie 方案（非官方路径）

### 3.1 原理

百度网盘 Web 端登录后生成关键 Cookie：

| Cookie | 说明 | 有效期 |
|--------|------|--------|
| **BDUSS** | 登录态主凭证，所有操作依赖 | 约 30 天 |
| **STOKEN** | 辅助验证 token | 与 BDUSS 绑定 |

非官方工具（如 BaiduPCS-Go）直接使用 BDUSS 调用内部 API，无需 OAuth。

### 3.2 优缺点分析

**优点：**
- 无需注册开放平台应用，无审批流程
- 接口响应更快（跳过 OAuth 层）
- BDUSS 可让用户手动粘贴，类似现有夸克 Cookie 方案

**缺点：**
- 非官方接口无 SLA 保障，百度随时可修改或封禁
- BDUSS 泄露可导致账号被盗
- 频率限制更严（单 IP 约 1-3 次/秒）

### 3.3 与夸克方案对比

| 维度 | 夸克 | 百度 |
|------|------|------|
| 官方 API 可用 | 无开放平台 | 有开放平台（需 OAuth） |
| 非官方 Cookie | 有效，API 稳定 | 有效，但风险更高 |
| 转存接口 | 有公开 save API | 内部接口 share/transfer |
| 被封风险 | 低 | 中高 |

---

## 四、GitHub 开源项目调研（2026-07）

### 4.1 命令行工具类

| 项目 | Stars | 语言 | 核心能力 |
|------|-------|------|---------|
| [qjfoidnh/BaiduPCS-Go](https://github.com/qjfoidnh/BaiduPCS-Go) | ⭐5306 | Go | 完整网盘操作，支持分享链接/秒传转存 |
| [GangZhuo/BaiduPCS](https://github.com/GangZhuo/BaiduPCS) | ⭐3543 | Go | 百度网盘命令行工具 |
| [komorebiCarry/BaiduPCS-Rust](https://github.com/komorebiCarry/BaiduPCS-Rust) | ⭐583 | Rust+Vue3 | 多线程下载、多账号管理、Web 管理、TOTP 双因素认证 |

**BaiduPCS-Go 转存流程（Go 参考实现）：**
```
1. 解析分享链接 -> 获取 shareid + uk
2. POST /share/transfer -> task_id
3. 轮询转存任务状态（约 2-10 秒）
4. 确认转存完成 -> 返回文件列表
```

### 4.2 API 封装库

| 项目 | Stars | 语言 | 核心能力 |
|------|-------|------|---------|
| [ly0/baidupcsapi](https://github.com/ly0/baidupcsapi) | ⭐1233 | Python | 完整 PCS API 封装，自动 Token 刷新 |
| [PeterDing/BaiduPCS-Py](https://github.com/PeterDing/BaiduPCS-Py) | ⭐866 | Python | API + App，文件管理/分享/离线下载 |
| [felixonmars/BaiduPCS-Go](https://github.com/felixonmars/BaiduPCS-Go) | ⭐964 | Go | iikira 原版备份 |

**baidupcsapi 典型用法：**
```python
from baidupcsapi import PCS
pcs = PCS("账号", "密码")  # 自动处理登录
pcs.upload("/目标路径", open("本地文件", "rb"), "文件名")
pcs.share("/文件路径", is_private=True, pwd="1234")
```

### 4.3 其他工具

| 项目 | Stars | 说明 |
|------|-------|------|
| [88250/baidu-netdisk-downloaderx](https://github.com/88250/baidu-netdisk-downloaderx) | ⭐481 | 图形界面不限速下载器（已停用） |
| [PeterDing/iScript](https://github.com/PeterDing/iScript) | ⭐5108 | 百度网盘相关脚本合集 |

### 4.4 生态总结

- **Go 生态最成熟**：BaiduPCS-Go 系列几乎覆盖所有网盘操作
- **Python 有完整封装**：baidupcsapi 可作参考实现
- **Rust 正在发展**：多线程下载 + Web 管理是亮点
- **Node.js 生态薄弱**：无成熟的百度网盘 SDK，需自行实现

---

## 五、项目接入方案评估

### 方案 A：非官方 BDUSS Cookie 方案（推荐）

**原理：** 复用现有夸克 Cookie 设计模式，用户在管理后台粘贴 BDUSS，后端通过内部 API 调用。

**预估转存流程（8 步，对标夸克）：**

```
1. parseUrl(url) -> shareid + uk + shortUrl
   正则匹配: /pan\.baidu\.com\/s\/([a-zA-Z0-9]+)/

2. getShareDetail(shortUrl, bduss)
   GET /share/init?surl={shortUrl}
   返回文件列表 [{fs_id, filename, size}]

3. ensureDir(bduss, "pansou", "/")
   查找或创建 "pansou" 目录 -> 返回 dirId

4. transferFiles(shareid, uk, fsids, targetDir, bduss)
   POST /share/transfer
   body: shareid={id}&from={uk}&fsidlist=[...]&path=/pansou/

5. queryTask(task_id, bduss)
   轮询转存任务状态（约 2-10 秒）

6. listFiles(targetDir, bduss)
   列出转存后的文件

7. createShare(fs_id, bduss)
   POST /share/set
   返回 shorturl

8. 返回新的分享链接 + 提取码
```

**预估改动范围：**
```
├── lib/baidu.js           # 新建：百度 API 封装（~200 行）
├── server/handlers/transfer.js  # 修改：添加百度转存分支（~50 行）
├── public/index.html      # 修改：弹窗百度分支逻辑（~20 行）
├── public/admin.html      # 修改：添加 BDUSS 输入框（~30 行）
└── docs/baidu_api.md      # 本文档
```

### 方案 B：官方 OAuth 方案

**优势：** 接口稳定、法律合规、支持 Token 自动刷新
**劣势：** 需注册应用（审核 1-3 天）、OAuth 需浏览器交互、无法实现"点击即转存"

### 方案 C：混合方案（推荐）

**第一阶段：** 实现方案 A（BDUSS Cookie），快速上线，体验与夸克一致
**第二阶段：** 根据反馈决定是否迁移到方案 B

---

## 六、BDUSS 获取与使用说明

### 获取方式

1. 浏览器打开 `https://pan.baidu.com` 并登录
2. 开发者工具 (F12) -> Application -> Cookies -> `pan.baidu.com`
3. 复制 `BDUSS` 的值
4. （可选）复制 `STOKEN`

### 安全要求

- BDUSS 拥有账号完整操作权限，泄露等同于账号被盗
- 建议使用百度小号
- 存储：AES-256-GCM 加密（与现有夸克 Cookie 一致）
- 不向前端传递明文 BDUSS

---

## 七、总结

### 与夸克流程的关键差异

| 步骤 | 夸克 | 百度 |
|------|------|------|
| 认证 | Cookie 直认 | BDUSS + STOKEN |
| 分享解析 | sharepage/token API | 解析分享页 HTML |
| 文件转存 | sharepage/save API | share/transfer API |
| 目录操作 | file API (drive-h) | xpan/file REST API |
| 创建分享 | share API (drive-pc) | share/set API |

### 主要风险

1. **接口稳定性：** 百度 Web 端更新频繁，内部接口可能变动
2. **频率限制：** 百度对非官方请求限流严格
3. **BDUSS 泄露：** 需向用户明确风险提示
4. **法律合规：** 非官方 API 违反百度开发者协议

### 最终结论

在当前项目架构下实现百度转存**技术上可行**。推荐采用 **BDUSS Cookie 方案（方案 A）**，与现有夸克方案设计模式完全一致，代码复用度高，预估完整实现约 300-400 行代码。如需更稳定的长期方案，可后续迁移至官方 OAuth。
