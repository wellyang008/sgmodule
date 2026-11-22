const BLOCKED = ["CN", "HK", "MO", "RU", "BY", "IR", "KP", "CU", "SY"];
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1";

function httpGet(url) {
  return new Promise((resolve) => {
    $httpClient.get({ url, headers: { "User-Agent": UA }, timeout: 10 }, (err, resp, body) => {
      if (err) resolve({ error: err });
      else resolve({ status: resp.status, headers: resp.headers || {}, body: body || "" });
    });
  });
}

async function checkClaude() {
  // 1. 地区检测：用 claude.ai 自己域名下的 trace，确保出口一致
  const trace = await httpGet("https://claude.ai/cdn-cgi/trace");
  if (trace.error) return { status: "❔", text: "网络错误" };

  const locMatch = trace.body.match(/loc=([A-Z]{2})/);
  const loc = locMatch ? locMatch[1] : "UNKNOWN";
  if (BLOCKED.includes(loc)) {
    return { status: "❌", text: `受限地区 (${loc})` };
  }

  // 2. 页面检测：判断能否真正打开 Claude
  const page = await httpGet("https://claude.ai/login");
  if (page.error) return { status: "❔", text: `网络错误 (${loc})` };

  const h = page.headers;
  const cfMitigated = (h["cf-mitigated"] || h["Cf-Mitigated"] || "").toLowerCase() === "challenge";
  const isChallenge = cfMitigated || /challenge|just a moment|cf-chl/i.test(page.body);

  if (page.status === 200 && !isChallenge) {
    return { status: "✅", text: `可用 (${loc})` };
  }
  if (isChallenge || page.status === 403 || page.status === 429) {
    // Cloudflare 风控拦截，地区本身并不受限
    return { status: "⚠️", text: `风控拦截 (${loc}, HTTP ${page.status})` };
  }
  return { status: "❌", text: `不可用 (${loc}, HTTP ${page.status})` };
}

(async () => {
  const claude = await checkClaude();
  $done({
    title: "Claude 检测",
    content: `${claude.status} ${claude.text}`,
    icon: "checkmark.seal"
  });
})();
