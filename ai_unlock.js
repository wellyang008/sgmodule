const targets = [
  { name: "Claude", url: "https://claude.ai/cdn-cgi/trace" },
  { name: "Gemini", url: "https://gemini.google.com" },
  { name: "ChatGPT", url: "https://chatgpt.com/cdn-cgi/trace" },
  { name: "YouTube", url: "https://www.youtube.com/premium" },
  { name: "Netflix", url: "https://www.netflix.com/title/81215567" }
];

function probe(item) {
  return new Promise((resolve) => {
    $httpClient.get({ url: item.url, timeout: 5 }, (err, resp, data) => {
      if (err) {
        return resolve(`${item.name}: 超时/失败`);
      }
      const locMatch = typeof data === "string" ? data.match(/loc=([A-Z]{2})/) : null;
      const loc = locMatch ? ` (${locMatch[1]})` : "";
      resolve(`${item.name}: HTTP ${resp.status}${loc}`);
    });
  });
}

(async () => {
  const results = await Promise.all(targets.map(probe));
  $done({
    title: "当前节点解锁状态",
    content: results.join("\n"),
    icon: "sparkles",
    "icon-color": "#1A73E8"
  });
})();
