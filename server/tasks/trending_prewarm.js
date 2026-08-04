// server/tasks/trending_prewarm.js — 定时预热首页热门推荐缓存
// 盘搜 API 实时采集约 2.5s，用户访问时再采会卡首页；本任务每 30 分钟后台刷新 trending.json，
// 保证 getTrending 恒命中缓存（1ms 返回），服务重启后也由首次任务快速补上
const { refreshTrending } = require("../handlers/hot");

async function run(config, task) {
  var startedAt = Date.now();
  var out = await refreshTrending(); // 失败会 throw，由 scheduler 捕获记 failed
  return {
    status: "ok",
    resultMsg: "热门推荐缓存刷新 " + (out.items || []).length + " 条（源 " + out.source + "）",
    durationMs: Date.now() - startedAt,
  };
}

module.exports = { run };
