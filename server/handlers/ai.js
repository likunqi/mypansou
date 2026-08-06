// server/handlers/ai.js — 后台 AI 提炼（DeepSeek / OpenAI 兼容 chat/completions）
// 配置存 site_config（ai_base / ai_key / ai_model）；提炼结果存 ai_summaries 表
const { json, readBody, fetchHttps } = require("../middleware");
const store = require("../../lib/store");

const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

async function getAiConfig() {
  var cfg = await store.getConfig();
  return {
    base: cfg.ai_base || DEFAULT_BASE,
    key: cfg.ai_key || "",
    model: cfg.ai_model || DEFAULT_MODEL,
  };
}

// 调 OpenAI 兼容 /chat/completions，返回回复文本
async function chat(ac, prompt, sysPrompt) {
  if (!ac.key) throw new Error("未配置 AI Key（后台「AI 提炼」页先填 Key）");
  var payload = {
    model: ac.model,
    messages: [
      { role: "system", content: sysPrompt || "你是一个严谨的中文运营助手，输出精炼、结构化。" },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    stream: false,
  };
  var r = await fetchHttps(ac.base, "/chat/completions", {
    "Authorization": "Bearer " + ac.key,
    "Content-Type": "application/json",
  }, JSON.stringify(payload));
  if (r.status !== 200) {
    var msg = "AI 接口返回 " + r.status;
    try {
      var e = JSON.parse(r.body);
      if (e.error && e.error.message) msg += ": " + e.error.message;
    } catch (e2) {}
    throw new Error(msg);
  }
  var d = JSON.parse(r.body);
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
}

// 后台保存 AI 配置
async function saveConfig(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var cfg = await store.getConfig();
    if (b.ai_base !== undefined) cfg.ai_base = b.ai_base || DEFAULT_BASE;
    if (b.ai_key !== undefined) cfg.ai_key = b.ai_key;
    if (b.ai_model !== undefined) cfg.ai_model = b.ai_model || DEFAULT_MODEL;
    // 提示词：prompts = { key: "自定义文本" }（空串 = 恢复该场景默认）
    if (b.prompts !== undefined && typeof b.prompts === "object") {
      var cur = readPromptCfg(cfg);
      PROMPT_KEYS.forEach(function (k) {
        if (b.prompts[k] !== undefined) cur[k] = String(b.prompts[k]);
      });
      cfg.ai_prompts = JSON.stringify(cur);
      // 兼容：清旧字段（tg_collect 已并入 ai_prompts）
      delete cfg.ai_domain_prompt;
    }
    // 兼容旧接口（K 补时代）：domain_prompt → tg_collect
    if (b.domain_prompt !== undefined) {
      var cur2 = readPromptCfg(cfg);
      cur2.tg_collect = String(b.domain_prompt);
      cfg.ai_prompts = JSON.stringify(cur2);
      delete cfg.ai_domain_prompt;
    }
    await store.saveConfig(cfg);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 读 AI 配置（key 脱敏回显 + 全部提示词场景回显）
async function getConfig(req, res) {
  var ac = await getAiConfig();
  json(res, 200, {
    base: ac.base,
    keySet: !!ac.key,
    keyMask: ac.key ? "****" + ac.key.slice(-4) : "",
    model: ac.model,
    prompts: await getAllEffectivePrompts(),
  });
}

// 连通性测试
async function test(req, res) {
  try {
    var ac = await getAiConfig();
    var out = await chat(ac, "只回复两个字：正常", "你是连通性测试助手。");
    json(res, 200, { ok: true, reply: (out || "").slice(0, 100) });
  } catch (e) { json(res, 502, { ok: false, error: e.message }); }
}

// 各 scope 数据构建（紧凑文本喂给 AI）
async function buildScopeInput(scope, text) {
  if (scope === "custom") return text || "";
  if (scope === "submissions") {
    var r = await store.submitList("0", 1, 30);
    return (r.items || []).map(function (s, i) {
      return (i + 1) + ". [" + (s.disk_type || "") + "] " + (s.title || "") + " | " + (s.url || "") +
        (s.password ? " | 提取码 " + s.password : "") + (s.category ? " | " + s.category : "");
    }).join("\n");
  }
  if (scope === "reports") {
    var rows = await store.reportList(50);
    return (rows || []).map(function (r, i) {
      return (i + 1) + ". 资源#" + (r.resource_id || "?") + " " + (r.reason || "") + (r.url ? " | " + r.url : "");
    }).join("\n");
  }
  if (scope === "history") {
    var h = await store.historyList(30);
    return (h || []).map(function (r, i) {
      return (i + 1) + ". [" + (r.type || "") + "] " + (r.title || r.originalUrl || "") + (r.success ? "" : " [失败]");
    }).join("\n");
  }
  return "";
}

var SCOPE_PROMPTS = {
  submissions: "以下是用户提交的网盘资源（待审核）。请提炼：1) 总体概况（数量、类型分布）2) 值得优先通过的资源（按标题相关性/完整性评估）3) 明显可疑或应拒绝的条目及原因 4) 建议。用中文输出，简洁分点。",
  reports: "以下是用户提交的失效链接反馈。请提炼：1) 反馈概况 2) 集中失效的链接/资源模式（按 url 聚类）3) 需要优先处理的条目 4) 建议。用中文输出，简洁分点。",
  history: "以下是最近的夸克/百度转存记录。请提炼：1) 转存概况（总量、成功/失败比例）2) 转存最多的资源倾向 3) 失败原因分析 4) 建议。用中文输出，简洁分点。",
  custom: "以下是用户提供的文本，请提炼要点、结构与结论。用中文输出，简洁分点。",
};
// {SCOPE} 占位符 → 各范围名（自定义 summarize 提示词里用）
const SCOPE_LABELS = { submissions: "待审核资源提交", reports: "失效链接反馈", history: "转存记录", custom: "自定义文本" };

async function summarize(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var scope = b.scope || "custom";
    var input = await buildScopeInput(scope, b.text);
    if (!input || !input.trim()) {
      json(res, 400, { error: "no_input", message: "所选范围没有可提炼的数据" });
      return;
    }
    var ac = await getAiConfig();
    // 自定义 summarize 提示词优先（{SCOPE} 替换为范围名）；未自定义用内置 SCOPE_PROMPTS
    var customSum = (await getAllEffectivePrompts()).summarize.custom;
    var sys;
    if (customSum && customSum.trim()) {
      sys = customSum.replace(/\{SCOPE\}/g, SCOPE_LABELS[scope] || scope);
    } else {
      sys = SCOPE_PROMPTS[scope] || SCOPE_PROMPTS.custom;
    }
    var out = await chat(ac, input.slice(0, 12000), sys);
    await store.aiSummaryAdd({ scope: scope, input_text: input.slice(0, 3000), output_text: out, model: ac.model });
    json(res, 200, { ok: true, output: out });
  } catch (e) {
    json(res, 502, { ok: false, error: e.message });
  }
}

async function list(req, res) {
  var rows = await store.aiSummaryList(50);
  json(res, 200, { items: rows });
}

// ---------- 领域知识库（内置提示词核心：AI 不需要用户解释项目背景） ----------
// 资源字段白名单：与 resources 表字段对齐，AI 只能从这些字段中生成规则
const FIELD_WHITELIST = ["title", "url", "password", "desc", "category", "disk_type", "thumbnail", "extract_code"];
// 规则类型白名单：与 crawler-engine extractField 支持的类型对齐（css 暂不支持）
const RULE_TYPE_WHITELIST = ["regex", "jsonpath", "fixed", "concat"];
// 字段别名映射：AI 常见同义字段 → 标准字段（受控修正，不改则剔除）
const FIELD_ALIASES = {
  link: "url", 链接: "url", url: "url",
  name: "title", 名称: "title", 标题: "title", title: "title",
  密码: "password", 提取码: "password",
  描述: "desc",
  分类: "category",
  网盘: "disk_type", 网盘类型: "disk_type", type: "disk_type",
  封面: "thumbnail", thumb: "thumbnail", 封面图: "thumbnail",
};
// 网盘分享链接正则：url 字段（fixed/jsonpath 可预检值；regex 检查模式特征）
const PAN_URL_RE = /^https:\/\/pan\.(?:quark\.cn|baidu\.com)\/s\/[A-Za-z0-9_-]+/;
// 网盘域名特征（regex 模式用：含 pan/quark/baidu 域名即视为网盘提取）
const PAN_HINT_RE = /pan\.(?:quark\.cn|baidu\.com)|pan\.quark|pan\.baidu/i;

// 各场景默认提示词（内置，用户可覆盖）
// 占位符：{FIELD_WHITELIST}/{RULE_TYPE_WHITELIST}/{PAN_URL_RE} 自动替换为实际值；summarize 额外支持 {SCOPE}
function buildDomainPromptBase() {
  return [
    "你是「云盘搜」网盘资源搜索引擎的采集规则工程师。本项目只收录网盘资源，遵循以下硬性领域约束：",
    "1. 资源字段只能从白名单选：" + FIELD_WHITELIST.join("/") + "（含义：title=标题、url=网盘分享链接、password=提取码、desc=描述、category=分类、disk_type=网盘类型、thumbnail=封面图、extract_code=提取码备选字段）。",
    "2. 规则类型只能从白名单选：" + RULE_TYPE_WHITELIST.join("/") + "（regex=正则提取第一个捕获组、jsonpath=JSON路径、fixed=固定值、concat=多个 jsonpath 拼接）。css 类型引擎暂不支持，禁止使用。",
    "3. url 字段必须产出网盘分享链接，格式：" + PAN_URL_RE.source + "。严禁产出 t.me 消息链接、普通网页链接或残缺 URL；提取到相对路径时补全为 https://。",
    "4. title 和 url 两条规则必须存在且 required:true；其余字段可选。",
    "5. category 只能从分类字典中取值；disk_type 只能取 quark/baidu（配合规则值里出现的盘自动推断，不要用固定值覆盖实际盘）。",
    "6. password（提取码）提取方法：从条目的描述/正文文本中找『提取码』字样后的字符（如 提取码[:：\\s]*([A-Za-z0-9]{4,8})）；只有当分享链接本身带 ?pwd=xxx 时才可从 url 提取。禁止把『百度网盘链接的 pwd 参数正则』套用到夸克链接上——url 是夸克盘时 password 应从文本提取。",
    "7. disk_type 提取方法：看 url 链接的域名推断盘类型（quark.cn→quark、baidu.com→baidu），用 regex 从 url 捕获，如 https://pan\\.(quark|baidu)\\. 的捕获组；不要用 fixed 固定写死，除非频道只发一种盘。",
    "8. thumbnail（封面图）提取方法：从条目的 XML/HTML 里按优先级找图片 URL——① <enclosure url=\"...\" type=\"image/...\"> ② <img src=\"...\"> ③ <media:thumbnail url=\"...\">。正则写法示例：<(?:enclosure|media:thumbnail)[^>]*?url=\"([^\"]+\\.(?:jpe?g|png|webp|gif))\"|<img[^>]+src=\"([^\"]+\\.(?:jpe?g|png|webp|gif))\";无图时该字段可省略，不要用 fixed 填死。",
    "9. 辅助定位规则：page 类型可加 field_name=__item__ 的条目分隔正则；api 类型可加 field_name=__list__ 的列表 jsonpath（如 $.data.list）。",
    "10. 只输出 JSON 数组（元素结构 {field_name, rule_type, rule_value, required, default_value?, filter_regex?}），不要任何解释文字、markdown 代码围栏或多余键。",
  ].join("\n");
}

// 提示词场景注册表：key → { label（前端展示名）, desc, default（默认提示词模板） }
const PROMPT_DEFS = {
  tg_collect: {
    label: "TG 采集（AI 自动生成规则）",
    desc: "TG 采集 → AI 自动生成解析规则时使用的领域提示词",
    default: buildDomainPromptBase(),
  },
  gen_rules: {
    label: "手动规则生成（解析规则 AI）",
    desc: "采集管理 → 解析规则 AI 生成时的领域提示词",
    default: buildDomainPromptBase(),
  },
  summarize: {
    label: "内容提炼（AI 摘要）",
    desc: "任务中心 → AI 提炼。用 {SCOPE} 占位符区分四种范围（submissions/reports/history/custom），例：『{SCOPE}：以下是…请提炼…』",
    default: "以下是 {SCOPE} 数据。请用中文提炼要点、结构与结论，简洁分点输出。",
  },
  optimize: {
    label: "资源优化（AI 清洗标题/分类/标签）",
    desc: "资源列表 → 优化：AI 清洗标题、归类、打标签。用 {CATEGORY_DICT} 占位符注入当前分类字典",
    default: "你是网盘资源库的元数据优化助手。给定一条资源的原始信息（标题/描述/链接/现有分类），只输出一个 JSON 对象（不要解释文字、不要代码围栏）：\n{title: 清洗后的规范标题——去掉 🖼/📁/🎬 等 emoji 与『名称：』『描述：』等前缀，保留核心片名/剧名/资源名与关键版本信息（如 4K/1080P/全24集），30 字以内、不杜撰、不改原意、category: 从分类字典中选最贴近的一项（{CATEGORY_DICT}），没有匹配就用『综合』、tags: 2-5 个逗号分隔的中文标签（概括类型/格式/来源，如 短剧,4K,夸克）}\n只输出 JSON，不要其他内容。",
  },
};
const PROMPT_KEYS = Object.keys(PROMPT_DEFS);
// 兼容旧字段名
const LEGACY_PROMPT_MAP = { ai_domain_prompt: "tg_collect" };

// 展开提示词中的占位符
function expandPrompt(text) {
  return String(text || "")
    .replace(/\{FIELD_WHITELIST\}/g, FIELD_WHITELIST.join("/"))
    .replace(/\{RULE_TYPE_WHITELIST\}/g, RULE_TYPE_WHITELIST.join("/"))
    .replace(/\{PAN_URL_RE\}/g, PAN_URL_RE.source);
}

// 读分类字典（{CATEGORY_DICT} 占位符用）
async function readCategoryDict() {
  try {
    var cats = await store.categoryList(100, false);
    return (cats || []).map(function (c) { return c.name; }).filter(Boolean).join("、");
  } catch (e) { return ""; }
}

// 读取用户自定义提示词（site_config.ai_prompts = { key: "..." }；兼容旧 ai_domain_prompt）
function readPromptCfg(cfg) {
  var out = {};
  try {
    var raw = cfg && cfg.ai_prompts;
    var obj = typeof raw === "string" ? JSON.parse(raw) : (raw && typeof raw === "object" ? raw : {});
    PROMPT_KEYS.forEach(function (k) { out[k] = obj && typeof obj[k] === "string" ? obj[k] : ""; });
  } catch (e) {
    PROMPT_KEYS.forEach(function (k) { out[k] = ""; });
  }
  // 旧字段迁移：ai_domain_prompt → tg_collect（仅当 tg_collect 未自定义时）
  if (!out.tg_collect && cfg && cfg.ai_domain_prompt) out.tg_collect = cfg.ai_domain_prompt;
  return out;
}

// 取某场景当前生效的提示词（自定义 || 内置默认，已展开占位符）——回显与调用共用
async function getEffectivePrompt(key) {
  if (!PROMPT_DEFS[key]) key = "tg_collect";
  try {
    var cfg = await store.getConfig();
    var custom = readPromptCfg(cfg)[key];
    var text = custom && custom.trim() ? custom : PROMPT_DEFS[key].default;
    var out = expandPrompt(text);
    if (out.indexOf("{CATEGORY_DICT}") >= 0) out = out.replace(/\{CATEGORY_DICT\}/g, await readCategoryDict());
    return out;
  } catch (e) { return expandPrompt(PROMPT_DEFS[key].default); }
}

// 后端生成提示词（已展开占位符）——genRules/aiGenerate 共用（兼容旧名）
async function getEffectiveDomainPrompt() {
  return await getEffectivePrompt("tg_collect");
}

// 取全部场景的当前生效提示词 + 是否自定义（前端回显用）
async function getAllEffectivePrompts() {
  var cfg = await store.getConfig();
  var custom = readPromptCfg(cfg);
  var dict = await readCategoryDict();
  var out = {};
  PROMPT_KEYS.forEach(function (k) {
    var cu = custom[k] || "";
    var text = cu && cu.trim() ? expandPrompt(cu) : expandPrompt(PROMPT_DEFS[k].default);
    if (text.indexOf("{CATEGORY_DICT}") >= 0) text = text.replace(/\{CATEGORY_DICT\}/g, dict);
    out[k] = {
      label: PROMPT_DEFS[k].label,
      desc: PROMPT_DEFS[k].desc,
      custom: cu,
      effective: text,
      isCustom: !!cu && !!cu.trim(),
    };
  });
  return out;
}

// 兼容旧名：buildDomainPrompt（旧 K 补代码可能引用）
function buildDomainPrompt(custom) {
  if (custom && String(custom).trim()) return expandPrompt(custom);
  return buildDomainPromptBase();
}

// 校验/修正 AI 生成的规则数组 → {rules, accepted, rejected, fixed}
// rejected: 已剔除的非法项；fixed: 已自动修正的项（前端回显给用户）
function validateRules(input) {
  if (!Array.isArray(input)) return { rules: [], accepted: 0, rejected: [], fixed: [] };
  var out = [];
  var rejected = [], fixed = [];
  input.forEach(function (r) {
    if (!r || typeof r !== "object") { rejected.push({ field: "?", reason: "非法条目（非对象）" }); return; }
    var field = String(r.field_name || "").trim();
    var type = String(r.rule_type || "regex").trim();
    var ruleVal = String(r.rule_value || "").trim();
    var isLocator = field === "__item__" || field === "__list__";

    // 1) 字段白名单 + 别名映射
    if (FIELD_ALIASES[field] && FIELD_ALIASES[field] !== field) {
      fixed.push({ field: field, to: FIELD_ALIASES[field], reason: "字段别名自动映射" });
      field = FIELD_ALIASES[field];
    }
    if (!isLocator && FIELD_WHITELIST.indexOf(field) === -1) {
      rejected.push({ field: field || "(空)", reason: "字段不在白名单，已剔除" });
      return;
    }
    // 2) 规则类型白名单
    if (RULE_TYPE_WHITELIST.indexOf(type) === -1) {
      rejected.push({ field: field, reason: "规则类型 " + (type || "(空)") + " 不受引擎支持（css 暂不支持）" });
      return;
    }
    // 3) url 字段网盘链接校验
    if (field === "url") {
      if (type === "fixed" || (type === "jsonpath" && ruleVal.indexOf("url") >= 0 && !PAN_HINT_RE.test(ruleVal))) {
        if (type === "fixed" && !PAN_URL_RE.test(ruleVal)) {
          rejected.push({ field: "url", reason: "fixed 值不是网盘分享链接（" + ruleVal.slice(0, 40) + "）" });
          return;
        }
      } else if (type === "regex" && ruleVal && !PAN_HINT_RE.test(ruleVal)) {
        fixed.push({ field: "url", to: "url", reason: "regex 模式不含网盘域名特征，已提醒（确保提取到 pan.quark.cn / pan.baidu.com 链接）" });
      }
    }
    // 4) thumbnail 图片 URL 校验（fixed/jsonpath 预检值；regex 检查模式特征）
    if (field === "thumbnail") {
      if (type === "fixed" || type === "jsonpath") {
        if (ruleVal && !/^https?:\/\/.+/i.test(ruleVal)) {
          fixed.push({ field: "thumbnail", to: "thumbnail", reason: "值不是 http(s) 图片链接，已置空" });
          ruleVal = "";
        }
      } else if (type === "regex" && ruleVal && !/(?:enclosure|media:thumbnail|<img\b|\.(?:jpe?g|png|webp|gif))/i.test(ruleVal)) {
        fixed.push({ field: "thumbnail", to: "thumbnail", reason: "regex 模式不含图片标签/后缀特征（应匹配 enclosure/img/media:thumbnail）" });
      }
    }
    // 5) category / disk_type 取值约束
    if (field === "disk_type" && ruleVal && ["quark", "baidu"].indexOf(ruleVal.toLowerCase()) === -1 && type === "fixed") {
      fixed.push({ field: "disk_type", to: "disk_type", reason: "fixed 值 " + ruleVal + " 不在 quark/baidu 内，已置空（由源兜底）" });
      ruleVal = "";
    }
    out.push({
      field_name: field,
      rule_type: type,
      rule_value: ruleVal,
      required: r.required === true || field === "title" || field === "url",
      default_value: r.default_value ? String(r.default_value) : "",
      filter_regex: r.filter_regex ? String(r.filter_regex) : "",
    });
  });
  // 6) 强制 title/url 必填存在（校验器兜底：AI 漏了也补上）
  var has = {};
  out.forEach(function (r) { has[r.field_name] = true; });
  if (!has.title) {
    out.unshift({ field_name: "title", rule_type: "regex", rule_value: "", required: true, default_value: "", filter_regex: "" });
    fixed.push({ field: "title", to: "title", reason: "AI 未生成 title 规则，已补占位（需填规则值）" });
  }
  if (!has.url) {
    out.unshift({ field_name: "url", rule_type: "regex", rule_value: PAN_URL_RE.source, required: true, default_value: "", filter_regex: "" });
    fixed.push({ field: "url", to: "url", reason: "AI 未生成 url 规则，已用网盘正则占位" });
  }
  return { rules: out, accepted: out.length, rejected: rejected, fixed: fixed };
}

// ---------- AI 辅助：生成采集解析规则 / 生成任务脚本 ----------

// 从 AI 输出提取 JSON 数组（容错 markdown 代码块 / 尾逗号）
function extractJsonArray(text) {
  var m = String(text || "").match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    var arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : null;
  } catch (e) {
    try { return JSON.parse(m[0].replace(/,\s*([\]}])/g, "$1")); } catch (e2) { return null; }
  }
}
// 从 AI 输出提取 JS 代码（容错 ```js 围栏 / 前置解释文字）
function extractCode(text) {
  var m = String(text || "").match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
  if (m && m[1].trim()) return m[1].trim();
  var s = String(text || "");
  var i = s.indexOf("async function run");
  if (i < 0) i = s.indexOf("function run");
  if (i < 0) return "";
  return s.slice(i).trim();
}

