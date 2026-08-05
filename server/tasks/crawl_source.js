// server/tasks/crawl_source.js — 采集源定时任务
// 任务类型 crawl_source：task_config = { source_id: N }（可选 page_start/page_end 覆盖）
// 执行时取该源全部解析规则 → crawler-engine.crawlSource → 写入资源库
// 与「采集管理」共用同一引擎与规则，规则与任务通过 source_id 天然关联
const store = require("../../lib/store");
const engine = require("../../lib/crawler-engine");

async function run(config) {
  var sourceId = parseInt(config && config.source_id, 10);
  if (!sourceId) return { status: "failed", error: "未配置 source_id" };

  var list = await store.crawlerSourceList(false);
  var source = null;
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(sourceId)) { source = list[i]; break; }
  }
  if (!source) return { status: "failed", error: "采集源 #" + sourceId + " 不存在或已删除" };
  if (source.status === 0) return { status: "failed", error: "采集源 #" + sourceId + " 已停用" };

  // 任务配置可覆盖页范围（不覆盖则用源默认）
  var ctx = { dryRun: false };
  var overrides = {};
  if (config.page_start) overrides.page_start = parseInt(config.page_start, 10);
  if (config.page_end) overrides.page_end = parseInt(config.page_end, 10);
  if (Object.keys(overrides).length) source = Object.assign({}, source, overrides);

  var rules = await store.crawlerRuleList(source.id);
  if (!rules || !rules.length) return { status: "failed", error: "采集源 #" + sourceId + " 没有解析规则" };

  var r = await engine.crawlSource(source, rules, ctx);
  if (r.status === "ok") {
    try {
      await store.crawlerSourceUpdate(source.id, { last_crawled_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
    } catch (e) {}
    return {
      status: "ok",
      resultMsg: "采集 #" + sourceId + " " + source.name + "：抓取 " + r.crawled + " 条，新增 " + r.inserted + " 条，跳过 " + r.skipped + " 条",
    };
  }
  return { status: "failed", error: r.error || "采集失败" };
}

module.exports = { run };
