const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1";
const BLOCKED = ["CN", "HK", "MO", "RU", "BY", "IR", "KP", "CU", "SY"];

function request(url) {
  return new Promise((resolve) => {
    $httpClient.get({ url, headers: { "User-Agent": UA }, timeout: 10 }, (err, resp, body) => {
      if (err || !resp) resolve({ error: true });
      else resolve({ status: resp.status, headers: resp.headers || {}, body: body || "" });
    });
  });
}

async function getRegion(host) {
  const r = await request(`https://${host}/cdn-cgi/trace`);
  if (r.error || r.status !== 200) return null;
  const m = r.body.match(/loc=([A-Z]{2})/);
  return m ? m[1] : null;
}

function isChallenge(r) {
  const b = r.body.toLowerCase();
  return (r.headers["cf-mitigated"] || "").includes("challenge") ||
    b.includes("cf-challenge") || b.includes("just a moment");
}

// Claude：只根据 loc 判断
async function checkClaude() {
  const loc = await getRegion("claude.ai");
  if (!loc) return "❔ 网络错误";
  if (BLOCKED.includes(loc)) return `❌ 受限地区 (${loc})`;
  return `✅ 地区可用 (${loc})`;
}

// ChatGPT：地区 + 页面探测
async function checkChatGPT() {
  const loc = await getRegion("chatgpt.com");
  if (!loc) return "❔ 网络错误";
  if (BLOCKED.includes(loc)) return `❌ 受限地区 (${loc})`;
  const r = await request("https://chatgpt.com/");
  if (r.error) return "❔ 网络错误";
  if (isChallenge(r) || r.status === 403 || r.status === 429) return `⚠️ 风控拦截 (${loc})`;
  if (r.status === 200) return `✅ 可用 (${loc})`;
  return `❌ 不可用 (${loc})`;
}

// Gemini
async function checkGemini() {
  const r = await request("https://gemini.google.com/");
  if (r.error) return "❔ 网络错误";
  if (r.status === 200 && !r.body.includes("not available in your country")) return "✅ 可用";
  return "❌ 不可用";
}

// YouTube Premium
async function checkYouTube() {
  const r = await request("https://www.youtube.com/premium");
  if (r.error) return "❔ 网络错误";
  if (r.status === 200 && !r.body.includes("Premium is not available in your country")) return "✅ 可用";
  return "❌ 不可用";
}

// Netflix：两个测试页面
async function checkNetflix() {
  const full = await request("https://www.netflix.com/title/70143836");
  const orig = await request("https://www.netflix.com/title/80018499");
  if (full.error && orig.error) return "❔ 网络错误";
  if (full.status === 200 && orig.status === 200) return "✅ 完整解锁";
  if (orig.status === 200) return "🟡 部分解锁（仅自制剧）";
  return "❌ 不可用";
}

(async () => {
  const [claude, chatgpt, gemini, netflix, youtube] = await Promise.all([
    checkClaude(), checkChatGPT(), checkGemini(), checkNetflix(), checkYouTube()
  ]);
  const content = [
    `Claude: ${claude}`,
    `ChatGPT: ${chatgpt}`,
    `Gemini: ${gemini}`,
    `Netflix: ${netflix}`,
    `YouTube Premium: ${youtube}`
  ].join("\n");
  $done({ title: "AI & 流媒体解锁检测", content, icon: "checkmark.seal", "icon-color": "#4CAF50" });
})();
