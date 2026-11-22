// ai_unlock.js
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1";
const BLOCKED = ["CN", "HK", "MO", "RU", "BY", "IR", "KP", "CU", "SY"];

function get(url) {
  return new Promise((resolve) => {
    $httpClient.get({ url, headers: { "User-Agent": UA }, timeout: 8 }, (err, resp, data) => {
      if (err) resolve({ err: String(err) });
      else resolve({ status: resp.status, data: data || "" });
    });
  });
}

// 读取某个域名自己的出口地区（同一条链路）
async function getRegionFor(host) {
  const r = await get(`https://${host}/cdn-cgi/trace`);
  if (r.err || !r.data) return null;
  const m = r.data.match(/loc=([A-Z]{2})/);
  return m ? m[1] : null;
}

function regionText(code) {
  if (!code) return "未获取到";
  return BLOCKED.includes(code) ? `${code}（受限地区）` : code;
}

async function checkRegionalService(host, url) {
  const region = await getRegionFor(host);
  if (region && BLOCKED.includes(region)) return `❌ 受限地区（${region}）`;
  const r = await get(url);
  if (r.err) return `❔ 网络错误（${r.err}）`;
  if (r.status === 200) return `✅ 可用（${region || "地区未获取"}）`;
  return `❌ 不可用（HTTP ${r.status}，${region || "地区未获取"}）`;
}

async function checkGemini() {
  const r = await get("https://gemini.google.com/app");
  if (r.err) return `❔ 网络错误（${r.err}）`;
  if (r.status === 200 && !/not available in your country/i.test(r.data)) return "✅ 可用";
  return `❌ 不可用（HTTP ${r.status}）`;
}

async function checkYouTubePremium() {
  const r = await get("https://www.youtube.com/premium");
  if (r.err) return `❔ 网络错误（${r.err}）`;
  if (/not available in your country/i.test(r.data)) return "❌ 不支持该地区";
  if (r.status === 200) return "✅ 可用";
  return `❌ 不可用（HTTP ${r.status}）`;
}

async function checkNetflix() {
  const full = await get("https://www.netflix.com/title/70143836");
  const original = await get("https://www.netflix.com/title/80018499");
  if (full.err && original.err) return "❔ 网络错误";
  if (full.status === 200 && original.status === 200) return "✅ 完整解锁";
  if (original.status === 200) return "🟡 部分解锁（仅原创）";
  return "❌ 受限";
}

(async () => {
  const [openai, claude, gemini, youtube, netflix] = await Promise.all([
    checkRegionalService("chatgpt.com", "https://chatgpt.com/"),
    checkRegionalService("claude.ai", "https://claude.ai/"),
    checkGemini(),
    checkYouTubePremium(),
    checkNetflix()
  ]);
  $done({
    title: "流媒体与 AI 解锁检测",
    content: [
      `ChatGPT：${openai}`,
      `Claude：${claude}`,
      `Gemini：${gemini}`,
      `YouTube Premium：${youtube}`,
      `Netflix：${netflix}`
    ].join("\n"),
    icon: "checkmark.seal",
    "icon-color": "#34C759"
  });
})();
