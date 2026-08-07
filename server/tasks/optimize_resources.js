// server/tasks/optimize_resources.js — 资源 AI 优化定时任务（含描述补全：豆瓣优先 + AI 兜底）
// 策略：每次取「未优化」资源 batch_size 条（默认 100）逐个处理：
//  1. 描述补全：description 为空 → 豆瓣搜索（j/subject_suggest + 移动版简介）→ 命中写豆瓣简介；
//     未命中 → AI 生成一句话简介；豆瓣限流（连续 3 次 error）→ 本批剩余跳过豆瓣全走 AI
//  2. AI 清洗 标题/分类/标签（原有逻辑）
//  - 已优化（optimized=1）跳过；AI Key 未配置 → failed 并提示
//  - taskConfig.batch_size / 描述开关 desc_fill（默认开）可调
const store = require("../../lib/store");
const mysql = require("../../lib/mysql");
const douban = require("../../lib/douban");

// 豆瓣请求间隔（防限流）
const DOUBAN_GAP_MS = 1500;

async function run(taskConfig, task) {
  var ai = require("../handlers/ai");
  var batch = Math.min(Math.max(parseInt((taskConfig && taskConfig.batch_size) || 100, 10) || 100, 1), 200);
  var descFill = (taskConfig && taskConfig.desc_fill !== undefined) ? !!taskConfig.desc_fill : true;
  var ac = await ai.getAiConfig();
  if (!ac.key) return { status: "failed", error: "AI Key 未配置（数据源配置 → AI 配置），跳过优化" };

  // 处理对象：未优化 或 无描述 的资源（描述补全不依赖优化状态）；跳过失效链接（link_valid=0）
  var unopt = await mysql.query(
    "SELECT id FROM resources WHERE status=1 AND (link_valid IS NULL OR link_valid=1) AND (optimized=0 OR description IS NULL OR TRIM(description)='') ORDER BY (description IS NULL OR TRIM(description)='') DESC, optimized ASC, id DESC LIMIT ?",
    [batch]);
  if (!unopt.length) return { status: "ok", resultMsg: "暂无未优化或缺失描述的资源（全部已处理）" };

  var promptText = await ai.getEffectivePrompt("optimize");
  var descPrompt = await ai.getEffectivePrompt("desc").catch(function () { return ""; });
  var done = 0, descFromDb = 0, descFromAi = 0, errs = [];
  var dbErrStreak = 0;

  for (var i = 0; i < unopt.length; i++) {
    var r = await store.resourceGet(unopt[i].id);
    if (!r) continue;
    if (r.optimized === 1 && String(r.description || "").trim()) continue; // 都处理过了
    try {
      var fields = {};
      var desc = String(r.description || "").trim();

      // ---- 1. 描述补全：豆瓣优先 + AI 兜底（仅描述为空时） ----
      if (descFill && !desc) {
        var db = null;
        if (dbErrStreak < 3) {
          db = await douban.enrich(r.title);
          if (db.ok) { desc = db.summary; descFromDb++; }
          else if (db.reason === "douban_error") { dbErrStreak++; }
          else { dbErrStreak = 0; } // 正常未命中，重置连续错误
          await new Promise(function (res) { setTimeout(res, DOUBAN_GAP_MS); }); // 豆瓣限流间隔
        }
        if (!desc && descPrompt && db && db.reason !== "douban_error") {
          try {
            var u = "资源标题：" + (r.title || "") + "\n分类：" + (r.category || "") + "\n标签：" + (r.tags || "") + "\n\n请生成一句简洁的资源简介（30-80 字，介绍内容类型与看点，不要编造具体情节细节）。";
            var o = await ai.chat(ac, u, descPrompt);
            var t = String(o || "").replace(/^["'“”\s]+|["'“”\s]+$/g, "").trim();
            if (t && t.length > 10) { desc = t.slice(0, 300); descFromAi++; }
          } catch (e) { errs.push(r.id + ":AI简介:" + e.message); }
        }
        if (desc) fields.description = desc;
      }

      // ---- 2. AI 清洗 标题/分类/标签（仅未优化时） ----
      if (r.optimized !== 1) {
        var userPrompt = "资源信息：\n标题：" + (r.title || "") + "\n描述：" + String(desc || "").slice(0, 200) + "\n现有分类：" + (r.category || "") + "\n现有标签：" + (r.tags || "") + "\n链接：" + (r.url || "") + "\n\n请按系统要求输出优化后的 JSON。";
        var out = await ai.chat(ac, userPrompt, promptText);
        var obj = ai.extractJsonObject(out) || {};
        if (obj.title && String(obj.title).trim()) fields.title = String(obj.title).trim().slice(0, 256);
        if (obj.category && String(obj.category).trim()) fields.category = String(obj.category).trim().slice(0, 64);
        if (obj.tags) fields.tags = Array.isArray(obj.tags) ? obj.tags.join(",").slice(0, 256) : String(obj.tags).slice(0, 256);
        fields.optimized = 1;
        fields.optimized_at = new Date();
      }
      if (!Object.keys(fields).length) continue;
      await store.resourceUpdate(r.id, fields);
      done++;
    } catch (e) { errs.push(r.id + ": " + e.message); }
  }
  var rem = await mysql.query(
    "SELECT COUNT(*) c FROM resources WHERE status=1 AND (link_valid IS NULL OR link_valid=1) AND (optimized=0 OR description IS NULL OR TRIM(description)='')");
  var dbDesc = descFill ? "，描述补" + (descFromDb + descFromAi) + " 条（豆瓣 " + descFromDb + "/AI " + descFromAi + "）" : "";
  var resultMsg = "本批处理 " + done + " 条（目标 " + batch + "）" + dbDesc + (errs.length ? "，失败 " + errs.length + " 条" : "") + "，剩余 " + rem[0].c + " 条（下轮继续）";
  return { status: done ? "ok" : "failed", resultMsg: resultMsg, error: errs.length ? errs[0] : "" };
}

module.exports = { run };
