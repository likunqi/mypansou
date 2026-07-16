# 百度网盘开放平台 API 接口文档

> 官方文档地址：[pan.baidu.com/union/doc](https://pan.baidu.com/union/doc/)

---

## 一、基础信息

### 1.1 请求基础地址

| 用途 | 地址 |
|------|------|
| REST 接口 | `https://pan.baidu.com/rest/2.0/xpan/` |
| 开放 API | `https://pan.baidu.com/api/` |
| OAuth 授权 | `https://openapi.baidu.com/oauth/2.0/` |

### 1.2 认证方式

所有接口需携带 `access_token`，通过 OAuth 2.0 授权获取：
- **授权码模式**：标准 Web 授权流程
- **简化模式**：适用于纯前端应用
- **设备码模式**：适用于无浏览器设备（IoT）

### 1.3 通用响应格式

```json
{
  "errno": 0,
  "request_id": "xxx",
  "error_msg": "succ"
}
```

### 1.4 通用错误码

| errno | 含义 |
|-------|------|
| 0 | 成功 |
| 110 | Access Token 无效或过期 |
| 1 | 服务器内部错误 |
| 2 | 参数错误 |
| 6 | 没有权限 |
| 9100 | 文件不存在 |
| 31034 | 命中高频限频 |
| 31101 | 上传文件大小超限 |

---

## 二、网盘基础服务 API

### 2.1 获取用户信息

获取授权用户的基本信息。

- **请求地址**：`GET https://pan.baidu.com/rest/2.0/xpan/device?method=iotqueryuinfo`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `access_token` | 是 | string | OAuth 授权令牌 |
| `device_id` | 是 | string | 设备 ID（IOT 设备场景） |

- **响应示例**：

```json
{
  "request_id": "674030589892501935",
  "error_code": 0,
  "error_msg": "succ",
  "data": {
    "has_privilege": 1,
    "is_svip": 1,
    "is_iot_svip": 0,
    "start_time": 1700000000,
    "end_time": 1730000000,
    "now": 1715000000
  }
}
```

### 2.2 获取网盘容量信息

查询用户网盘的总容量、已用空间、剩余空间。

- **请求地址**：`GET https://pan.baidu.com/api/quota`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `access_token` | 是 | string | OAuth 授权令牌 |
| `checkfree` | 否 | int | 是否检查免费容量 |
| `checkexpire` | 否 | int | 是否检查到期时间 |

- **请求示例**：

```bash
curl -L -X GET 'https://pan.baidu.com/api/quota?access_token=YOUR_ACCESS_TOKEN&checkfree=1&checkexpire=1' \
-H 'User-Agent: pan.baidu.com'
```

- **响应示例**：

```json
{
  "errno": 0,
  "total": 2205465706496,
  "free": 2205465706496,
  "request_id": 4890482559098510375,
  "expire": false,
  "used": 686653888910
}
```

### 2.3 获取文件信息

#### 2.3.1 获取文件列表

- **请求地址**：`GET https://pan.baidu.com/rest/2.0/xpan/file?method=list`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `access_token` | 是 | string | 授权令牌 |
| `dir` | 是 | string | 目录路径，如 `/` |
| `start` | 否 | int | 起始位置，默认 0 |
| `limit` | 否 | int | 数量限制，默认 100，最大 1000 |
| `order` | 否 | string | 排序字段：`name`/`time`/`size` |
| `desc` | 否 | int | 降序：1 降序，0 升序 |
| `web` | 否 | int | 传 1 可获取缩略图地址 |

#### 2.3.2 递归获取文件列表

- **请求地址**：`GET https://pan.baidu.com/rest/2.0/xpan/file?method=listall`
- **参数**：与获取文件列表相同，会递归遍历子目录

#### 2.3.3 搜索文件（关键词搜索）

- **请求地址**：`GET https://pan.baidu.com/rest/2.0/xpan/file?method=search`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `access_token` | 是 | string | 授权令牌 |
| `key` | 是 | string | 搜索关键词 |
| `dir` | 否 | string | 搜索范围目录 |
| `recursion` | 否 | int | 是否递归：1 是，0 否 |
| `start` | 否 | int | 起始位置 |
| `limit` | 否 | int | 数量限制 |

#### 2.3.4 搜索文件（语义搜索）

基于语义理解的自然语言搜索，需要智能服务权限。

#### 2.3.5 查询文件信息

- **请求地址**：`GET https://pan.baidu.com/rest/2.0/xpan/file?method=filemetas`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `fsids` | 是 | string | 文件 fsid 列表，逗号分隔，最多 100 个 |
| `thumb` | 否 | int | 是否需要缩略图，1 需要 |

#### 2.3.6 获取分类文件列表

通过 `method` 参数区分分类：

| method | 说明 |
|--------|------|
| `categoryimagelist` | 获取图片列表 |
| `categoryvideolist` | 获取视频列表 |
| `categorydoclist` | 获取文档列表 |
| `categorybtlist` | 获取 BT 列表 |

参数：`start`（起始位置）、`limit`（数量限制）

#### 2.3.7 获取分类文件总个数

- **请求地址**：`GET https://pan.baidu.com/rest/2.0/xpan/file?method=categorycount`

### 2.4 文件操作 API

#### 2.4.1 创建文件夹

- **请求地址**：`POST https://pan.baidu.com/rest/2.0/xpan/file?method=create`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `path` | 是 | string | 文件夹完整路径 |
| `isdir` | 是 | string | 固定值 `"1"` |
| `size` | 否 | string | 固定值 `""` |
| `block_list` | 否 | string | 固定值 `"[]"` |

#### 2.4.2 文件上传（分片上传三步）

**第一步：预上传（precreate）**

- **请求地址**：`POST https://pan.baidu.com/rest/2.0/xpan/file?method=precreate`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `path` | 是 | string | 文件存储路径（含文件名） |
| `size` | 是 | bigint | 文件大小（字节） |
| `isdir` | 否 | string | `"0"` |
| `autoinit` | 否 | int | 是否自动初始化分片上传，默认 1 |
| `block_list` | 是 | string[] | 各分片 MD5 数组的 JSON 字符串 |
| `content_md5` | 否 | string | 文件整体 MD5 |
| `slice_md5` | 否 | string | 分片 MD5 |
| `local_ctime` | 否 | string | 文件创建时间戳 |
| `local_mtime` | 否 | string | 文件修改时间戳 |

**第二步：分片上传（upload）**

- **请求地址**：`POST https://pan.baidu.com/rest/2.0/xpan/file?method=upload`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `uploadid` | 是 | string | 预上传返回的上传 ID |
| `partseq` | 是 | int | 分片序号（从 0 开始） |
| `path` | 是 | string | 文件路径 |

请求体为分片的二进制内容。

**第三步：上传完成（create）**

- **请求地址**：`POST https://pan.baidu.com/rest/2.0/xpan/file?method=create`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `uploadid` | 是 | string | 上传 ID |
| `path` | 是 | string | 文件路径 |
| `size` | 是 | bigint | 文件总大小 |
| `block_list` | 是 | string[] | 各分片 MD5 数组的 JSON 字符串 |
| `isdir` | 否 | string | `"0"` |

#### 2.4.3 文件下载

- **请求地址**：`GET https://pan.baidu.com/rest/2.0/xpan/file?method=download`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `fsid` | 是 | bigint | 文件 fsid |
| `path` | 否 | string | 文件路径（与 fsid 二选一） |

返回一个 `dlink`（下载直链），需携带 access_token 访问。

#### 2.4.4 文件拷贝 / 移动 / 重命名

统一接口，通过 `opera` 参数区分：

| opera | 说明 |
|-------|------|
| `copy` | 拷贝 |
| `move` | 移动 |
| `rename` | 重命名 |

- **请求地址**：`POST https://pan.baidu.com/rest/2.0/xpan/file?method=filemanager`
- **拷贝/移动参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `opera` | 是 | string | 操作类型：`copy`/`move` |
| `filelist` | 是 | string | JSON 数组：`[{"path":"源路径","dest":"目标路径","newname":"新文件名"}]` |
| `ondup` | 否 | string | 重名处理：`overwrite`/`fail`/`newcopy` |

- **重命名参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `opera` | 是 | string | `rename` |
| `filelist` | 是 | string | JSON 数组：`[{"path":"文件路径","newname":"新文件名"}]` |

#### 2.4.5 文件删除

- **请求地址**：`POST https://pan.baidu.com/rest/2.0/xpan/file?method=filemanager`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `opera` | 是 | string | 固定值 `delete` |
| `filelist` | 是 | string | JSON 数组，如 `[{"path":"/a.txt"}]` |

#### 2.4.6 回收站

| 接口 | 请求地址 | 说明 |
|------|----------|------|
| 列举回收站 | `GET ...?method=listrecursion` + `recycle=1` | 查看回收站文件 |
| 还原文件 | `POST ...?method=filemanager` + `opera=restore` | 从回收站恢复 |

### 2.5 文件分享 API

#### 2.5.1 创建分享

- **请求地址**：`POST https://pan.baidu.com/share/set?channel=chunlei&web=1&app_id=xxx`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `period` | 是 | int | 有效期：1=1天，7=7天，365=永久 |
| `password` | 否 | string | 提取码，不传则随机生成 |
| `fid_list` | 是 | string | JSON 数组，文件 fsid 列表 |

#### 2.5.2 列举分享

- **请求地址**：`GET https://pan.baidu.com/share/list?channel=chunlei`
- **参数**：`page` / `num`（分页）

#### 2.5.3 删除分享

- **请求地址**：`POST https://pan.baidu.com/share/cancel?channel=chunlei`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `shareid_list` | 是 | string | JSON 数组，分享 ID 列表 |

#### 2.5.4 保存分享文件（转存）

- **请求地址**：`POST https://pan.baidu.com/rest/2.0/xpan/share?method=transfer`
- **参数**：

| 参数名 | 必填 | 类型 | 说明 |
|--------|------|------|------|
| `shareid` | 是 | string | 分享 ID |
| `from` | 是 | string | 分享者 UK |
| `fsidlist` | 是 | string | JSON 数组，要转存的 fsid |
| `path` | 是 | string | 转存到目标路径 |

#### 2.5.5 分享详情 & 验证分享

| 接口 | 请求地址 |
|------|----------|
| 分享详情 | `GET https://pan.baidu.com/share/detail?shareid=xxx` |
| 验证分享 | `POST https://pan.baidu.com/share/verify?shareid=xxx` |

---

## 三、网盘高级服务 API

### 3.1 秒传

自动检测，当预上传时发现服务端已有相同内容文件时，自动秒传，无需实际传输数据。

### 3.2 离线下载

| 接口 | 方法 | 说明 |
|------|------|------|
| 新增离线下载 | POST | 提交下载任务（HTTP/FTP/BT/磁力链） |
| 查询离线下载 | GET | 查询单个任务状态 |
| 批量查询离线下载 | GET | 查询多个任务状态 |

### 3.3 订阅管理

| 接口 | 说明 |
|------|------|
| 查询订阅关系 | 查询用户已订阅的发布方 |
| 新增订阅 | 订阅某个发布方 |
| 取消订阅 | 取消订阅 |
| 订阅发布方查询 | 查看发布方的文件列表 |

### 3.4 实时推送（SSE）

基于 Server-Sent Events 的长连接推送：
- **长连接订阅**：建立 SSE 连接，接收文件变更事件
- **长连接变更**：文件增删改时推送通知

### 3.5 消息通知

| 接口 | 说明 |
|------|------|
| 订阅消息 | 订阅消息模板 |
| 查询消息 | 查询消息记录 |
| 消息签署 | 对消息内容进行签名/验签 |

---

## 四、网盘特权服务 API

### 4.1 群组服务

| 接口 | 说明 |
|------|------|
| 群组关系维护 | 创建/加入/退出群组 |
| 群组文件消费 | 群组内文件的读取与操作 |

### 4.2 文件云解压

- **请求地址**：`POST https://pan.baidu.com/rest/2.0/xpan/file?method=zipdecompress`
- **参数**：

| 参数名 | 必填 | 说明 |
|--------|------|------|
| `filepath` | 是 | 压缩包路径 |
| `destpath` | 是 | 解压目标目录 |
| `filelist` | 是 | 需解压的文件列表 |

### 4.3 文档处理服务（需特权）

支持文档在线预览、格式转换等。

### 4.4 智能化

| 接口 | 说明 |
|------|------|
| 音频转文稿任务提交 | 提交音频文件进行语音转文字 |
| 音频转文稿任务查询 | 查询转写任务进度和结果 |

---

## 五、AI 创作能力 API

### 5.1 智能 PPT

| 接口 | 说明 |
|------|------|
| 获取 PPT 模板 | 获取可用模板列表 |
| PPT 大纲生成 | 根据主题/文本生成 PPT 大纲 |
| 智能 PPT 接口说明 | 基于大纲生成完整 PPT |

### 5.2 人像美化

| 接口 | 说明 |
|------|------|
| 提交人像美化任务 | 提交需要美化的图片 |
| 查询人像美化任务 | 查询美化任务状态 |
| 人物美化回调 | 任务完成后的回调通知 |

### 5.3 AI 笔记

| 接口 | 说明 |
|------|------|
| 提交 AI 视频笔记任务 | 对视频内容生成结构化笔记 |
| 查询 AI 视频笔记任务 | 查询笔记生成进度 |

### 5.4 音视频理解

| 接口 | 说明 |
|------|------|
| 离线音视频转写 | 将音视频转为文字稿 |
| AI 纪要 | 对会议录音生成纪要 |

### 5.5 文档扫描

| 接口 | 说明 |
|------|------|
| 扫描滤镜 | 文档图片扫描增强处理 |

---

## 六、Agent 能力

| 接口 | 说明 |
|------|------|
| GenFlow 简介 | 百度网盘提供的 Agent 编排框架，支持创建、部署 AI 工作流 |
| GenFlow 接入 | Agent 能力接入指南 |

---

## 七、智能小程序 API

支持在百度网盘内运行小程序，提供：
- **基础 API**：界面交互、数据缓存、网络请求、路由跳转、设备信息等
- **网盘联动 API**：选择文件/图片、文件分享、转存、支付收银台等
- **支付系统**：收银台支付（端组件 / H5）、支付回调、订单查询、退款

---

## 八、开发工具

| 工具 | 地址/说明 |
|------|-----------|
| Python SDK | `pip install baidupcsapi` |
| PHP SDK | 官方提供 |
| Android SDK | 支持基础模块/文件操作/文件预览/上传/下载/备份/音视频 |
| iOS SDK | 支持基础模块/文件下载/文件上传/自动备份/文档预览/音视频 |
| Go SDK | [github.com/baidu-netdisk/baidu-drive-sdk-go](https://github.com/baidu-netdisk/baidu-drive-sdk-go) |

---

> 注：以上内容均来源于 [百度网盘开放平台官方文档](https://pan.baidu.com/union/doc/)。部分高级能力（群组、特权服务、AI 创作）需要应用上线审核通过并具备相应权限方可调用。
