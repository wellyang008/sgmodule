// Surge AI / Media availability checker
const H = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9"
};

function get(url, redirect) {
  return new Promise(function(resolve) {
    $httpClient.get({
      url: url, headers: H, timeout: 12,
      "auto-redirect": redirect !== false
    }, function(err, res, body) {
      resolve({
        error: !!err,
        status: res ? Number(res.status) : 0,
        headers: res && res.headers ? res.headers : {},
        body: typeof body === "string" ? body : ""
      });
    });
  });
}


function post(url, body, headers) {
  return new Promise(function(resolve) {
    $httpClient.post({
      url: url, headers: Object.assign({
        "User-Agent": H["User-Agent"],
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json"
      }, headers || {}),
      body: JSON.stringify(body), timeout: 15
    }, function(err, res, data) {
      resolve({
        error: !!err,
        status: res ? Number(res.status) : 0,
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

function restricted(code) {
  return ["AF","BY","CN","CU","HK","IR","KP","MO","RU","SY"].indexOf(code) >= 0;
}

async function claude() {
  const r = await get("https://claude.ai/cdn-cgi/trace");
  if (r.error || r.status < 200 || r.status >= 400) return item("Claude", "不可访问");
  const c = traceCode(r.body);
  return c ? item("Claude", restricted(c) ? "受限" : "可用", flag(c)) : item("Claude", "未确认");
}

async function gemini() {
  const r = await get("https://gemini.google.com/");
  if (r.error || r.status < 200 || r.status >= 400) return item("Gemini", "不可访问");
  const m = r.body.match(/"(?:countryCode|country_code|GL)"\s*:\s*"([A-Z]{2,3})"/);
  if (!m) return item("Gemini", "未确认");
  const c = m[1].toUpperCase();
  const blocked = ["CN","CHN","RU","RUS","IR","IRN","KP","PRK","SY","SYR","BY","BLR","CU","CUB","HK","HKG","MO","MAC"].indexOf(c) >= 0;
  return item("Gemini", blocked ? "受限" : "可用", c);
}

async function openai() {
  const rs = await Promise.all([
    get("https://chatgpt.com/cdn-cgi/trace"),
    get("https://api.openai.com/compliance/cookie_requirements"),
    get("https://ios.chat.openai.com/")
  ]);
  const code = traceCode(rs[0].body);
  const webBody = rs[1].body.toLowerCase();
  const iosBody = rs[2].body.toLowerCase();
  const webOK = !rs[1].error && rs[1].status >= 200 && rs[1].status < 400 &&
    rs[1].body.length > 0 && webBody.indexOf("unsupported_country") < 0;
  const iosBlocked = /disallowed isp|you have been blocked/.test(iosBody);
  const iosOK = !rs[2].error && !iosBlocked &&
    /request is not allowed\. please try again later\./.test(iosBody);
  let status = "未确认";
  if (webOK && iosOK) status = "可用";
  else if (webOK || iosOK) status = "部分可用";
  else if (iosBlocked || /unsupported_country|unsupported country/.test(webBody)) status = "受限";
  return item("OpenAI", status, flag(code));
}

async function youtube() {
  const home = await get("https://www.youtube.com/", false);
  if (home.error || home.status < 200 || home.status >= 400)
    return item("YouTube", home.status === 403 || home.status === 451 ? "受限" : "不可访问");
  const key = home.body.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  const ver = home.body.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
  const regionMatch = home.body.match(/"GL"\s*:\s*"([A-Z]{2})"/);
  const region = regionMatch ? regionMatch[1] : traceCode(home.body);
  if (!key) return item("YouTube", "未确认", flag(region));
  const player = await post(
    "https://www.youtube.com/youtubei/v1/player?key=" + key[1],
    {
      videoId: "M7lc1UVf-VE",
      context: { client: {
        clientName: "WEB",
        clientVersion: ver ? ver[1] : "2.20261120.01.00",
        hl: "en", gl: region || "US"
      }}
    },
    { "X-YouTube-Client-Name": "1", "X-YouTube-Client-Version": ver ? ver[1] : "2.20261120.01.00" }
  );
  if (player.error || !player.status) return item("YouTube", "不可访问", flag(region));
  let data;
  try { data = JSON.parse(player.body); } catch (e) { return item("YouTube", "未确认", flag(region)); }
  const state = data && data.playabilityStatus && data.playabilityStatus.status;
  const reason = data && data.playabilityStatus && data.playabilityStatus.reason || "";
  if (state === "OK") return item("YouTube", "可用", flag(region));
  if (state === "UNPLAYABLE" || state === "LOGIN_REQUIRED" || /not available in your country|geo.?restrict/i.test(reason))
    return item("YouTube", "受限", flag(region));
  return item("YouTube", "未确认", flag(region));
}

async function netflix() {
  const ids = ["81280792", "70143836"];
  const rs = await Promise.all(ids.map(function(id) {
    return get("https://www.netflix.com/title/" + id, false);
  }));
  if (rs.every(function(r) { return r.error || !r.status; })) return item("Netflix", "不可访问");
  if (rs.some(function(r) { return r.status === 403 || r.status === 451; })) return item("Netflix", "受限");
  const full = rs.some(function(r) { return /property=["']og:video["']/i.test(r.body); });
  let region = "";
  for (let i = 0; i < rs.length && !region; i++) {
    const m = rs[i].body.match(/netflix\.reactContext\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (m) {
      try {
        const ctx = JSON.parse(m[1]);
        region = ctx.models && ctx.models.geo && ctx.models.geo.data &&
          ctx.models.geo.data.requestCountry && ctx.models.geo.data.requestCountry.id || "";
      } catch (e) {}
    }
  }
  if (full) return item("Netflix", "可用", flag(region));
  if (rs.some(function(r) { return r.status >= 200 && r.status < 400 && r.body.length > 1000; }))
    return item("Netflix", "部分可用", flag(region));
  return item("Netflix", "未确认", flag(region));
}

async function disney() {
  const ua = H["User-Agent"];
  const auth = "ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84";
  const r = await post(
    "https://disney.api.edge.bamgrid.com/graph/v1/device/graphql",
    {
      query: "mutation registerDevice($input: RegisterDeviceInput!) { registerDevice(registerDevice: $input) { grant { grantType assertion } } }",
      variables: { input: {
        applicationRuntime: "chrome",
        attributes: {
          browserName: "chrome", browserVersion: "124.0",
          manufacturer: "apple", model: null,
          operatingSystem: "macintosh", operatingSystemVersion: "10.15.7",
          osDeviceIds: []
        },
        deviceFamily: "browser", deviceLanguage: "en",
        deviceProfile: "macosx"
      }}
    },
    { Authorization: auth }
  );
  if (r.error || r.status !== 200) {
    if (r.status === 403 || r.status === 451) return item("Disney+", "受限");
    return item("Disney+", r.error || !r.status ? "不可访问" : "未确认");
  }
  let data;
  try { data = JSON.parse(r.body); } catch (e) { return item("Disney+", "未确认"); }
  const sdk = data && data.extensions && data.extensions.sdk;
  const session = sdk && sdk.session;
  const region = session && session.location && session.location.countryCode || "";
  const supported = session && session.inSupportedLocation;
  const token = sdk && sdk.token && sdk.token.accessToken;
  if (supported === false || supported === "false") return item("Disney+", "受限", flag(region));
  if (!token || !region) return item("Disney+", "未确认", flag(region));
  const q = await post(
    "https://disney.api.edge.bamgrid.com/v1/public/graphql",
    {
      query: "query($preferredLanguages: [String!]!, $version: String) {globalization(version: $version) { uiLanguage(preferredLanguages: $preferredLanguages) }}",
      variables: { version: "1.5.0", preferredLanguages: ["en"] }
    },
    { Authorization: token }
  );
  if (q.status === 200 && !q.error) return item("Disney+", "可用", flag(region));
  if (q.status === 403 || q.status === 451) return item("Disney+", "受限", flag(region));
  return item("Disney+", "未确认", flag(region));
}

async function spotify() {
  const r = await get("https://www.spotify.com/api/content/v1/country-selector?platform=web&format=json", false);
  if (r.error || !r.status) return item("Spotify", "不可访问");
  if (r.status === 403 || r.status === 451) return item("Spotify", "受限");
  return item("Spotify", "未确认");
}

async function tiktok() {
  const r = await get("https://www.tiktok.com/");
  if (r.error || r.status < 200 || r.status >= 400) return item("TikTok", "不可访问");
  if (/access denied|not available in your region|tiktok is not available/i.test(r.body)) return item("TikTok", "受限");
  return item("TikTok", "未确认");
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
  let gap = Math.max(0, width - visualWidth(str));
  return str + "　".repeat(Math.floor(gap / 2)) + (gap % 2 ? " " : "");
}
async function main() {
  const results = await Promise.all([
    claude(), gemini(), openai(), youtube(), netflix(), disney(), spotify(), tiktok()
  ]);
  const serviceWidth = 9;
  const statusWidth = 8;
  const lines = results.map(function(x) {
    return padCell(x.name, serviceWidth) + "　" +
      padCell(x.status, statusWidth) + "　" + x.region;
  });
  const header = padCell("服务", serviceWidth) + "　" +
    padCell("状态", statusWidth) + "　地区";
  const d = new Date();
  const time = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  const uncertain = results.some(function(x) {
    return x.status === "未确认" || x.status === "部分可用";
  });
  $done({
    title: "AI / 海外媒体检测",
    content: header + "\n" + lines.join("\n") +
      "\n\n检测时间：" + time +
      "\n说明：可用表示服务专用检测通过；部分可用表示仅检测到部分内容；未确认表示无法取得足够信号。",
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
