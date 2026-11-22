// Surge AI / Media checker
// Conservative policy: distinguish endpoint reachability from account entitlement and playback.
const H = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9"
};

function get(url, redirect) {
  return new Promise(function(resolve) {
    $httpClient.get({
      url: url, headers: H, timeout: 15,
      "auto-redirect": redirect !== false
    }, function(err, res, body) {
      resolve({
        error: !!err, status: res ? Number(res.status) : 0,
        headers: res && res.headers ? res.headers : {},
        url: res && res.url ? res.url : url,
        body: typeof body === "string" ? body : ""
      });
    });
  });
}

function post(url, body, headers) {
  return new Promise(function(resolve) {
    $httpClient.post({
      url: url,
      headers: Object.assign({
        "User-Agent": H["User-Agent"],
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json"
      }, headers || {}),
      body: JSON.stringify(body), timeout: 18
    }, function(err, res, data) {
      resolve({
        error: !!err, status: res ? Number(res.status) : 0,
        headers: res && res.headers ? res.headers : {},
        body: typeof data === "string" ? data : ""
      });
    });
  });
}

function traceCode(body) {
  const m = String(body || "").match(/(?:^|\n)loc=([A-Z]{2})(?:\n|$)/);
  return m ? m[1] : "";
}
function flag(code) {
  return /^[A-Z]{2}$/.test(code || "")
    ? String.fromCodePoint(127397 + code.charCodeAt(0), 127397 + code.charCodeAt(1)) + " " + code
    : "未知";
}
function item(name, status, region) {
  return { name: name, status: status, region: region || "未知" };
}
function blocked(r) {
  return !!r && (r.status === 403 || r.status === 451 ||
    /unsupported[_ ]country|not available in your (country|region)|isn't supported in your country|app unavailable in your region|access denied/i.test(r.body || ""));
}
function reachable(r) {
  return !!r && !r.error && r.status >= 200 && r.status < 400;
}
function trace(host) {
  return get("https://" + host + "/cdn-cgi/trace", false);
}
function parseJSON(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}
function extractObjectAfter(source, marker) {
  const start = source.indexOf(marker);
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
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return parseJSON(source.slice(open, i + 1));
  }
  return null;
}

async function claude() {
  const rs = await Promise.all([trace("claude.ai"), get("https://claude.ai/", false)]);
  const region = flag(traceCode(rs[0].body)), home = rs[1];
  if (blocked(home)) return item("Claude", "受限", region);
  if (!reachable(home)) return item("Claude", home.error || !home.status ? "不可访问" : "未确认", region);
  // Only confirms the public web app shell, not sign-in, account access or message generation.
  if (/claude\.ai|anthropic|sign in to claude/i.test(home.body)) return item("Claude", "网站可达", region);
  return item("Claude", "未确认", region);
}

async function gemini() {
  const rs = await Promise.all([trace("gemini.google.com"), get("https://gemini.google.com/", false)]);
  const region = flag(traceCode(rs[0].body)), r = rs[1];
  if (blocked(r)) return item("Gemini", "受限", region);
  if (!reachable(r)) return item("Gemini", r.error || !r.status ? "不可访问" : "未确认", region);
  if (/gemini\.google\.com|bard|batchexecute/i.test(r.body)) return item("Gemini", "网站可达", region);
  return item("Gemini", "未确认", region);
}

async function openai() {
  const rs = await Promise.all([
    trace("chatgpt.com"),
    get("https://chatgpt.com/", false),
    get("https://api.openai.com/v1/models", false),
    get("https://ios.chat.openai.com/", false)
  ]);
  const region = flag(traceCode(rs[0].body));
  const web = rs[1], api = rs[2], ios = rs[3];
  const webOK = reachable(web) && /chatgpt|openai/i.test(web.body);
  let apiOK = false;
  const ap = parseJSON(api.body);
  // An unauthenticated 401 with the documented missing/invalid-key error proves API edge reachability only.
  if (api.status === 401 && ap && ap.error &&
      /invalid_api_key|missing_api_key/i.test(String(ap.error.code || ""))) apiOK = true;
  const iosOK = reachable(ios) && /chatgpt|openai/i.test(ios.body);
  if (blocked(web) && blocked(api) && blocked(ios)) return item("OpenAI", "受限", region);
  const signals = [webOK, apiOK, iosOK].filter(Boolean).length;
  if (signals >= 2) return item("OpenAI", "可访问", region);
  if (signals === 1) return item("OpenAI", "部分可达", region);
  if ([web, api, ios].every(function(r) { return r.error || !r.status; })) return item("OpenAI", "不可访问", region);
  if (blocked(web) || blocked(api) || blocked(ios)) return item("OpenAI", "受限", region);
  return item("OpenAI", "未确认", region);
}

