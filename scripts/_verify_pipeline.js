// scripts/_verify_pipeline.js — 三管道端到端自测（登录+提交+审核+搜索+导入+采集源CRUD）
// 用法: node scripts/_verify_pipeline.js  （自动清理测试数据，真实数据不受影响）
const BASE = "http://localhost:3090";
const N = String(Math.floor(Math.random() * 100000));

async function api(path, opts) {
  opts = opts || {};
  var res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  var txt = await res.text();
  var j; try { j = JSON.parse(txt); } catch (e) { j = txt; }
  return { status: res.status, body: j };
}

async function main() {
  var pass = 0, fail = 0;
  function t(name, cond, extra) {
    if (cond) { pass++; console.log("  PASS " + name); }
    else { fail++; console.log("  FAIL " + name + (extra ? " => " + JSON.stringify(extra) : "")); }
  }

  // 0. 登录
  var lg = await api("/api/admin/login", { method: "POST", body: { password: "admin123" } });
  var token = lg.body.token;
  t("登录", lg.status === 200 && !!token);
  var H = { Authorization: "Bearer " + token };

  // 1. submit 提交
  var sb = await api("/api/submit/resource", { method: "POST", body: {
    title: "测试提交" + N, url: "https://pan.quark.cn/s/test" + N, password: "abcd",
    disk_type: "quark", category: "测试", description: "自测数据", submitter_name: "tester" } });
  var subId = sb.body.id;
  t("submit 写入待审", sb.status === 200 && sb.body.ok && !!subId);

  // 2. 待审核列表
  var sl = await api("/api/admin/submissions?status=0", { headers: H });
  t("待审核列表", sl.status === 200 && Array.isArray(sl.body.items) && sl.body.items.length >= 1);

  // 3. 审核通过 → resources
  var ap = await api("/api/admin/submissions/" + subId + "/approve", { method: "POST", headers: H });
  var rid = ap.body.resource_id;
  t("审核通过转资源", ap.status === 200 && ap.body.ok && !!rid);

  // 4. 本地搜索（用标题片段）
  var kw = "测试提交" + N;
  var ls = await api("/api/search/local?kw=" + encodeURIComponent(kw));
  t("本地搜索命中", ls.status === 200 && ls.body.total >= 1 && ls.body.items[0].title.indexOf("测试提交") === 0);

  // 5. 资源列表（后台）
  var rl = await api("/api/admin/resources?kw=" + encodeURIComponent(kw), { headers: H });
  t("后台资源列表", rl.status === 200 && rl.body.total >= 1);

  // 6. 导入 upload + confirm
  var csv = "title,url,password,disk_type,category\n导入电影" + N + ",https://pan.quark.cn/s/imp" + N + ",8888,quark,电影\n导入书籍" + N + ",https://pan.quark.cn/s/imp2" + N + ",,baidu,图书";
  var up = await api("/api/admin/import/upload", { method: "POST", headers: H, body: { fileName: "test.csv", format: "csv", content: csv } });
  t("导入解析预览", up.status === 200 && up.body.stats.valid === 2 && up.body.preview.length === 2);
  var cf = await api("/api/admin/import/confirm", { method: "POST", headers: H, body: { token: up.body.token } });
  t("导入确认写入", cf.status === 200 && cf.body.ok && cf.body.imported === 2);

  // 7. 导入日志
  var il = await api("/api/admin/import/logs", { headers: H });
  t("导入日志", il.status === 200 && il.body.items.length >= 1 && il.body.items[0].imported_rows >= 2);

  // 8. crawler 采集源 CRUD + 规则
  var sa = await api("/api/admin/crawler/sources", { method: "POST", headers: H, body: {
    name: "测试RSS源" + N, source_type: "rss", url_template: "https://example.com/feed.xml", page_start: 1, page_end: 1 } });
  var srcId = sa.body.id;
  t("采集源新增", sa.status === 200 && !!srcId);
  var ra = await api("/api/admin/crawler/rules", { method: "POST", headers: H, body: {
    source_id: srcId, field_name: "title", rule_type: "regex", rule_value: "<title>([^<]+)</title>", required: 1 } });
  var ruleId = ra.body.id;
  t("规则新增", ra.status === 200 && !!ruleId);
  var rl2 = await api("/api/admin/crawler/rules?source_id=" + srcId, { headers: H });
  t("规则列表", rl2.status === 200 && rl2.body.items.length === 1);
  // 清理采集源（级联删规则）
  var sd = await api("/api/admin/crawler/sources/" + srcId + "/delete", { method: "POST", headers: H });
  t("采集源删除(级联规则)", sd.status === 200 && sd.body.ok);

  // 9. 驳回测试
  var sb2 = await api("/api/submit/resource", { method: "POST", body: { title: "待驳回" + N, url: "https://pan.quark.cn/s/rej" + N } });
  var rj = await api("/api/admin/submissions/" + sb2.body.id + "/reject", { method: "POST", headers: H, body: { remark: "测试驳回" } });
  t("审核驳回", rj.status === 200 && rj.body.ok);

  // 10. 反馈失效
  var rp = await api("/api/resources/" + rid + "/report", { method: "POST", body: { reason: "链接失效测试" } });
  t("失效反馈", rp.status === 200 && rp.body.ok);

  // 清理测试数据（仅删除本次创建的）
  if (rid) await api("/api/admin/resources/" + rid, { method: "DELETE", headers: H });
  var kw2 = "导入电影" + N;
  var l2 = await api("/api/admin/resources?kw=" + encodeURIComponent(kw2), { headers: H });
  for (var i = 0; i < l2.body.items.length; i++) await api("/api/admin/resources/" + l2.body.items[i].id, { method: "DELETE", headers: H });
  var l3 = await api("/api/admin/resources?kw=" + encodeURIComponent("导入书籍" + N), { headers: H });
  for (var j = 0; j < l3.body.items.length; j++) await api("/api/admin/resources/" + l3.body.items[j].id, { method: "DELETE", headers: H });
  console.log("  (测试数据已清理)");

  console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
