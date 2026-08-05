// 多搜索源注册表：源 id / 显示名 / 类型 / 默认启停
// 启停状态可在 site_config.multi_sources 覆盖（admin 或手动改）
const REGISTRY = {
  pansou: {
    id: "pansou",
    name: "NAS 自建",
    short: "自建",
    type: "api",
    desc: "NAS pansou 自建源（夸克/百度）",
    defaultEnabled: true,
    adapter: "./pansou",
  },
  v451024: {
    id: "v451024",
    name: "451024 影视",
    short: "451024",
    type: "api",
    desc: "影视搜索站（夸克/百度/迅雷/阿里/UC）",
    defaultEnabled: true,
    adapter: "./v451024",
  },
  // hunhepan 已注销（2026-08-04 用户要求）：playwright 驱动每次约 13s 且首访偶发失败，
  // 对个人搜索体验拖累大。adapter 代码保留在 lib/sources/hunhepan.js，恢复时取消注释并
  // 在 site_config.multi_sources 里置 {"hunhepan":true} 即可。
  // hunhepan: {
  //   id: "hunhepan",
  //   name: "混合盘",
  //   short: "混合盘",
  //   type: "browser",
  //   desc: "hunhepan.com 聚合盘搜（需本机浏览器，反爬挑战由浏览器自动过）",
  //   defaultEnabled: false,
  //   adapter: "./hunhepan",
  // },
};

// 读取启停配置（site_config.multi_sources = JSON 字符串）
// 配置格式：{"pansou": true} 旧布尔 或 {"pansou": {"enabled": true, "disks": ["quark","baidu"], "name": "自建"}} 新对象（disks 空数组=不限制，name 可空=用缺省名）
// defEnabled：源未配置时用的默认启停值（registry 的 defaultEnabled）
function parseSourceCfg(v, defEnabled) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return {
      enabled: !!v.enabled,
      disks: Array.isArray(v.disks) ? v.disks.filter(function (d) { return typeof d === "string"; }) : [],
      name: typeof v.name === "string" && v.name.trim() ? v.name.trim() : "",
    };
  }
  return { enabled: v === undefined ? !!defEnabled : !!v, disks: [], name: "" };
}

function getEnabledSet(cfg) {
  var enabled = {};
  Object.keys(REGISTRY).forEach(function (id) {
    enabled[id] = REGISTRY[id].defaultEnabled !== false;
  });
  try {
    var saved = cfg && cfg.multi_sources ? JSON.parse(cfg.multi_sources) : null;
    if (saved && typeof saved === "object") {
      Object.keys(saved).forEach(function (id) {
        if (REGISTRY[id]) enabled[id] = parseSourceCfg(saved[id]).enabled;
      });
    }
  } catch (e) { /* 配置损坏时用默认 */ }
  return enabled;
}

// 某源的网盘限制（空数组 = 不限制，返回全部）
function getSourceDisks(id, cfg) {
  try {
    var saved = cfg && cfg.multi_sources ? JSON.parse(cfg.multi_sources) : null;
    if (saved && typeof saved === "object" && saved[id]) {
      return parseSourceCfg(saved[id]).disks;
    }
  } catch (e) {}
  return [];
}

// 后台管理列表：全量源信息（含启停 + 网盘限制 + 展示名）
// 展示名优先取配置 name，缺省用 short（与搜索页默认一致）
function getAllSources(cfg) {
  var enabled = getEnabledSet(cfg);
  var saved = null;
  try { saved = cfg && cfg.multi_sources ? JSON.parse(cfg.multi_sources) : null; } catch (e) {}
  return Object.keys(REGISTRY).map(function (id) {
    var m = REGISTRY[id];
    var nm = (saved && saved[id] && parseSourceCfg(saved[id]).name) || m.short;
    return { id: id, name: nm, short: m.short, type: m.type, desc: m.desc, enabled: !!enabled[id], disks: getSourceDisks(id, cfg) };
  });
}

// 源 id → 展示名（配置优先，缺省 registry.short）；搜索页 tab/徽标与 multi 响应 source_labels 共用
function getSourceLabels(cfg) {
  var labels = {};
  var saved = null;
  try { saved = cfg && cfg.multi_sources ? JSON.parse(cfg.multi_sources) : null; } catch (e) {}
  Object.keys(REGISTRY).forEach(function (id) {
    var m = REGISTRY[id];
    labels[id] = (saved && saved[id] && parseSourceCfg(saved[id]).name) || m.short;
  });
  return labels;
}

// 解析前端 sources 参数："all" | 逗号分隔 id 列表 → 返回实际要跑的源 id 数组
function resolveSources(param, cfg) {
  var enabled = getEnabledSet(cfg);
  var want = [];
  if (!param || param === "all" || param === "") {
    want = Object.keys(REGISTRY).filter(function (id) { return enabled[id]; });
  } else {
    want = String(param).split(",").map(function (s) { return s.trim(); })
      .filter(function (id) { return REGISTRY[id] && enabled[id]; });
  }
  return want;
}

// 动态加载适配器（容错：找不到就返回 null）
function loadAdapter(id) {
  try {
    return require(REGISTRY[id].adapter);
  } catch (e) {
    console.error("[multi] adapter load failed:", id, e.message);
    return null;
  }
}

module.exports = { REGISTRY, parseSourceCfg, getEnabledSet, getSourceDisks, getAllSources, getSourceLabels, resolveSources, loadAdapter };
