# 云盘搜 · 重要事项清单（怕忘版）

> 最后更新：2026-08-07 ｜ 当前线上版本：commit `874b531`（8-07 上线加固版，已部署）
> 完整开发记录见 `.workbuddy/memory/` 日志；部署细节见 `docs/DOCKER_DEPLOY.md`

---

## 一、🚨 最紧急 · 上线后必做

1. **去后台改管理员密码**：登录框占位符已从 `admin123` 改成「登录密码」，但**密码本身还是初始的**。登录 `admin.html` → 设置里「修改密码」。这是当前唯一没堵上的安全口。
2. **登录有锁**：同一个 IP 10 分钟内输错 5 次 → 锁 15 分钟（HTTP 429）。忘记密码**别硬试**，等 15 分钟或换个网络。
3. **token 7 天过期**：后台登录状态 7 天失效要重新登录，不是 bug。

---

## 二、接口限流表（429 了先看这个）

规则：**每 IP 每分钟计数**，超了返回 `HTTP 429` + `retryAfter`，1 分钟后自动恢复。纯内存实现，重启进程清零。

| 接口 | 用途 | 阈值 |
|---|---|---|
| `POST /api/transfer/save` | 夸克转存 | **5/min**（最怕被刷，消耗账号配额） |
| `POST /api/submit/resource` | 提交资源 | 5/min |
| `POST /api/feedback` | 失效反馈 | 10/min |
| `POST /api/check/*` | 链接检测 | 20/min |
| `POST /api/search/record` | 搜索记录 | 30/min |
| `GET /api/pansou/*` | 搜索代理 | 60/min |
| `POST /api/admin/login` | 后台登录 | 10min 内错 5 次锁 15min |

想调阈值：改 `server/router.js` 里的 `lim` 配置（写死），或后续做后台配置化。

---

## 三、采集任务排期（8-07 改过，重要）

**54 个采集源已配固定时间错峰：每天 06:00 起每 2 分钟一个（06:00 ~ 07:46）**，不再 24h 漂移。

| 任务 | 频率 | 时间 |
|---|---|---|
| crawl_source（54 个源） | 每日 | **06:00 起错峰** |
| cleanup（夸克目录清理） | 每日 | 03:00 |
| check_resources（链接重测） | 每日 | 03:30 |
| douban_hotwords（豆瓣热词） | 每日 | 08:00 |
| optimize_resources（AI 优化） | 每 10 分钟 | 持续 |
| trending_prewarm（热榜预热） | 每 30 分钟 | 持续 |

⚠️ **别在后台一次手动点十几个源**：并发触发 TG 频道 RSS 限流（HTTP 429），昨晚 50+ 条 failed 就是这么来的。要手动验证一次点 1~2 个。

⚠️ 时区：服务器/容器已是 CST（Asia/Shanghai），排期按北京时间。

---

## 四、部署上线流程（含踩过的坑）

```bash
# 1. 改代码 → 本地验证：node --check + 起服务 curl 各页面
# 2. 提交推送（中文 commit 用文件）
git add ... && git commit -F _commit_msg.txt
git -c http.proxy=socks5://127.0.0.1:10808 -c https.proxy=socks5://127.0.0.1:10808 push origin main

# 3. 打包（注意！产物是【未压缩 tar】）
git archive -o /tmp/yps.tar HEAD

# 4. 上传 + 解压（坑：必须 tar -xf，不能 -xzf！）
#    -xzf 会报 "not in gzip format" 静默失败，等于没部署
sudo tar -xf /tmp/yps.tar -C /opt/yunpansou

# 5. 重建容器
echo '密码' | sudo -S docker compose --project-directory /opt/yunpansou \
  -f /opt/yunpansou/docker-compose.yml up -d --build
```

**部署后必验三连**（缺一不可，否则可能跑旧代码）：
1. `docker inspect yunpansou --format '{{.State.StartedAt}}'` → 时间要是刚才
2. `docker exec yunpansou grep -c sitemap /app/server/router.js` → 有新版代码特征
3. `wget http://localhost:3090/` → 200

服务器已自动备份旧版到 `/opt/yunpansou_backup_*.tar.gz`（每次部署第一步生成）。

---

## 五、日常运维速查

```bash
# 服务器 SSH：likunqi@192.168.1.65（密码同 sudo 密码）
# 看容器状态/日志
echo '密码' | sudo -S docker ps --filter name=yunpansou
echo '密码' | sudo -S docker logs --tail 100 yunpansou 2>&1 | grep scheduler
# 重启容器
echo '密码' | sudo -S docker restart yunpansou
# 查任务排期/执行日志（本机直接查 NAS 库）
node -e "const m=require('./lib/mysql');m.query('SELECT task_type,next_run_at,last_run_at FROM scheduled_tasks WHERE status=1 LIMIT 10').then(r=>{r.forEach(x=>console.log(x.task_type,x.next_run_at));process.exit(0)})"
```

**要点**：Docker 容器连 MySQL 必须用 `172.17.0.1`（docker0 网关），用宿主内网 IP 会被 1Panel 防火墙拦。

---

## 六、待办（还没做的）

- [ ] **改后台密码**（第一优先）
- [ ] **手机端断点优化**：方案 = 先出线框草图给用户确认再动手（用户习惯）
- [ ] 前台主题机制（后台站点设置加「前台主题」下拉）——拖了很久
- [ ] 观察 check_resources 重测"网络异常跳过"率偏高（容器出网问题？）
- [ ] 限流阈值后台配置化（可选）
- [ ] 前台 AI 帮找 / 新搜索源（候选）

---

## 七、关键信息备忘

| 项 | 值 |
|---|---|
| 本地入口 | `node server/index.js`，端口 3090 |
| 重启本地 | 全杀 node 再启（残留 node 占端口是"重启无效"头号原因） |
| NAS MySQL | `192.168.1.65:3306/pansou`（pansou/Srcloud@216，19 表） |
| Docker 部署 | 192.168.1.65 → /opt/yunpansou，容器 yunpansou |
| 域名/HTTPS | Cloudflare Tunnel 已配好（用户已搞定，**勿动**） |
| GitHub | likunqi/mypansou（main）；push 走 socks5://127.0.0.1:10808 代理 |
| 后台地址 | /admin.html，登录 admin123（**待改**） |