async function youtube() {
  const rs = await Promise.all([
    trace("www.youtube.com"),
    get("https://www.youtube.com/watch?v=jNQXAC9IVRw&hl=en", false)
  ]);
  const region = flag(traceCode(rs[0].body)), r = rs[1];
  if (blocked(r) || /sorry\/index|unusual traffic/i.test(r.body)) return item("YouTube", "受限", region);
  if (!reachable(r)) return item("YouTube", r.error || !r.status ? "不可访问" : "未确认", region);
  // Parse the player response; page text or a Premium marketing keyword is not a playback signal.
  const p = extractObjectAfter(r.body, "ytInitialPlayerResponse");
  const ps = p && p.playabilityStatus;
  if (ps && ps.status === "OK") return item("YouTube", "可播放", region);
  if (ps && /GEO|COUNTRY|REGION/i.test(String(ps.reason || "") + " " + String(ps.status || ""))) return item("YouTube", "受限", region);
  if (ps && ps.status) return item("YouTube", "未确认", region);
  return item("YouTube", "未确认", region);
}

function headerValue(headers, key) {
  if (!headers) return "";
  const target = key.toLowerCase();
  const names = Object.keys(headers);
  for (let i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() === target) return String(headers[names[i]] || "");
  }
  return "";
}
async function netflix() {
  const ids = ["80018499", "70143836"];
  const rs = await Promise.all(ids.map(function(id) {
    return get("https://www.netflix.com/title/" + id, false);
  }));
  if (rs.every(function(r) { return r.error || !r.status; })) return item("Netflix", "不可访问");
  if (rs.every(blocked)) return item("Netflix", "受限");
  let country = "";
  let titleSignals = 0;
  rs.forEach(function(r, i) {
    const origin = headerValue(r.headers, "x-originating-url");
    const cm = origin.match(/(?:^|[\/?&])([A-Z]{2})(?:[\/?&]|$)/) ||
      r.body.match(/"countryCode"\s*:\s*"([A-Z]{2})"/i);
    if (!country && cm) country = cm[1].toUpperCase();
    if (reachable(r) && new RegExp('"titleId"\\s*:\\s*"?'+ ids[i] + '"?').test(r.body)) titleSignals++;
  });
  // Netflix's public title page is not proof of full catalog or playback entitlement.
  if (titleSignals === 2) return item("Netflix", "标题可见", flag(country));
  if (titleSignals === 1) return item("Netflix", "部分可见", flag(country));
  if (rs.every(function(r) { return r.status === 404; })) return item("Netflix", "测试标题不可用", flag(country));
  return item("Netflix", "未确认", flag(country));
}

