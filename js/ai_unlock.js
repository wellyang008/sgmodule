// AI & Global Media Region Checker for Surge
// Service-specific signals are used. "Available" means the service's public region check passed,
// not that a signed-in account, subscription, or every title is guaranteed to work.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" };

function request(url, options) {
  options = options || {};
  return new Promise(function(resolve) {
    const req = {
      url: url,
      method: options.method || "GET",
      headers: options.headers || HEADERS,
      timeout: options.timeout || 12,
      "auto-redirect": options.autoRedirect !== false
    };
    if (options.body) req.body = options.body;
    const method = (options.method || "GET").toLowerCase();
    const client = method === "post" ? $httpClient.post : $httpClient.get;
    client(req, function(error, response, body) {
      resolve({
        error: error ? String(error) : null,
        status: response ? Number(response.status) : 0,
        headers: response && response.headers ? response.headers : {},
        body: typeof body === "string" ? body : ""
      });
    });
  });
}

function header(headers, name) {
  if (!headers) return "";
  const wanted = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === wanted) return String(headers[keys[i]]);
  }
  return "";
}

function flag(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(127397 + code.charCodeAt(0), 127397 + code.charCodeAt(1));
}

function labelRegion(code) {
  return code ? flag(code) + code : "地区未知";
}

function parseTrace(body, key) {
  const re = new RegExp("(?:^|\\n)" + key + "=([A-Z]{2})(?:\\n|$)", "i");
  const match = String(body || "").match(re);
  return match ? match[1].toUpperCase() : "";
}

function result(name, text, detail) {
  return { name: name, text: text, detail: detail || "" };
}

async function checkClaude() {
  const r = await request("https://claude.ai/cdn-cgi/trace");
  if (r.error || r.status < 200 || r.status >= 400) return result("Claude", "检测失败", "trace 请求异常");
  const code = parseTrace(r.body, "loc");
  if (!code) return result("Claude", "地区未知", "未取得 Cloudflare loc");
  const blocked = ["AF","BY","CN","CU","HK","IR","KP","MO","RU","SY"];
  return result("Claude", blocked.indexOf(code) >= 0 ? "地区不支持" : "地区检测通过", labelRegion(code));
}

async function checkGemini() {
  const r = await request("https://gemini.google.com/");
  if (r.error || r.status < 200 || r.status >= 400) return result("Gemini", "检测失败", "HTTP " + r.status);
  const body = r.body || "";
  let code = "";
  const marker = body.indexOf(',2,1,200,"');
  if (marker >= 0) {
    const candidate = body.slice(marker + 10, marker + 13);
    if (/^[A-Z]{3}$/.test(candidate)) code = candidate;
  }
  if (!code) {
    const m = body.match(/"(?:countryCode|country_code|GL)"\s*:\s*"([A-Z]{2,3})"/);
    if (m) code = m[1].toUpperCase();
  }
  if (!code) return result("Gemini", "无法判定", "页面可访问，但未提取到地区标记");
  const blocked = ["CHN","RUS","BLR","CUB","IRN","PRK","SYR","HKG","MAC"];
  return result("Gemini", blocked.indexOf(code) >= 0 ? "地区不支持" : "地区检测通过", "Google 地区码 " + code);
}

async function checkOpenAI() {
  const checks = await Promise.all([
    request("https://chat.openai.com/cdn-cgi/trace"),
    request("https://api.openai.com/compliance/cookie_requirements"),
    request("https://ios.chat.openai.com/")
  ]);
  const trace = checks[0], web = checks[1], ios = checks[2];
  const code = parseTrace(trace.body, "loc");
  let webText = "无法判定";
  const webBody = (web.body || "").toLowerCase();
  if (web.error) webText = "连接失败";
  else if (webBody.indexOf("unsupported_country") >= 0 || webBody.indexOf("unsupported country") >= 0) webText = "地区不支持";
  else if (web.status >= 200 && web.status < 400 && web.body.length > 0) webText = "接口检测通过";
  else if (web.status >= 400) webText = "接口异常 HTTP " + web.status;

  let iosText = "无法判定";
  const iosBody = (ios.body || "").toLowerCase();
  if (ios.error) iosText = "连接失败";
  else if (iosBody.indexOf("disallowed isp") >= 0) iosText = "ISP 不支持";
  else if (iosBody.indexOf("request is not allowed. please try again later.") >= 0) iosText = "接口检测通过";
  else if (iosBody.indexOf("you have been blocked") >= 0) iosText = "出口 IP 被封锁";
  else if (ios.status >= 400) iosText = "接口异常 HTTP " + ios.status;

  return result("OpenAI", "Web " + webText + " / iOS " + iosText, labelRegion(code));
}

