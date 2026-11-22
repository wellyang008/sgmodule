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
        url: res && res.url ? res.url : url,
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
  const r = await get("https://gemini.google.com/", false);
  if (r.error || !r.status) return item("Gemini", "不可访问");
  if (r.status === 403 || r.status === 451) return item("Gemini", "受限");
  if (r.status < 200 || r.status >= 400) return item("Gemini", "不可访问");
  const marker = ',2,1,200,"';
  const idx = r.body.indexOf(marker);
  let code3 = idx >= 0 ? r.body.slice(idx + marker.length, idx + marker.length + 3) : "";
  if (!/^[A-Z]{3}$/.test(code3)) {
    const m = r.body.match(/"(?:countryCode|country_code|GL)"\s*:\s*"([A-Z]{2,3})"/);
    code3 = m ? m[1].toUpperCase() : "";
  }
  const map = {
    USA:"US", GBR:"GB", CAN:"CA", AUS:"AU", JPN:"JP", SGP:"SG",
    FRA:"FR", DEU:"DE", KOR:"KR", TWN:"TW", HKG:"HK", MAC:"MO",
    CHN:"CN", IND:"IN", MYS:"MY", THA:"TH", IDN:"ID", PHL:"PH",
    NZL:"NZ", BRA:"BR", MEX:"MX", ESP:"ES", ITA:"IT", NLD:"NL",
    CHE:"CH", SWE:"SE", NOR:"NO", DNK:"DK", IRL:"IE", POL:"PL",
    RUS:"RU", BLR:"BY", IRN:"IR", PRK:"KP", SYR:"SY", CUB:"CU"
  };
  const code = map[code3] || (/^[A-Z]{2}$/.test(code3) ? code3 : "");
  if (!code) return item("Gemini", "未确认");
  const blocked = ["AF","BY","CN","CU","IR","KP","RU","SY"].indexOf(code) >= 0;
  return item("Gemini", blocked ? "受限" : "可用", flag(code));
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
  const r = await get("https://www.youtube.com/premium?hl=en", false);
  if (r.error || !r.status) return item("YouTube", "不可访问");
  if (r.status === 403 || r.status === 451 ||
      /premium is not available in your (country|region)/i.test(r.body))
    return item("YouTube", "受限");
  if (r.status < 200 || r.status >= 400) return item("YouTube", "不可访问");
  const m = r.body.match(/id=["']country-code["'][^>]*>\s*([A-Za-z]{2,3})\s*</i) ||
    r.body.match(/"GL"\s*:\s*"([A-Z]{2})"/) ||
    r.body.match(/"countryCode"\s*:\s*"([A-Z]{2})"/);
  const code = m ? m[1].toUpperCase().slice(0,2) : traceCode(r.body);
  const body = r.body.toLowerCase();
  if (/youtube premium|ad-free|"browseid"\s*:\s*"spunlimited"/.test(body))
    return item("YouTube", "可用", flag(code));
  return item("YouTube", "未确认", flag(code));
}


async function netflix() {
  const cdn = await get("https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=5", false);
  if (!cdn.error && cdn.status >= 200 && cdn.status < 300) {
    try {
      const data = JSON.parse(cdn.body);
      const code = data.targets && data.targets[0] && data.targets[0].location &&
        data.targets[0].location.country || "";
      if (code) return item("Netflix", "可用", flag(code.toUpperCase()));
    } catch (e) {}
  }
  const ids = ["81280792", "70143836"];
  const rs = await Promise.all(ids.map(function(id) {
    return get("https://www.netflix.com/title/" + id, false);
  }));
  if (rs.every(function(r) { return r.error || !r.status; })) return item("Netflix", "不可访问");
  if (rs.some(function(r) { return r.status === 403 || r.status === 451; }))
    return item("Netflix", "受限");
  if (rs.every(function(r) { return r.status === 404 || /page-404|nsez-403/i.test(r.body); }))
    return item("Netflix", "部分可用");
  const rr = await get("https://www.netflix.com/title/80018499", false);
  let region = "";
  const loc = rr.headers.location || rr.headers.Location || "";
  const m = loc.match(/\/([a-z]{2})-[^/]+\//i);
  if (m) region = m[1].toUpperCase();
  if (!region && rr.url) {
    const u = rr.url.match(/\/([a-z]{2})-[^/]+\//i);
    if (u) region = u[1].toUpperCase();
  }
  if (rs.some(function(r) { return r.status === 200 || r.status === 301 || r.status === 302; }))
    return item("Netflix", "可用", flag(region));
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
  if (r.status < 200 || r.status >= 400) return item("Spotify", "不可访问");
  let code = "";
  const m = r.body.match(/"countryCode"\s*:\s*"([A-Z]{2})"/i);
  if (m) code = m[1].toUpperCase();
  if (!code) {
    const u = (r.url || "").match(/\/([a-z]{2})(?:-[^/]+)?\//i);
    if (u) code = u[1].toUpperCase();
  }
  if (/not available in your country/i.test(r.body)) return item("Spotify", "受限", flag(code));
  if (r.status >= 200 && r.status < 300) return item("Spotify", "可用", flag(code));
  return item("Spotify", "未确认", flag(code));
}


async function tiktok() {
  const r = await get("https://www.tiktok.com/cdn-cgi/trace", false);
  let code = "";
  if (!r.error && r.status >= 200 && r.status < 300) {
    const m = r.body.match(/(?:^|\n)region=([A-Z]{2})(?:\n|$)/) ||
      r.body.match(/(?:^|\n)loc=([A-Z]{2})(?:\n|$)/);
    if (m) code = m[1];
    if (code && ["AF","CN","IN","IR","KP"].indexOf(code) >= 0)
      return item("TikTok", "受限", flag(code));
    if (code) return item("TikTok", "可用", flag(code));
  }
  const home = await get("https://www.tiktok.com/", false);
  if (home.error || !home.status) return item("TikTok", "不可访问", flag(code));
  if (home.status === 403 || home.status === 451 ||
      /access denied|not available in your region|tiktok is not available/i.test(home.body))
    return item("TikTok", "受限", flag(code));
  if (home.status >= 200 && home.status < 400) return item("TikTok", "可用", flag(code));
  return item("TikTok", "未确认", flag(code));
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
