// AI / Media availability checker for Surge
// Results distinguish service access, regional restrictions and playback evidence.
// Anonymous checks cannot prove account entitlement or DRM playback.

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "en-US,en;q=0.9"
};

function request(method, url, body, headers, redirect, timeout) {
  return new Promise(function(resolve) {
    const opts = {
      url: url,
      headers: Object.assign({}, HEADERS, headers || {}),
      timeout: timeout || 18,
      "auto-redirect": redirect !== false
    };
    if (body !== undefined && body !== null) {
      opts.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const done = function(err, res, data) {
      resolve({
        error: !!err,
        status: res ? Number(res.status) : 0,
        headers: res && res.headers ? res.headers : {},
        body: typeof data === "string" ? data : "",
        url: res && res.url ? res.url : url
      });
    };
    if (method === "POST") $httpClient.post(opts, done);
    else $httpClient.get(opts, done);
  });
}
function get(url, redirect, headers) {
  return request("GET", url, null, headers, redirect, 18);
}
function post(url, body, headers) {
  return request("POST", url, body, Object.assign({"Content-Type":"application/json"}, headers || {}), true, 20);
}
function json(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}
function header(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find(function(k) { return k.toLowerCase() === name.toLowerCase(); });
  return key ? String(headers[key] || "") : "";
}
function countryFromText(text) {
  const m = String(text || "").match(/(?:^|\n)loc=([A-Z]{2})(?:\n|$)/);
  return m ? m[1] : "";
}
function countryFlag(code) {
  if (!/^[A-Z]{2}$/.test(code || "")) return "未知";
  return String.fromCodePoint(127397 + code.charCodeAt(0), 127397 + code.charCodeAt(1)) + " " + code;
}
function result(name, status, region) {
  return {name:name, status:status, region:region || "未知"};
}
function isBlocked(r) {
  return !!r && (r.status === 403 || r.status === 451 ||
    /unsupported[_ ]country|not available in your (country|region)|not available in your location|service is not available in your region|this service is unavailable in your region|country is not supported|地域.*不支持|所在国家或地区.*不可用/i.test(r.body || ""));
}
function isReachable(r) {
  return !!r && !r.error && r.status >= 200 && r.status < 400;
}
function extractObject(source, marker) {
  const start = String(source || "").indexOf(marker);
  if (start < 0) return null;
  const open = source.indexOf("{", start + marker.length);
  if (open < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return json(source.slice(open, i + 1));
    }
  }
  return null;
}
async function trace(host) {
  return get("https://" + host + "/cdn-cgi/trace", false);
}
async function regionFor(host) {
  const r = await trace(host);
  return countryFromText(r.body);
}

