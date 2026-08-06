// server/tasks/optimize_resources.js — 资源 AI 优化定时任务
// 策略：每次取「未优化」资源 batch_size 条（默认 100）逐个调 AI 清洗 标题/分类/标签
//  - 已优化（optimized=1）跳过；force 无效（定时任务只处理未优化，防重复烧 API）
//  - AI Key 未配置 → failed 并提示
//  - taskConfig.batch_size 可调每批数量；taskConfig.time 控制每日执行时间（调度器支持 HH:mm）
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");

async function run(taskConfig, task) {
  var ai = require("../handlers/ai");
  var batch = Math.min(Math.max(parseInt((taskConfig && taskConfig.batch_size) || 100, 10) || 100, 1), 200);
  var cfg = await store.getConfig();
  var ac = await ai.getAiConfig();
  if (!ac.key) return { status: "failed", error: "AI Key 未配置（数据源配置 → AI 配置），跳过优化" };

  var unopt = await mysql.query("SELECT id FROM resources WHERE status=1 AND optimized=0 ORDER BY id DESC LIMIT ?", [batch]);
  if (!unopt.length) return { status: "ok", resultMsg: "暂无未优化资源（全部已优化）" };

  var promptText = await ai.getEffectivePrompt("optimize");
  var done = 0, errs = [];
  for (var i = 0; i < unopt.length; i++) {
    var r = await store.resourceGet(unopt[i].id);
    if (!r || r.optimized === 1) continue;
    try {
      var userPrompt = "资源信息：\n标题：" + (r.title || "") + "\n描述：" + String(r.description || "").slice(0, 200) + "\n现有分类：" + (r.category || "") + "\n现有标签：" + (r.tags || "") + "\n链接：" + (r.url || "") + "\n\n请按系统要求输出优化后的 JSON。";
      var out = await ai.chat(ac, userPrompt, promptText);
      var obj = ai.extractJsonObject(out) || {};
      var fields = {};
      if (obj.title && String(obj.title).trim()) fields.title = String(obj.title).trim().slice(0, 256);
      if (obj.category && String(obj.category).trim()) fields.category = String(obj.category).trim().slice(0, 64);
      if (obj.tags) fields.tags = Array.isArray(obj.tags) ? obj.tags.join(",").slice(0, 256) : String(obj.tags).slice(0, 256);
      fields.optimized = 1;
      fields.optimized_at = new Date();
      await store.resourceUpdate(r.id, fields);
      done++;
    } catch (e) { errs.push(r.id + ": " + e.message); }
  }
  var rem = await mysql.query("SELECT COUNT(*) c FROM resources WHERE status=1 AND optimized=0");
  var resultMsg = "本批优化 " + done + " 条（目标 " + batch + "）" + (errs.length ? "，失败 " + errs.length + " 条" : "") + "，剩余未优化 " + rem[0].c + " 条（明日继续）";
  return { status: done ? "ok" : "failed", resultMsg: resultMsg, error: errs.length ? errs[0] : "" };
}

module.exports = { run };
