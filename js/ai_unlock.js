const TIMEOUT = 8;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1";

// 不支持的国家/地区代码，可按官方最新支持列表自行调整
const OPENAI_BLOCKED = ["CN", "HK", "MO", "RU", "BY", "IR", "KP", "CU", "SY"];
const CLAUDE_BLOCKED = ["CN", "HK", "MO", "RU", "BY", "IR", "KP", "CU", "SY"];

function get(url) {
  return new Promise((resolve) => {
    $httpClient.get({ url, headers: { "User-Agent": UA }, timeout: TIMEOUT }, (err, resp, data) => {
      if (err) resolve({ error: String(err) });
      else resolve({ status: resp.status, body: data || "" });
    });
  });
}

function parseLoc(text) {
  const m = text.match(/loc=([A-Z]{2})/);
  return m ? m[1] : null;
}

async function checkTraceService(name, url, blockedList) {
  const r = await get(url);
  if (r.error) return `${name}: ⚠️ 连接失败`;
  const loc = parseLoc(r.body);
  if (!loc) return `${name}: ⚠️ 无法识别地区`;
  if (blockedList.includes(loc)) return `${name}: ❌ 地区受限 (${loc})`;
  return `${name}: ✅ 可用 (${loc})`;
}

async function checkGemini() {
  const r = await get("https://gemini.google.com/");
  if (r.error) return "Gemini: ⚠️ 连接失败";
  if (/not available in your (country|region)|isn't available/i.test(r.body)) return "Gemini: ❌ 地区受限";
  if (r.status === 200) return "Gemini: ✅ 可用（页面检测）";
  return `Gemini: ⚠️ 状态码 ${r.status}`;
}

async function checkNetflix() {
  // 80018499 为《Breaking Bad》的 Netflix 标题 ID，用于测试
  const r = await get("https://www.netflix.com/title/80018499");
  if (r.error) return "Netflix: ⚠️ 连接失败";
  const region = (r.body.match(/"countryCode":"([A-Z]{2})"/) || [])[1] || "未知";
  if (r.status === 200) return `Netflix: ✅ 完整解锁 (${region})`;
  if (r.status === 404) return `Netflix: 🟡 仅自制剧 (${region})`;
  return `Netflix: ❌ 不可用 (${r.status})`;
}

async function checkYouTubePremium() {
  const r = await get("https://www.youtube.com/premium");
  if (r.error) return "YouTube Premium: ⚠️ 连接失败";
  const region = (r.body.match(/"GL":"([A-Z]{2})"/) || [])[1] || "未知";
  if (/Premium is not available in your country/i.test(r.body)) return `YouTube Premium: ❌ 不支持 (${region})`;
  return `YouTube Premium: ✅ 可用 (${region})`;
}

(async () => {
  const results = await Promise.all([
    checkTraceService("ChatGPT", "https://chat.openai.com/cdn-cgi/trace", OPENAI_BLOCKED),
    checkTraceService("Claude", "https://claude.ai/cdn-cgi/trace", CLAUDE_BLOCKED),
    checkGemini(),
    checkNetflix(),
    checkYouTubePremium(),
  ]);

  const allOk = results.every((s) => s.includes("✅"));
  const anyBad = results.some((s) => s.includes("❌"));
  $done({
    title: "流媒体 & AI 解锁检测",
    content: results.join("\n"),
    icon: "checkmark.seal.fill",
    "icon-color": allOk ? "#2ecc71" : anyBad ? "#e74c3c" : "#f1c40f",
  });
})();
