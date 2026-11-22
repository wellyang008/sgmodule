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
  const r = await get("https://www.youtube.com/premium?hl=en");
  if (r.error || r.status < 200 || r.status >= 400) return item("YouTube", "不可访问");
  const b = r.body.toLowerCase();
  const m = r.body.match(/"(?:GL|countryCode|country_code)"\s*:\s*"([A-Z]{2})"/);
  const c = m ? m[1] : "";
  if (/premium is not available in your (country|region)/.test(b)) return item("YouTube", "受限", flag(c));
  return item("YouTube", "未确认", flag(c));
}

async function netflix() {
  const ids = ["70143836", "70136120", "80057281"];
  const rs = await Promise.all(ids.map(function(id) {
    return get("https://www.netflix.com/title/" + id, false);
  }));
  if (rs.some(function(r) { return r.error || !r.status; })) return item("Netflix", "未确认");
  if (rs.some(function(r) { return r.status === 403 || r.status === 451; })) return item("Netflix", "受限");
  // Title-page HTTP success cannot verify regional playback rights.
  return item("Netflix", "未确认");
}

async function disney() {
  const r = await get("https://www.disneyplus.com/");
  if (r.error || r.status < 200 || r.status >= 400) return item("Disney+", "不可访问");
  if (/unavailable in your region|not available in your country/i.test(r.body)) return item("Disney+", "受限");
  return item("Disney+", "未确认");
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

async function main() {
  const results = await Promise.all([
    claude(), gemini(), openai(), youtube(), netflix(), disney(), spotify(), tiktok()
  ]);
  const lines = results.map(function(x) {
    return x.name.padEnd(10, " ") + x.status.padEnd(8, " ") + x.region;
  });
  const d = new Date();
  const time = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  const uncertain = results.some(function(x) {
    return x.status === "未确认" || x.status === "部分可用";
  });
  $done({
    title: "AI / 海外媒体检测",
    content: "服务      状态    地区\n" + lines.join("\n") +
      "\n\n检测时间：" + time +
      "\n说明：可用表示检测到明确可用信号；未确认表示现有检测无法验证账号或播放权限。",
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
