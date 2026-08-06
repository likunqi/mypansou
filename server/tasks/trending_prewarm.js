// server/tasks/trending_prewarm.js — 定时预热首页热搜词缓存
// 纯数据库查询（search_keywords 表），毫秒级；每 30 分钟刷新 trending 缓存，
// 保证 getTrending 恒命中缓存（1ms 返回）
const { refreshTrending } = require("../handlers/hot");

async function run(config, task) {
  var startedAt = Date.now();
  var out = await refreshTrending(); // 失败会 throw，由 scheduler 捕获记 failed
  return {
    status: "ok",
    resultMsg: "热搜词缓存刷新 " + (out.terms || []).length + " 个（源 " + out.source + "）",
    durationMs: Date.now() - startedAt,
  };
}

module.exports = { run };