// 生成采集解析规则（crawler rules JSON 数组）
// 内置领域提示词 + 源上下文注入；输出后经 validateRules 受控校验（白名单/类型/网盘正则/必填）
async function genRules(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var sourceId = parseInt(b.source_id, 10) || 0;
    var sourceType = b.source_type || "rss";
    var urlTemplate = b.url_template || "";
    var sample = b.sample_text || "";
    var ac = await getAiConfig();

    // 源上下文（选已有源时自动带出，AI 无需用户解释项目）
    var ctxDesc = "源类型: " + sourceType + "\nURL 模板: " + (urlTemplate || "-");
    if (sourceId) {
      try {
        var list = await store.crawlerSourceList(false);
        var src = null;
        for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(sourceId)) src = list[i];
        if (src) {
          ctxDesc = "目标采集源 #" + src.id + " " + (src.name || "") + "\n源类型: " + src.source_type +
            "\nURL 模板: " + src.url_template + "\n分类: " + (src.category || "(未设置)") +
            "\n网盘: " + (src.disk_type || "(不限制)");
          var rules = await store.crawlerRuleList(src.id);
          if (rules && rules.length) {
            ctxDesc += "\n现有规则: " + rules.map(function (r) { return r.field_name + "(" + r.rule_type + ")"; }).join(", ");
          }
        }
      } catch (e) {}
    }

    var sys = await getEffectivePrompt("gen_rules");
    var prompt = ctxDesc + "\n\n示例内容（供正则参考）:\n" + (sample || "(未提供)") + "\n\n请生成解析规则 JSON 数组。";
    var out = await chat(ac, prompt.slice(0, 12000), sys);
    var rules = extractJsonArray(out);
    if (!rules || !rules.length) throw new Error("AI 未能生成有效规则 JSON（" + out.slice(0, 80) + "…）");
    var report = validateRules(rules);
    if (!report.rules.length) throw new Error("校验后无有效规则：全部被领域约束拦截（" + (report.rejected || []).map(function (r) { return r.reason; }).join("；") + "）");
    json(res, 200, { ok: true, rules: report.rules, report: report });
  } catch (e) { json(res, 502, { ok: false, error: e.message }); }
}

