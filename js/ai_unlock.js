// Surge Generic Script: AI & Global Media Availability
// Reports website reachability and obvious regional blocks; HTTP 200 alone does not guarantee account eligibility.

const targets = [
  { name: "Claude", url: "https://claude.ai/" },
  { name: "Gemini", url: "https://gemini.google.com/app" },
  { name: "OpenAI", url: "https://chatgpt.com/" },
  { name: "YouTube", url: "https://www.youtube.com/premium" },
  { name: "Netflix", url: "https://www.netflix.com/title/81215567" },
  { name: "Disney+", url: "https://www.disneyplus.com/" },
  { name: "Spotify", url: "https://open.spotify.com/" },
  { name: "TikTok", url: "https://www.tiktok.com/" }
];

function inspect(target) {
  return new Promise(function(resolve) {
    const request = {
      url: target.url,
      method: "GET",
      timeout: 12,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
        "Cache-Control": "no-cache"
      }
    };

    $httpClient.get(request, function(error, response, body) {
      if (error || !response) {
        resolve({ name: target.name, state: "连接失败", detail: error ? String(error) : "无响应" });
        return;
      }

      const status = Number(response.status);
      const text = typeof body === "string" ? body : "";
      const lower = text.toLowerCase();

      if (status === 403 || status === 451 ||
          /unavailable in your country|not available in your region|地域限制|country.?not.?supported|unsupported country/.test(lower)) {
        resolve({ name: target.name, state: "可能受地区限制", detail: "HTTP " + status });
      } else if (status === 429) {
        resolve({ name: target.name, state: "请求频率受限", detail: "HTTP 429" });
      } else if (status >= 200 && status < 400) {
        resolve({ name: target.name, state: "网站可访问", detail: "HTTP " + status });
      } else if (status >= 500) {
        resolve({ name: target.name, state: "服务端异常", detail: "HTTP " + status });
      } else {
        resolve({ name: target.name, state: "访问异常", detail: "HTTP " + status });
      }
    });
  });
}

function getRegion() {
  return new Promise(function(resolve) {
    $httpClient.get({
      url: "https://www.cloudflare.com/cdn-cgi/trace",
      timeout: 8
    }, function(error, response, body) {
      if (error || !body) {
        resolve("出口地区：未知");
        return;
      }
      const match = String(body).match(/(?:^|\n)loc=([A-Z]{2})(?:\n|$)/);
      resolve("出口地区：" + (match ? match[1] : "未知"));
    });
  });
}

Promise.all([Promise.all(targets.map(inspect)), getRegion()])
  .then(function(result) {
    const items = result[0];
    const region = result[1];
    const lines = items.map(function(item) {
      return item.name + "： " + item.state + "（" + item.detail + "）";
    });
    const blocked = items.filter(function(item) {
      return item.state === "可能受地区限制" || item.state === "访问异常" || item.state === "连接失败";
    }).length;

    $done({
      title: "AI / 海外媒体解锁检测",
      content: region + "\n" + lines.join("\n") + "\n\n说明：网站可访问不代表账号已获得服务资格或内容库完整可用。",
      icon: blocked > 0 ? "exclamationmark.triangle" : "checkmark.circle",
      "icon-color": blocked > 0 ? "#FF9500" : "#34C759"
    });
  })
  .catch(function(error) {
    $done({
      title: "AI / 海外媒体解锁检测",
      content: "检测脚本异常：" + String(error),
      icon: "exclamationmark.triangle",
      "icon-color": "#FF3B30"
    });
  });
