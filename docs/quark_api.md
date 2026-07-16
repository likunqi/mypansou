# 夸克网盘 API 文档 (quark_api)

> 基于逆向分析总结，时效性 2026-07。夸克未提供官方公开 API，接口可能随时变更。

---

## 接口基础

| 项目 | 说明 |
|------|------|
| **Host** | `drive-pc.quark.cn`（分享操作）/ `drive-h.quark.cn`（其他操作） |
| **Base Path** | `/1/clouddrive/` |
| **认证** | Cookie（登录夸克网页版后从浏览器复制） |
| **User-Agent** | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36` |
| **Content-Type** | `application/json` |
| **Accept** | `application/json, text/plain, */*` |
| **公共参数** | `pr=ucpro&fr=pc&__t={timestamp}`（时间戳防缓存） |

### Cookie 有效期
- 通常 7-30 天，过期后需重新登录获取
- 同一 Cookie 不要在多处同时使用（会被踢下线）

### 频率限制
- 单账号每秒约 5-10 次请求，超限返回 429
- 批量操作建议间隔 1-2 秒

---

## 一、分享相关 API

### 1.1 创建分享链接

创建文件分享链接，返回异步任务 ID，轮询任务完成后通过 /share/mypage/detail 获取真实分享 URL。

**请求**

| 项目 | 值 |
|------|-----|
| 方法 | POST |
| Host | `drive-pc.quark.cn` |
| 路径 | `/1/clouddrive/share` |

**请求头**

```
Cookie: {完整的夸克 Cookie 字符串}
Content-Type: application/json
Accept: application/json, text/plain, */*
```

**请求体**

```json
{
  "fid_list": ["{文件ID}"],
  "pwd_id": "",
  "url_type": 1,
  "expired_type": 1,
  "stoken": ""
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| fid_list | string[] | 是 | 要分享的文件/文件夹 ID 列表 |
| pwd_id | string | 是 | 首次创建传空字符串 |
| url_type | number | 是 | 1=公开分享，2=私密分享（需提取码） |
| expired_type | number | 是 | 1=永久有效，2=7天有效 |
| stoken | string | 是 | 首次创建传空字符串 |
| pwd | string | 否 | 仅私密分享时需设 4 位数字提取码 |

**返回**

```json
{
  "status": 200,
  "code": 0,
  "data": {
    "task_id": "{任务ID}",
    "task_sync": false
  }
}
```

---

### 1.2 获取分享详情（列表）

获取用户所有分享列表，可按 `share_id` 筛选找到刚创建的分享链接。

**请求**

| 项目 | 值 |
|------|-----|
| 方法 | GET |
| Host | `drive-pc.quark.cn` |
| 路径 | `/1/clouddrive/share/mypage/detail` |
| 参数 | `pr=ucpro&fr=pc&uc_param_str=&share_id={share_id}` |

> 注：`share_id` 参数传入后实际返回的是完整列表，非单条详情。需要遍历 `data.list` 按 `share_id` 匹配。

**返回**

```json
{
  "status": 200,
  "code": 0,
  "data": {
    "list": [
      {
        "share_id": "{UUID}",
        "pwd_id": "{12位短码}",
        "share_url": "https://pan.quark.cn/s/{12位短码}",
        "url_type": 1,
        "expired_type": 1,
        "created_at": 1764648528405,
        "status": 3,
        "audit_status": 4,
        "first_fid": "{文件ID}",
        "file_num": 1,
        "stoken": "{分享令牌}",
        "title": "{分享标题}",
        "click_pv": -1,
        "save_pv": 0,
        "size": 23097710456
      }
    ]
  }
}
```

**关键字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| data.list[].share_id | string | 内部分享 UUID |
| data.list[].pwd_id | string | 12位短码（share_url 中的 ID） |
| data.list[].share_url | string | 最终分享链接 |
| data.list[].first_fid | string | 被分享文件的 fid |
| data.list[].stoken | string | 分享的 stoken（用于 token 接口验证） |
| data.list[].created_at | number | 创建时间（毫秒时间戳） |

---

### 1.3 获取分享 token

获取访问某个分享链接所需的 stoken。

**请求**

| 项目 | 值 |
|------|-----|
| 方法 | POST |
| Host | `drive-h.quark.cn` |
| 路径 | `/1/clouddrive/share/sharepage/token` |

**请求体**

```json
{
  "pwd_id": "{分享链接中的12位短码}",
  "passcode": "{提取码（无提取码则传空串）}"
}
```

**返回**

```json
{
  "status": 200,
  "data": {
    "stoken": "{stoken}"
  }
}
```

---

### 1.4 获取分享详情

获取分享链接内的文件列表。

**请求**

| 项目 | 值 |
|------|-----|
| 方法 | GET |
| Host | `drive-h.quark.cn` |
| 路径 | `/1/clouddrive/share/sharepage/detail` |
| 参数 | `pr=ucpro&fr=pc&pwd_id={短码}&stoken={stoken}` |

---

### 1.5 转存文件

将他人分享的文件保存到自己的网盘。

**请求**

| 项目 | 值 |
|------|-----|
| 方法 | POST |
| Host | `drive-h.quark.cn` |
| 路径 | `/1/clouddrive/share/sharepage/save` |

**请求体**

```json
{
  "fid_list": ["{文件ID}"],
  "fid_token_list": ["{文件token}"],
  "to_pdir_fid": "{目标目录ID}",
  "pwd_id": "{12位短码}",
  "stoken": "{stoken}"
}
```

---

## 二、文件相关 API

### 2.1 获取文件列表

**请求**

| 项目 | 值 |
|------|-----|
| 方法 | GET |
| Host | `drive-h.quark.cn` |
| 路径 | `/1/clouddrive/file` |
| 参数 | `pr=ucpro&fr=pc&pdir_fid={目录ID}&size=100&__t={timestamp}` |

**返回**：`data.list[]` 每个元素包含 `fid`、`file_name`、`file_type`、`size`、`created_at`、`updated_at`、`dir` 等字段。

### 2.2 创建目录

**请求**

| 项目 | 值 |
|------|-----|
| 方法 | POST |
| Host | `drive-h.quark.cn` |
| 路径 | `/1/clouddrive/file` |

**请求体**

```json
{
  "pdir_fid": "{父目录ID（根目录为0）}",
  "file_name": "新文件夹名称",
  "dir_init_lock": false
}
```

**返回**：`data.fid`（新目录的文件 ID）

### 2.3 文件排序列表

**请求**

| 项目 | 值 |
|------|-----|
| 方法 | GET |
| Host | `drive-pc.quark.cn` |
| 路径 | `/1/clouddrive/file/sort` |
| 参数 | `pr=ucpro&fr=pc&uc_param_str=&pdir_fid={目录ID}` |

---

## 三、异步任务 API

### 3.1 查询任务状态

**请求**

| 项目 | 值 |
|------|-----|
| 方法 | GET |
| Host | `drive-h.quark.cn` |
| 路径 | `/1/clouddrive/task` |
| 参数 | `pr=ucpro&fr=pc&task_id={任务ID}&retry_index={重试次数}&__t={timestamp}` |

**返回**：`data.status` 为 2 表示任务完成。任务结果根据 `task_type` 不同包含不同字段：
- `task_type: 8`（分享）→ 结果包含 `share_id`、`share`、`creation_snapshot`

---

## 四、注意事项

### 4.1 Host 选择

| Host | 用途 |
|------|------|
| `drive-pc.quark.cn` | 分享创建、分享列表、文件排序 |
| `drive-h.quark.cn` | 文件列表、文件操作、分享 token/detail/save、任务查询 |

> `drive-h.quark.cn` 上的创建分享接口虽然也能返回 task_id，但任务完成后的分享不会出现在分享列表中。**创建分享必须在 `drive-pc.quark.cn` 上操作。**

### 4.2 常见错误码

| code | message | 说明 |
|------|---------|------|
| 31001 | require login | Cookie 失效或未登录 |
| 41006 | 分享不存在 | 分享链接已失效或 pwd_id 错误 |
| 405 | Method Not Allowed | 接口不支持该请求方法 |
| 404 | Not Found | 接口路径不存在 |

### 4.3 分享创建完整流程

```
POST /share (drive-pc.quark.cn)
  │
  ├─ 返回 share_id + share_url → 直接使用（旧 API，偶现）
  │
  └─ 返回 task_id → 异步任务
       │
       GET /task 轮询 (drive-h.quark.cn)
       │
       └─ task.status === 2 → 任务完成，拿到 share_id
            │
            GET /share/mypage/detail (drive-pc.quark.cn)
            │
            └─ 遍历 data.list，按 share_id 匹配 → 返回 share_url
```
