// server/handlers/tg.js — TG 频道采集（主力）管理
// 全局设置（RSSHub 实例/limit/间隔）+ 批量添加频道（自动套 TG 通用规则模板）+ TG 源列表
const { json, readBody } = require("../middleware");
const store = require("../../lib/store");

// TG 通用解析规则模板（全频道通用，已用 okpojie 真实 XML 实测）
// url 只匹配夸克/百度盘链接（用户主力盘）；将来要接阿里影视频道时扩展 alipan/aliyun
const TG_RULES = [
  { field_name: "title", rule_type: "regex", rule_value: "<title>(.*?)</title>", required: true },
  { field_name: "url", rule_type: "regex", rule_value: "https://pan\\.(?:quark\\.cn|baidu\\.com)/s/[A-Za-z0-9_-]+", required: true },
  { field_name: "disk_type", rule_type: "regex", rule_value: "https://pan\\.(quark|baidu)\\.", required: false },
  { field_name: "description", rule_type: "regex", rule_value: "<description>(.*?)</description>", required: false },
];

const DEFAULT_INSTANCES = [
  { name: "woodland.cafe", host: "https://rsshub.woodland.cafe", enabled: true },
  { name: "ktachibana.party", host: "https://rsshub.ktachibana.party", enabled: true },
];

// 频道名 → 默认名称/分类（已知频道映射，未知频道用频道名兜底）
const CH_NAME = {
  okpojie: "okpojie TG 综合", softwareGods: "okpojie TG 软件", happyflims: "okpojie TG 影视",
  allgamegod: "okpojie TG 游戏", freekecheng: "okpojie TG 课程", ShortDramaGod: "okpojie TG 短剧",
  allgirlhunter: "okpojie TG 美女", Aliyun_4K_Movies: "4K影视 TG", netdisk_movies: "海外影视 TG",
  bdyunpan: "百度资源 TG", BaiduCloudDisk: "百度中转 TG",
  yunpan139: "移动云盘 TG", yunpan189: "天翼云盘 TG", yp123pan: "123云盘 TG",
  yunpanuc: "UC云盘 TG", yunpanxunlei: "迅雷云盘 TG", yunpans: "夸克综合 TG",
};
const CH_CAT = {
  softwareGods: "软件", happyflims: "影视", allgamegod: "游戏", freekecheng: "课程",
  ShortDramaGod: "短剧", allgirlhunter: "美女", Aliyun_4K_Movies: "影视", netdisk_movies: "影视",
  bdyunpan: "综合", BaiduCloudDisk: "综合", yunpan139: "综合", yunpan189: "综合",
  yp123pan: "综合", yunpanuc: "综合", yunpanxunlei: "综合", yunpans: "综合",
};

function readSettings(cfg) {
  var raw = cfg && cfg.tg_settings;
  if (typeof raw === "string") { try { return JSON.parse(raw) || {}; } catch (e) { return {}; } }
  return raw && typeof raw === "object" ? raw : {};
}
function normalizeSettings(s) {
  s = s || {};
  var instances = Array.isArray(s.instances) && s.instances.length ? s.instances : DEFAULT_INSTANCES;
  var def = s.default_instance || (instances[0] && instances[0].host) || "https://rsshub.woodland.cafe";
  return {
    instances: instances,
    default_instance: def,
    limit: parseInt(s.limit, 10) || 50,
    interval_sec: parseInt(s.interval_sec, 10) || 3600,
  };
}

async function getSettings(req, res) {
  try {
    var cfg = await store.getConfig();
    json(res, 200, normalizeSettings(readSettings(cfg)));
  } catch (e) { json(res, 500, { error: e.message }); }
}
async function saveSettings(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var s = normalizeSettings(b);
    await store.saveConfig({ tg_settings: JSON.stringify(s) });
    json(res, 200, { ok: true, settings: s });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 批量添加频道：channels 数组或换行分隔字符串（可带 @ 或不带）→ 建源 + 套规则模板，幂等（同频道跳过）
async function batchAdd(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var channels = (Array.isArray(b.channels) ? b.channels : String(b.channels || "").split(/[\n,]/))
      .map(function (c) { return String(c).trim().replace(/^@/, ""); })
      .filter(Boolean);
    if (!channels.length) return json(res, 400, { error: "channels 必填" });
    var cfg = await store.getConfig();
    var settings = normalizeSettings(readSettings(cfg));
    var instance = String(b.instance || settings.default_instance || "").trim();
    if (instance && !/^https?:\/\//i.test(instance)) instance = "https://" + instance;
    instance = instance.replace(/\/+$/, "");
    var limit = parseInt(b.limit, 10) || settings.limit || 50;
    var category = String(b.category || "").trim();
    var list = await store.crawlerSourceList(false);
    var created = [], existed = [], failed = [];
    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      if (!/^[A-Za-z0-9_]{3,64}$/.test(ch)) { failed.push({ channel: ch, error: "频道名格式非法（字母数字下划线）" }); continue; }
      var dup = list.find(function (s) {
        var m = String(s.url_template).match(/\/telegram\/channel\/([A-Za-z0-9_]+)/);
        return m && m[1].toLowerCase() === ch.toLowerCase();
      });
      if (dup) { existed.push({ id: dup.id, channel: ch, name: dup.name }); continue; }
      var url = instance + "/telegram/channel/" + ch + "?limit=" + limit;
      var name = CH_NAME[ch] || (ch + " TG");
      var id = await store.crawlerSourceAdd({
        name: name,
        description: "Telegram 频道 @" + ch,
        source_type: "rss",
        url_template: url,
        page_start: 1, page_end: 1, encoding: "utf-8",
        category: category || CH_CAT[ch] || "",
        disk_type: "",
        status: 1,
      });
      for (var r = 0; r < TG_RULES.length; r++) {
        await store.crawlerRuleAdd({
          source_id: id,
          field_name: TG_RULES[r].field_name,
          rule_type: TG_RULES[r].rule_type,
          rule_value: TG_RULES[r].rule_value,
          required: TG_RULES[r].required,
          default_value: "", filter_regex: "", position: r,
        });
      }
      created.push({ id: id, channel: ch, name: name });
    }
    json(res, 200, { ok: true, created: created, existed: existed, failed: failed });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// TG 源列表（含入库数聚合）
async function sourceList(req, res) {
  try {
    var list = await store.crawlerSourceList(false);
    var items = list.filter(function (s) { return String(s.url_template).indexOf("/telegram/channel/") > -1; });
    var counts = await store.resourceCountBySource();
    var out = items.map(function (s) {
      var m = String(s.url_template).match(/\/telegram\/channel\/([A-Za-z0-9_]+)/);
      return {
        id: s.id, channel: m ? m[1] : "", name: s.name, url_template: s.url_template,
        source_type: s.source_type, category: s.category, status: s.status,
        disk_type: s.disk_type, last_crawled_at: s.last_crawled_at,
        count: counts[String(s.id)] || 0,
      };
    });
    out.sort(function (a, b) { return a.id - b.id; });
    json(res, 200, { items: out });
  } catch (e) { json(res, 500, { error: e.message }); }
}

module.exports = { getSettings, saveSettings, batchAdd, sourceList };
