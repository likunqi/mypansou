// server/tasks/douban_hotwords.js — 每日定时把豆瓣热榜电影/剧名 Top N 采集为热搜词
// 采集词标记 source='douban'（榜单排在手动词之后、用户搜索词之前），后台可停用/删除
const { getDoubanHot } = require("../handlers/douban");
const store = require("../../lib/store");

async function run(config, task) {
  var top = parseInt((config && config.top) || "10", 10);
  var startedAt = Date.now();
  var data = await getDoubanHot(); // 失败会 throw，由 scheduler 捕获记 failed
  var items = (data && data.items) || [];
  var titles = items.slice(0, top).map(function (m) { return (m.title || "").trim(); }).filter(Boolean);
  var inserted = 0;
  for (var i = 0; i < titles.length; i++) {
    try { await store.keywordCollect(titles[i], "douban"); inserted++; } catch (e) {}
  }
  return {
    status: inserted ? "ok" : "failed",
    resultMsg: "豆瓣热榜采集 " + inserted + "/" + titles.length + " 词" + (data.total !== undefined ? "（榜共 " + data.total + "）" : ""),
    durationMs: Date.now() - startedAt,
  };
}

module.exports = { run };