// 生成自定义任务脚本（async function run(ctx)）
// ctx 内置 crawlSource：脚本可触发指定采集源规则采集（与采集解析规则关联）
async function genScript(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var taskDesc = String(b.task_desc || "").trim();
    var sourceId = parseInt(b.source_id, 10) || 0;
    if (!taskDesc) { json(res, 400, { error: "task_desc 必填" }); return; }
    var ac = await getAiConfig();
    var sys = "你是 Node.js 定时任务脚本工程师。根据需求生成自定义任务脚本代码。约定：async function run(ctx){...}；脚本内全局可用：" +
      "crawlSource(sourceId)（执行指定采集源 crawler_sources.id 的全部解析规则并入库，返回 {status,crawled,inserted,skipped}，sourceId 必须为数字）、" +
      "store（数据层，含 resourceAdd/resourceList/historyList/historyDelete 等）、mysql（lib/mysql 直连）、fetch（全局 fetch）、require（Node require）、console；" +
      "脚本返回 {status:'ok', resultMsg:'...'} 或 {status:'failed', error:'...'}。只输出完整可运行的 JS 代码，不要解释文字，不要 markdown 代码围栏。";
    var prompt = "任务需求: " + taskDesc +
      (sourceId ? "\n\n提示：若任务需要采集资源，请直接调用 crawlSource(" + sourceId + ")" : "") +
      "\n\n生成脚本代码。";
    var out = await chat(ac, prompt.slice(0, 12000), sys);
    var code = extractCode(out);
    if (!code || !/function run/.test(code)) throw new Error("AI 生成内容不含 run 函数");
    json(res, 200, { ok: true, code: code });
  } catch (e) { json(res, 502, { ok: false, error: e.message }); }
}

module.exports = { saveConfig, getConfig, test, summarize, list, genRules, genScript, validateRules, buildDomainPrompt, getAiConfig, chat, extractJsonArray, getEffectivePrompt, getAllEffectivePrompts, getEffectiveDomainPrompt };
