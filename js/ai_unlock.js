const TIMEOUT = 8;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1";

// 按官方公布的支持地区自行维护，代码为 ISO 3166-1 alpha-2
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

// 检测结果统一格式：{ name, state, text }
// state: "ok" 可用 / "blocked" 受限 / "unknown" 无法判断
function result(name, state, text) {
  const icon = { ok: "✅", blocked: "❌", unknown: "❔" }[state];
  return { name, state, line: `${name}: ${icon} ${text}` };
}

// 通过 Cloudflare trace 获取出口地区，ChatGPT 与 Claude 都可用此方式
async function checkByTrace(name, url, blockedList) {
  const r = await get(url);
  if (r.error) return result(name, "unknown", "无法判断（请求失败）");
  if (r.status !== 200) return result(name, "unknown", `无法判断（HTTP ${r.status}）`);

  const m = r.body.match(/loc=([A-Z]{2})/);
  if (!m) return result(name, "unknown", "无法判断（返回内容中没有地区信息）");

  const loc = m[1];
  if (blockedList.includes(loc)) return result(name, "blocked", `地区受限（${loc}）`);
  return result(name, "ok", `可用（出口地区 ${loc}）`);
}

// Gemini 没有公开的地区接口，只能判断页面能否访问，无法给出地区
async function checkGemini() {
  const r = await get("https://gemini.google.com/");
  if (r.error) return result("Gemini", "unknown", "无法判断（请求失败）");
  if (r.status === 200) return result("Gemini", "ok", "页面可访问（地区未知）");
  return result("Gemini", "unknown", `无法判断（HTTP ${r.status}）`);
}

// Netflix 用固定标题判断：200 表示该地区可访问完整目录，404 通常表示仅自制剧或不可用
async function checkNetflix() {
  const r = await get("https://www.netflix.com/title/80018499");
  if (r.error) return result("Netflix", "unknown", "无法判断（请求失败）");
  const m = r.body.match(/"countryCode":"([A-Z]{2})"/);
  const region = m ? m[1] : "地区未知";
  if (r.status === 200) return result("Netflix", "ok", `可用（${region}）`);
  if (r.status === 404) return result("Netflix", "blocked", `仅自制剧或不可用（${region}）`);
  return result("Netflix", "unknown", `无法判断（HTTP ${r.status}）`);
}

async function checkYouTubePremium() {
  const r = await get("https://www.youtube.com/premium");
  if (r.error) return result("YouTube Premium", "unknown", "无法判断（请求失败）");
  if (r.status !== 200) return result("YouTube Premium", "unknown", `无法判断（HTTP ${r.status}）`);
  const m = r.body.match(/"GL":"([A-Z]{2})"/);
  const region = m ? m[1] : "地区未知";
  if (/Premium is not available in your country/i.test(r.body)) {
    return result("YouTube Premium", "blocked", `不支持（${region}）`);
  }
  return result("YouTube Premium", "ok", `可用（${region}）`);
}

(async () => {
  const items = await Promise.all([
    checkByTrace("ChatGPT", "https://chat.openai.com/cdn-cgi/trace", OPENAI_BLOCKED),
    checkByTrace("Claude", "https://claude.ai/cdn-cgi/trace", CLAUDE_BLOCKED),
    checkGemini(),
    checkNetflix(),
    checkYouTubePremium(),
  ]);

  const states = items.map((i) => i.state);
  let color = "#f1c40f";
  if (states.every((s) => s === "ok")) color = "#2ecc71";
  else if (states.includes("blocked")) color = "#e74c3c";

  $done({
    title: "流媒体 & AI 解锁检测",
    content: items.map((i) => i.line).join("\n"),
    icon: "checkmark.seal.fill",
    "icon-color": color,
  });
})();
