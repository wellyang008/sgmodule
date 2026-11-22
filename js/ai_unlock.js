const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1";
const BLOCKED = ["CN", "HK", "MO", "RU", "BY", "IR", "KP", "CU", "SY"];

function httpGet(url) {
  return new Promise((resolve) => {
    $httpClient.get({ url, headers: { "User-Agent": UA }, timeout: 10 }, (err, resp, body) => {
      if (err) resolve({ error: err });
      else resolve({ status: resp.status, headers: resp.headers || {}, body: body || "" });
    });
  });
}

function parseLoc(text) {
  const m = (text || "").match(/loc=([A-Z]{2})/);
  return m ? m[1] : "UNKNOWN";
}

// ChatGPT：用 chatgpt.com 自己域名的 trace 判断地区，再检测页面
async function checkChatGPT() {
  const trace = await httpGet("https://chatgpt.com/cdn-cgi/trace");
  if (trace.error) return { status: "❔", text: "网络错误" };
  const loc = parseLoc(trace.body);
  if (BLOCKED.includes(loc)) return { status: "❌", text: `受限地区 (${loc})` };

  const page = await httpGet("https://chatgpt.com/");
  if (page.error) return { status: "❔", text: `网络错误 (${loc})` };
  if (page.status === 200) return { status: "✅", text: `可用 (${loc})` };
  if (page.status === 403 || page.status === 429) return { status: "⚠️", text: `风控拦截 (${loc}, HTTP ${page.status})` };
  return { status: "❌", text: `不可用 (${loc}, HTTP ${page.status})` };
}

// Claude：先用 trace 判断地区，再检测页面，并区分 Cloudflare 风控与地区限制
async function checkClaude() {
  const trace = await httpGet("https://claude.ai/cdn-cgi/trace");
  if (trace.error) return { status: "❔", text: "网络错误" };
  const loc = parseLoc(trace.body);
  if (BLOCKED.includes(loc)) return { status: "❌", text: `受限地区 (${loc})` };

  const page = await httpGet("https://claude.ai/login");
  if (page.error) return { status: "❔", text: `网络错误 (${loc})` };

  const h = page.headers;
  const cfMitigated = (h["cf-mitigated"] || h["Cf-Mitigated"] || "").toLowerCase() === "challenge";
  const isChallenge = cfMitigated || /challenge|just a moment|cf-chl/i.test(page.body);

  if (page.status === 200 && !isChallenge) return { status: "✅", text: `可用 (${loc})` };
  if (isChallenge || page.status === 403 || page.status === 429) {
    return { status: "⚠️", text: `风控拦截 (${loc}, HTTP ${page.status})` };
  }
  return { status: "❌", text: `不可用 (${loc}, HTTP ${page.status})` };
}

// Gemini：HTTP 200 且页面没有"不支持所在地区"提示
async function checkGemini() {
  const r = await httpGet("https://gemini.google.com/");
  if (r.error) return { status: "❔", text: "网络错误" };
  const blocked = /not available in your country|not supported in your country/i.test(r.body);
  if (r.status === 200 && !blocked) return { status: "✅", text: "可用" };
  if (blocked) return { status: "❌", text: "受限地区" };
  return { status: "❌", text: `不可用 (HTTP ${r.status})` };
}

// Netflix：两个测试页面都 200 为完整解锁，只有 80018499 为部分解锁
async function checkNetflix() {
  const full = await httpGet("https://www.netflix.com/title/70143836");
  const orig = await httpGet("https://www.netflix.com/title/80018499");
  if (full.error && orig.error) return { status: "❔", text: "网络错误" };

  const fullOk = full.status === 200;
  const origOk = orig.status === 200;
  if (fullOk && origOk) return { status: "✅", text: "完整解锁" };
  if (origOk) return { status: "🟡", text: "部分解锁（仅自制剧）" };
  return { status: "❌", text: "受限地区" };
}

// YouTube Premium：HTTP 200 且页面没有地区不可用提示
async function checkYouTube() {
  const r = await httpGet("https://www.youtube.com/premium");
  if (r.error) return { status: "❔", text: "网络错误" };
  const blocked = /Premium is not available in your country|not available in your country/i.test(r.body);
  if (r.status === 200 && !blocked) return { status: "✅", text: "可用" };
  if (blocked) return { status: "❌", text: "受限地区" };
  return { status: "❌", text: `不可用 (HTTP ${r.status})` };
}

(async () => {
  const [chatgpt, claude, gemini, netflix, youtube] = await Promise.all([
    checkChatGPT(),
    checkClaude(),
    checkGemini(),
    checkNetflix(),
    checkYouTube()
  ]);

  const lines = [
    `ChatGPT：${chatgpt.status} ${chatgpt.text}`,
    `Claude：${claude.status} ${claude.text}`,
    `Gemini：${gemini.status} ${gemini.text}`,
    `Netflix：${netflix.status} ${netflix.text}`,
    `YouTube Premium：${youtube.status} ${youtube.text}`
  ];

  $done({
    title: "AI & 流媒体解锁检测",
    content: lines.join("\n"),
    icon: "globe.asia.australia",
    "icon-color": "#4A90E2"
  });
})();