async function disney() {
  const auth = "ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84";
  const r = await post("https://disney.api.edge.bamgrid.com/graph/v1/device/graphql", {
    query: "mutation registerDevice($input: RegisterDeviceInput!) { registerDevice(registerDevice: $input) { grant { grantType assertion } } }",
    variables: { input: {
      applicationRuntime: "chrome",
      attributes: { browserName: "chrome", browserVersion: "124.0", manufacturer: "apple", model: null, operatingSystem: "macintosh", operatingSystemVersion: "10.15.7", osDeviceIds: [] },
      deviceFamily: "browser", deviceLanguage: "en", deviceProfile: "macosx"
    }}
  }, { Authorization: auth });
  if (blocked(r)) return item("Disney+", "受限");
  if (r.error || !r.status) return item("Disney+", "不可访问");
  if (r.status < 200 || r.status >= 300) return item("Disney+", "未确认");
  const data = parseJSON(r.body);
  const sdk = data && data.extensions && data.extensions.sdk;
  const session = sdk && sdk.session;
  const region = session && session.location && session.location.countryCode || "";
  if (session && session.inSupportedLocation === false) return item("Disney+", "受限", flag(region));
  const token = sdk && sdk.token && sdk.token.accessToken;
  if (!token || !region || !session || session.inSupportedLocation !== true) return item("Disney+", "未确认", flag(region));
  const q = await post("https://disney.api.edge.bamgrid.com/v1/public/graphql", {
    query: "query($preferredLanguages: [String!]!, $version: String) {globalization(version: $version) { uiLanguage(preferredLanguages: $preferredLanguages) }}",
    variables: { version: "1.5.0", preferredLanguages: ["en"] }
  }, { Authorization: token });
  const qp = parseJSON(q.body);
  const lang = qp && qp.data && qp.data.globalization && qp.data.globalization.uiLanguage;
  if (!q.error && q.status >= 200 && q.status < 300 && typeof lang === "string" && lang.length) {
    return item("Disney+", "接口可达", flag(region));
  }
  if (blocked(q)) return item("Disney+", "受限", flag(region));
  return item("Disney+", "未确认", flag(region));
}

async function spotify() {
  const rs = await Promise.all([
    trace("www.spotify.com"),
    get("https://www.spotify.com/", false)
  ]);
  const region = flag(traceCode(rs[0].body)), r = rs[1];
  if (blocked(r)) return item("Spotify", "受限", region);
  if (!reachable(r)) return item("Spotify", r.error || !r.status ? "不可访问" : "未确认", region);
  if (/spotify\.com|spotify/i.test(r.body)) return item("Spotify", "网站可达", region);
  return item("Spotify", "未确认", region);
}

async function tiktok() {
  const rs = await Promise.all([
    trace("www.tiktok.com"),
    get("https://www.tiktok.com/", false)
  ]);
  const region = flag(traceCode(rs[0].body)), r = rs[1];
  if (blocked(r) || /tiktok is not available in your region/i.test(r.body)) return item("TikTok", "受限", region);
  if (!reachable(r)) return item("TikTok", r.error || !r.status ? "不可访问" : "未确认", region);
  if (/SIGI_STATE|__UNIVERSAL_DATA_FOR_REHYDRATION__|webapp\.tiktok/i.test(r.body)) return item("TikTok", "网站可达", region);
  return item("TikTok", "未确认", region);
}

function visualWidth(str) {
  let n = 0;
  Array.from(String(str)).forEach(function(ch) {
    const cp = ch.codePointAt(0);
    n += (cp >= 0x2E80 || cp >= 0xF900 || cp >= 0x1F000) ? 2 : 1;
  });
  return n;
}
function padCell(str, width) {
  const gap = Math.max(0, width - visualWidth(str));
  return str + "　".repeat(Math.floor(gap / 2)) + (gap % 2 ? " " : "");
}
async function main() {
  const results = await Promise.all([
    claude(), gemini(), openai(), youtube(), netflix(), disney(), spotify(), tiktok()
  ]);
  const serviceWidth = 9, statusWidth = 10;
  const lines = results.map(function(x) {
    return padCell(x.name, serviceWidth) + "　" +
      padCell(x.status, statusWidth) + "　" + x.region;
  });
  const header = padCell("服务", serviceWidth) + "　" +
    padCell("状态", statusWidth) + "　地区";
  const d = new Date();
  const time = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  const uncertain = results.some(function(x) {
    return /未确认|部分|不可用/.test(x.status);
  });
  $done({
    title: "AI / 海外媒体检测",
    content: header + "\n" + lines.join("\n") +
      "\n\n检测时间：" + time +
      "\n说明：可访问仅表示检测接口可响应；可播放仅表示测试视频可播放。未登录账号，不能验证订阅、账号权限及完整片库。",
    icon: uncertain ? "exclamationmark.triangle" : "checkmark.circle",
    "icon-color": uncertain ? "#FF9500" : "#34C759"
  });
}
main().catch(function(e) {
  $done({
    title: "AI / 海外媒体检测",
    content: "检测异常：" + String(e),
    icon: "exclamationmark.triangle",
    "icon-color": "#FF3B30"
  });
});