async function checkYouTube() {
  const r = await request("https://www.youtube.com/premium?hl=en");
  if (r.error || r.status < 200 || r.status >= 400) return result("YouTube Premium", "检测失败", "HTTP " + r.status);
  const body = r.body || "";
  const lower = body.toLowerCase();
  const blocked = lower.indexOf("youtube premium is not available in your country") >= 0 ||
    lower.indexOf("premium is not available in your country") >= 0 ||
    lower.indexOf("premium is not available in your region") >= 0;
  let code = "";
  const patterns = [
    /id=["']country-code["'][^>]*>\s*([A-Za-z]{2})\s*</,
    /"GL"\s*:\s*"([A-Z]{2})"/,
    /"countryCode"\s*:\s*"([A-Z]{2})"/,
    /"country_code"\s*:\s*"([A-Z]{2})"/
  ];
  for (let i = 0; i < patterns.length && !code; i++) {
    const m = body.match(patterns[i]);
    if (m) code = m[1].toUpperCase();
  }
  if (blocked) return result("YouTube Premium", "该地区不可用", labelRegion(code));
  if (lower.indexOf("youtube premium") >= 0 || lower.indexOf("ad-free") >= 0 || lower.indexOf('"browseid":"spunlimited"') >= 0) {
    return result("YouTube Premium", "页面特征检测通过", labelRegion(code));
  }
  return result("YouTube Premium", "无法判定", "未匹配到 Premium 页面特征");
}

async function checkNetflix() {
  const ids = ["81280792", "70143836"];
  const checks = await Promise.all(ids.map(function(id) {
    return request("https://www.netflix.com/title/" + id, { autoRedirect: false });
  }));
  if (checks.some(function(r) { return r.error || !r.status; })) {
    return result("Netflix", "检测失败", "标题接口连接异常");
  }
  const statuses = checks.map(function(r) { return r.status; });
  if (statuses[0] === 404 && statuses[1] === 404) {
    return result("Netflix", "仅自制剧可用", "两个地区版权测试标题均不可用");
  }
  if (statuses[0] === 403 || statuses[0] === 451 || statuses[1] === 403 || statuses[1] === 451) {
    return result("Netflix", "可能被地区限制", "标题接口返回 403/451");
  }
  if (statuses.some(function(s) { return s === 200 || s === 301 || s === 302; })) {
    const regionCheck = await request("https://www.netflix.com/title/80018499", { autoRedirect: false });
    const location = header(regionCheck.headers, "location");
    const m = location.match(/\/([a-z]{2})-[a-z]{2}\//i);
    const code = m ? m[1].toUpperCase() : "";
    return result("Netflix", "完整片库测试通过", code ? labelRegion(code) : "地区未能提取");
  }
  return result("Netflix", "无法判定", "标题测试 HTTP " + statuses.join("/"));
}

async function checkSpotify() {
  const r = await request("https://www.spotify.com/api/content/v1/country-selector?platform=web&format=json", { autoRedirect: false });
  if (r.error || !r.status) return result("Spotify", "检测失败", "地区接口连接异常");
  const location = header(r.headers, "location");
  let code = "";
  const m = location.match(/\/([a-z]{2})(?:-[a-z]{2})?\//i);
  if (m) code = m[1].toUpperCase();
  if (!code) {
    const b = r.body.match(/"countryCode"\s*:\s*"([A-Z]{2})"/i);
    if (b) code = b[1].toUpperCase();
  }
  if (r.status >= 200 && r.status < 400 && code) return result("Spotify", "地区接口检测通过", labelRegion(code));
  if (r.status === 403 || r.status === 451) return result("Spotify", "可能不可用", "HTTP " + r.status);
  return result("Spotify", "无法判定", "未提取到地区码，HTTP " + r.status);
}

async function checkTikTok() {
  const r = await request("https://www.tiktok.com/cdn-cgi/trace");
  if (r.error || r.status < 200 || r.status >= 400) return result("TikTok", "检测失败", "trace 请求异常");
  const body = r.body || "";
  const match = body.match(/"region"\s*:\s*"([A-Za-z-]+)"/);
  let code = "";
  if (match) {
    const parts = match[1].toUpperCase().split("-");
    code = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  }
  if (/^[A-Z]{2}$/.test(code)) return result("TikTok", "地区信号检测通过", labelRegion(code));
  if (/access denied|not available in your region|tiktok is not available/i.test(body)) {
    return result("TikTok", "可能受地区限制", "页面返回限制特征");
  }
  return result("TikTok", "无法判定", "未提取到 region 字段");
}

async function checkDisney() {
  const r = await request("https://www.disneyplus.com/");
  if (r.error || r.status < 200 || r.status >= 400) return result("Disney+", "检测失败", "HTTP " + r.status);
  const body = r.body || "";
  const match = body.match(/"region"\s*:\s*"([A-Z]{2})"/i) || body.match(/"countryCode"\s*:\s*"([A-Z]{2})"/i);
  const code = match ? match[1].toUpperCase() : "";
  if (/preview|unavailable in your region|not available in your country/i.test(body)) {
    return result("Disney+", "页面提示地区不可用", labelRegion(code));
  }
  return result("Disney+", "入口可访问", (code ? labelRegion(code) : "地区未知") + "；未验证账号及实际播放权限");
}

async function main() {
  const jobs = [
    checkClaude(),
    checkGemini(),
    checkOpenAI(),
    checkYouTube(),
    checkNetflix(),
    checkDisney(),
    checkSpotify(),
    checkTikTok()
  ];
  const values = await Promise.all(jobs);
  const lines = values.map(function(item) {
    return item.name + "： " + item.text + "（" + item.detail + "）";
  });
  const uncertain = values.filter(function(item) {
    return /无法判定|检测失败|地区未知/.test(item.text);
  }).length;
  $done({
    title: "AI / 海外媒体解锁检测",
    content: lines.join("\n") + "\n\n说明：地区检测通过不等于账号资格、订阅状态或所有内容均可用。Disney+ 当前只做入口及地区线索检测。",
    icon: uncertain > 0 ? "exclamationmark.triangle" : "checkmark.circle",
    "icon-color": uncertain > 0 ? "#FF9500" : "#34C759"
  });
}

main().catch(function(error) {
  $done({
    title: "AI / 海外媒体解锁检测",
    content: "检测脚本异常：" + String(error),
    icon: "exclamationmark.triangle",
    "icon-color": "#FF3B30"
  });
});