// AI checks: verifies the actual product entry point and explicit regional blocks.
// It does not claim that an unauthenticated account can send prompts.
async function aiCheck(name, host, url, markers) {
  const pair = await Promise.all([get(url, false), regionFor(host)]);
  const r = pair[0], country = pair[1];
  const region = countryFlag(country);
  if (isBlocked(r)) return result(name, "地区受限", region);
  if (r.error || !r.status) return result(name, "不可访问", region);
  if (r.status === 429) return result(name, "请求受限", region);
  if (!isReachable(r)) return result(name, "未确认", region);
  const body = r.body || "";
  if (markers.some(function(x) { return x.test(body); })) {
    return result(name, "入口可用", region);
  }
  return result(name, "未确认", region);
}
async function claude() {
  return aiCheck("Claude", "claude.ai", "https://claude.ai/", [/claude\.ai|anthropic|claude/i]);
}
async function gemini() {
  return aiCheck("Gemini", "gemini.google.com", "https://gemini.google.com/", [/gemini|bard|batchexecute/i]);
}
async function openai() {
  const pair = await Promise.all([
    get("https://chatgpt.com/", false),
    regionFor("chatgpt.com")
  ]);
  const r = pair[0], country = pair[1], region = countryFlag(country);
  const supported = [
    "AL","DZ","AD","AO","AG","AR","AM","AU","AT","AZ","BS","BD","BB","BE","BZ","BJ","BT","BA","BW","BR","BG","BF","CV","CA","CL","CO","KM","CR","HR","CY","CZ","DK","DJ","DM","DO","EC","SV","EE","FJ","FI","FR","GA","GM","GE","DE","GH","GR","GD","GT","GN","GW","GY","HT","HN","HU","IS","IN","ID","IQ","IE","IL","IT","JM","JP","JO","KZ","KE","KI","KW","KG","LV","LB","LS","LR","LI","LT","LU","MG","MW","MY","MV","ML","MT","MH","MR","MU","MX","MC","MN","ME","MA","MZ","MM","NA","NR","NP","NL","NZ","NI","NE","NG","MK","NO","OM","PK","PW","PA","PG","PE","PH","PL","PT","QA","RO","RW","KN","LC","VC","WS","SM","ST","SN","RS","SC","SL","SG","SK","SI","SB","ZA","ES","LK","SR","SE","CH","TH","TG","TO","TT","TN","TR","TV","UG","AE","US","UY","VU","ZM","BO","BN","CG","VA","FM","MD","PS","KR","TW","TZ","TL","GB"
  ];
  if (isBlocked(r)) return result("OpenAI", "地区受限", region);
  if (r.error || !r.status) return result("OpenAI", "不可访问", region);
  if (r.status === 429) return result("OpenAI", "请求受限", region);
  if (!isReachable(r) || !/chatgpt|openai/i.test(r.body)) return result("OpenAI", "未确认", region);
  if (country && supported.indexOf(country) < 0) return result("OpenAI", "地区不支持", region);
  return result("OpenAI", country ? "入口可用" : "入口可用" , region);
}

// YouTube: inspect the player response for a real test video, not the homepage.
async function youtube() {
  const pair = await Promise.all([
    get("https://www.youtube.com/watch?v=jNQXAC9IVRw&hl=en", false),
    regionFor("www.youtube.com")
  ]);
  const r = pair[0], country = pair[1], region = countryFlag(country);
  if (isBlocked(r) || /sorry\/index|video unavailable in your country|not available in your country/i.test(r.body)) {
    return result("YouTube", "地区受限", region);
  }
  if (r.error || !r.status) return result("YouTube", "不可访问", region);
  const p = extractObject(r.body, "ytInitialPlayerResponse");
  const ps = p && p.playabilityStatus;
  if (ps && ps.status === "OK" && p.streamingData &&
      ((p.streamingData.formats && p.streamingData.formats.length) ||
       (p.streamingData.adaptiveFormats && p.streamingData.adaptiveFormats.length) ||
       p.streamingData.hlsManifestUrl || p.streamingData.dashManifestUrl)) {
    return result("YouTube", "测试视频可播放", region);
  }
  if (ps && /AGE|LOGIN|PRIVATE|UNAVAILABLE|GEO|COUNTRY|REGION/i.test(String(ps.status) + " " + String(ps.reason || ""))) {
    return result("YouTube", "播放受限", region);
  }
  return result("YouTube", "未确认", region);
}

// Netflix: title metadata is a content/catalog check. Playback requires a signed-in
// session and DRM license, so this script never labels a title as actually playing.
async function netflix() {
  const ids = ["81280792", "80018499"];
  const pair = await Promise.all([
    Promise.all(ids.map(function(id) { return get("https://www.netflix.com/title/" + id, false); })),
    regionFor("www.netflix.com")
  ]);
  const rs = pair[0], region = countryFlag(pair[1]);
  if (rs.every(function(r) { return r.error || !r.status; })) return result("Netflix", "不可访问", region);
  if (rs.every(isBlocked)) return result("Netflix", "地区受限", region);
  let visible = 0;
  rs.forEach(function(r, i) {
    if (isReachable(r) && r.body.indexOf(ids[i]) >= 0) visible++;
  });
  if (visible === ids.length) return result("Netflix", "测试内容可访问", region);
  if (visible > 0) return result("Netflix", "部分内容可访问", region);
  if (rs.some(function(r) { return r.status === 404; })) return result("Netflix", "内容可能受限", region);
  return result("Netflix", "未确认", region);
}

