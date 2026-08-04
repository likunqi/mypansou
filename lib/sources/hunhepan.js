// 源适配器：混合盘 hunhepan.com（聚合夸克/百度/阿里/迅雷/UC）
// 反爬说明：请求带 wasm 生成的 x-sign 签名（自研算法，未逆向）。
// 本适配器用无头浏览器驱动真实页面搜索，挑战由浏览器自动完成。
// 依赖：playwright-core（项目依赖），浏览器二进制用本机 ms-playwright 目录。
const fs = require("fs");
const path = require("path");

let chromium = null;
let browser = null;
let launching = null;

function findExecutablePath() {
  // 依次尝试已知的 ms-playwright chromium 目录（按版本号倒序）
  var root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!fs.existsSync(root)) return null;
  var dirs = fs.readdirSync(root).filter(function (d) {
    return /^chromium-\d+$/.test(d) && fs.existsSync(path.join(root, d, "chrome-win64", "chrome.exe"));
  }).sort(function (a, b) {
    return parseInt(b.split("-")[1], 10) - parseInt(a.split("-")[1], 10);
  });
  return dirs.length ? path.join(root, dirs[0], "chrome-win64", "chrome.exe") : null;
}

function getChromium() {
  if (chromium) return Promise.resolve(chromium);
  try {
    chromium = require("playwright-core").chromium;
    return Promise.resolve(chromium);
  } catch (e) {
    return Promise.reject(new Error("playwright-core 未安装（npm i playwright-core），混合盘源不可用"));
  }
}

function getBrowser() {
  return getChromium().then(function (c) {
    if (browser && browser.isConnected()) return browser;
    if (launching) return launching;
    var exe = findExecutablePath();
    launching = c.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] }).then(function (b) {
      browser = b;
      launching = null;
      return b;
    }).catch(function (e) {
      launching = null;
      throw e;
    });
    return launching;
  });
}

// 去掉 <em> 等 HTML 标签
function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, "");
}

async function search(kw, opts) {
  var page = null;
  try {
    var b = await getBrowser();
    var ctx = await b.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "zh-CN",
    });
    page = await ctx.newPage();

    // 等待 /v1/search 响应（Promise 化）
    var searchResp = new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(null); }, 25000);
      page.on("response", function (res) {
        if (res.url().includes("/v1/search") && res.request().method() === "POST") {
          clearTimeout(timer);
          res.text().then(function (t) {
            try { resolve(JSON.parse(t)); } catch (e) { resolve(null); }
          }).catch(function () { resolve(null); });
        }
      });
    });

    await page.goto("https://hunhepan.com/search?keyword=" + encodeURIComponent(kw), {
      timeout: 20000,
      waitUntil: "domcontentloaded",
    });
    // 页面加载后给 device register/challenge 流程留时间（首次访问会注册设备）
    await page.waitForTimeout(4000);
    // 若 URL 无 q 参数（页面未自动搜索），手动触发一次
    if (!page.url().includes("q=")) {
      var inp = page.locator("input").first();
      if (await inp.count()) {
        await inp.fill(kw);
        await inp.press("Enter");
        await page.waitForTimeout(4000);
      }
    }

    var body = await searchResp;
    if (!body || !body.data || !Array.isArray(body.data.list)) {
      return { ok: false, error: (body && body.msg) || "混合盘搜索超时或无结果" };
    }
    var items = body.data.list.map(function (it) {
      var type = String(it.disk_type || "").toLowerCase();
      if (type === "alipan") type = "aliyun";
      return {
        title: stripTags(it.disk_name || "未命名"),
        url: it.link || "",
        pwd: "",
        disk_type: type,
        source: "hunhepan",
        extra: { share_user: it.share_user, update_time: it.update_time, tags: it.tags || [], files: it.files },
      };
    }).filter(function (it) { return it.url; });
    return { ok: true, items: items, total: body.data.total || items.length };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (page) { try { await page.context().close(); } catch (e) {} }
  }
}

module.exports = { search };
