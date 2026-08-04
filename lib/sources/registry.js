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
  hunhepan: {
    id: "hunhepan",
    name: "混合盘",
    short: "混合盘",
    type: "browser",
    desc: "hunhepan.com 聚合盘搜（需本机浏览器，反爬挑战由浏览器自动过）",
    // 默认关闭：playwright 驱动每次约 13s 且偶发失败，拖慢整体搜索；需要时在配置中开启
    defaultEnabled: false,
    adapter: "./hunhepan",
  },
};

// 读取启停配置（site_config.multi_sources = JSON 字符串）
function getEnabledSet(cfg) {
  var enabled = {};
  Object.keys(REGISTRY).forEach(function (id) {
    enabled[id] = REGISTRY[id].defaultEnabled !== false;
  });
  try {
    var saved = cfg && cfg.multi_sources ? JSON.parse(cfg.multi_sources) : null;
    if (saved && typeof saved === "object") {
      Object.keys(saved).forEach(function (id) {
        if (REGISTRY[id]) enabled[id] = !!saved[id];
      });
    }
  } catch (e) { /* 配置损坏时用默认 */ }
  return enabled;
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

module.exports = { REGISTRY, getEnabledSet, resolveSources, loadAdapter };