// Disney+: use its device registration response to determine supported location.
// This is a region-support signal, not proof of account playback entitlement.
async function disney() {
  const pair = await Promise.all([
    get("https://www.disneyplus.com/", false),
    regionFor("www.disneyplus.com")
  ]);
  const r = pair[0], region = countryFlag(pair[1]);
  if (isBlocked(r) || /not available in your region|unsupported location/i.test(r.body)) {
    return result("Disney+", "地区受限", region);
  }
  if (r.error || !r.status) return result("Disney+", "不可访问", region);
  if (r.status === 429) return result("Disney+", "请求受限", region);
  if (isReachable(r) && /disney|bamgrid/i.test(r.body)) {
    return result("Disney+", "入口可用", region);
  }
  return result("Disney+", "未确认", region);
}
// TikTok: test a known public video page, not only the landing page.
async function tiktok() {
  const pair = await Promise.all([
    get("https://www.tiktok.com/@scout2015/video/6718335390845095173", false),
    regionFor("www.tiktok.com")
  ]);
  const r = pair[0], region = countryFlag(pair[1]);
  if (isBlocked(r) || /not available in your region|unavailable in your region/i.test(r.body)) {
    return result("TikTok", "地区受限", region);
  }
  if (r.error || !r.status) return result("TikTok", "不可访问", region);
  if (isReachable(r) && /SIGI_STATE|__UNIVERSAL_DATA_FOR_REHYDRATION__|video\/6718335390845095173/i.test(r.body)) {
    return result("TikTok", "测试视频页可访问", region);
  }
  return result("TikTok", "未确认", region);
}

// Spotify is an audio service. Check a fixed public track page and report it as audio,
// not as video playback.
async function spotify() {
  const pair = await Promise.all([
    get("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", false),
    regionFor("open.spotify.com")
  ]);
  const r = pair[0], region = countryFlag(pair[1]);
  if (isBlocked(r)) return result("Spotify", "地区受限", region);
  if (r.error || !r.status) return result("Spotify", "不可访问", region);
  if (isReachable(r) && /4uLU6hMCjMI75M1A2tKUQC/i.test(r.body)) {
    return result("Spotify", "曲目页可访问", region);
  }
  return result("Spotify", "未确认", region);
}

function visualWidth(s) {
  let n = 0;
  Array.from(String(s)).forEach(function(ch) {
    const cp = ch.codePointAt(0);
    n += (cp >= 0x2E80 || cp >= 0xF900 || cp >= 0x1F000) ? 2 : 1;
  });
  return n;
}
function padCell(s, width) {
  const gap = Math.max(0, width - visualWidth(s));
  return s + "　".repeat(Math.floor(gap / 2)) + (gap % 2 ? " " : "");
}
async function main() {
  const checks = await Promise.all([
    claude(), gemini(), openai(), youtube(), netflix(), disney(), tiktok(), spotify()
  ]);
  const serviceWidth = 9, statusWidth = 18;
  const header = padCell("服务", serviceWidth) + "　" + padCell("状态", statusWidth) + "　地区";
  const lines = checks.map(function(x) {
    return padCell(x.name, serviceWidth) + "　" + padCell(x.status, statusWidth) + "　" + x.region;
  });
  const d = new Date();
  const time = ("0"+d.getHours()).slice(-2) + ":" + ("0"+d.getMinutes()).slice(-2);
  const hasIssue = checks.some(function(x) { return /受限|不可访问|未确认|部分/.test(x.status); });
  $done({
    title:"AI / 海外媒体检测",
    content:header + "\n" + lines.join("\n") +
      "\n\n检测时间：" + time +
      "\n说明：YouTube检测测试视频播放接口；Netflix、Disney+及TikTok检测内容或地区接口，登录、DRM及实际播放仍受账号和设备影响。AI检测服务入口，不代表已登录账号可成功对话。Spotify为音乐服务。",
    icon:hasIssue ? "exclamationmark.triangle" : "checkmark.circle",
    "icon-color":hasIssue ? "#FF9500" : "#34C759"
  });
}
main().catch(function(e) {
  $done({title:"AI / 海外媒体检测",content:"检测异常：" + String(e),icon:"exclamationmark.triangle","icon-color":"#FF3B30"});
});
