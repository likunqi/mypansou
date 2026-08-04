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
    await store.saveConfig(cfg);
    json(res, 200, { ok: true });
  } catch (e) { json(res, 500, { error: e.message }); }
}

// 读 AI 配置（key 脱敏回显）
async function getConfig(req, res) {
  var ac = await getAiConfig();
  json(res, 200, {
    base: ac.base,
    keySet: !!ac.key,
    keyMask: ac.key ? "****" + ac.key.slice(-4) : "",
    model: ac.model,
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
    var sys = SCOPE_PROMPTS[scope] || SCOPE_PROMPTS.custom;
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
async function genRules(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var sourceType = b.source_type || "rss";
    var urlTemplate = b.url_template || "";
    var sample = b.sample_text || "";
    var ac = await getAiConfig();
    var sys = "你是网盘资源站采集规则工程师。根据采集源信息生成 crawler-engine 解析规则 JSON 数组。字段结构：{field_name, rule_type, rule_value, required, default_value?}；rule_type 可选 regex/jsonpath/fixed/concat（css 暂不支持）；必含 title/url 字段（required:true）；page 类型用 __item__（条目分隔正则）、api 类型用 __list__（列表 jsonpath 如 $.data.list）。只输出 JSON 数组，不要任何解释文字或代码围栏。";
    var prompt = "源类型: " + sourceType + "\nURL 模板: " + (urlTemplate || "-") +
      "\n\n示例内容（供正则参考）:\n" + (sample || "(未提供)") +
      "\n\n请生成解析规则 JSON 数组。";
    var out = await chat(ac, prompt.slice(0, 12000), sys);
    var rules = extractJsonArray(out);
    if (!rules || !rules.length) throw new Error("AI 未能生成有效规则 JSON（" + out.slice(0, 80) + "…）");
    json(res, 200, { ok: true, rules: rules });
  } catch (e) { json(res, 502, { ok: false, error: e.message }); }
}

// 生成自定义任务脚本（async function run(ctx)）
async function genScript(req, res) {
  try {
    var b = JSON.parse(await readBody(req));
    var taskDesc = String(b.task_desc || "").trim();
    if (!taskDesc) { json(res, 400, { error: "task_desc 必填" }); return; }
    var ac = await getAiConfig();
    var sys = "你是 Node.js 定时任务脚本工程师。根据需求生成自定义任务脚本代码。约定：async function run(ctx){...}；ctx 提供 store（数据层，含 resourceAdd/resourceList/historyList/historyDelete 等）、mysql（lib/mysql 直连）、fetch（全局 fetch）、console；脚本返回 {status:'ok', resultMsg:'...'} 或 {status:'failed', error:'...'}。只输出完整可运行的 JS 代码，不要解释文字，不要 markdown 代码围栏。";
    var prompt = "任务需求: " + taskDesc + "\n\n生成脚本代码。";
    var out = await chat(ac, prompt.slice(0, 12000), sys);
    var code = extractCode(out);
    if (!code || !/function run/.test(code)) throw new Error("AI 生成内容不含 run 函数");
    json(res, 200, { ok: true, code: code });
  } catch (e) { json(res, 502, { ok: false, error: e.message }); }
}

module.exports = { saveConfig, getConfig, test, summarize, list, genRules, genScript };
