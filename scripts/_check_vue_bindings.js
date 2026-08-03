// scripts/_check_vue_bindings.js — 校验 Vue 模板事件绑定与 setup return 导出一致性
// 用法: node scripts/_check_vue_bindings.js [文件...]  （默认 index.html search.html admin.html）
// 检查：模板中 @click/@keydown/@focus/@blur/@change 等绑定的事件处理函数是否都在 setup return 中导出
const fs = require("fs");
const path = require("path");

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["public/index.html", "public/search.html", "public/admin.html"];

files.forEach(function (file) {
  const fp = path.join(__dirname, "..", file);
  let s;
  try { s = fs.readFileSync(fp, "utf8"); } catch (e) { console.log("SKIP(无文件):", file); return; }

  // 提取模板（script 前）
  const si = s.lastIndexOf("<script>");
  const tpl = s.slice(0, si);

  // 1. 模板中所有事件绑定里的函数名：@click="fn" / @keydown.enter="fn" / @focus="fn" 等
  const binds = new Set();
  const re = /@(?:[a-z-]+\.)?[a-z-]+="([A-Za-z_$][\w$]*)"/g;
  let m;
  while ((m = re.exec(tpl))) {
    // 排除 v-if/v-for 等非事件指令的表达式（@ 后必须是事件名，这里只取简单标识符）
    const full = m[0];
    if (/^@(?:click|keydown|focus|blur|change|input|mousedown|mouseenter|mouseleave|submit|dblclick|contextmenu|touchstart|touchend|keyup|keypress|pointerdown|pointerup)/.test(full)) {
      binds.add(m[1]);
    }
  }

  // 2. setup return 中导出的标识符（取最后一个 return{，即 setup 的返回对象）
  const setupStart = s.indexOf("setup:function(){");
  let depth = 0, j = setupStart;
  for (; j < s.length; j++) { const c = s[j]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) break; } }
  const setupSrc = s.slice(setupStart, j + 1);
  const rpos = Math.max(setupSrc.lastIndexOf("return{"), setupSrc.lastIndexOf("return {"));
  // 从 return 的 { 开始括号配平，定位 return 对象结束
  let rd = 0, k = rpos;
  for (; k >= 0 && k < setupSrc.length; k++) {
    const c = setupSrc[k];
    if (c === "{") rd++;
    else if (c === "}") { rd--; if (rd === 0) break; }
  }
  const retStr = rpos !== -1 && k > rpos ? setupSrc.slice(rpos + 1, k) : "";
  const exported = new Set();
  if (retStr) {
    retStr.split(",").forEach(function (item) {
      const t = item.trim();
      if (!t) return;
      const eq = t.split(":");
      const key = eq[0].trim();
      exported.add(key.replace(/^(['"])(.*)\1$/, "$2"));
    });
  }

  // 3. 对比
  const missing = [];
  binds.forEach(function (b) { if (!exported.has(b)) missing.push(b); });
  if (missing.length) {
    console.log("FAIL:", file, "模板绑定但未导出 ->", missing.join(", "));
  } else {
    console.log("PASS:", file, "模板绑定(" + binds.size + ") 全部已导出");
  }
});
