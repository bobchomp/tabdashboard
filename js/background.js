const FEEDS = {
  news: "https://feeds.bbci.co.uk/news/rss.xml",
  sport: "https://feeds.bbci.co.uk/sport/rss.xml",
};
const NEWS_CACHE_MS = 15 * 60 * 1000;
const NEWS_HEADLINE_COUNT = 12;

async function getHeadlines(feed) {
  const feedUrl = FEEDS[feed] ?? FEEDS.news;
  const cacheKey = `newsCache:${feed}`;

  const cached = (await browser.storage.local.get(cacheKey))[cacheKey];
  if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_MS) {
    console.log(`[news:${feed}] serving cached headlines:`, cached.headlines.length);
    return cached.headlines;
  }

  console.log(`[news:${feed}] fetching`, feedUrl);
  const response = await fetch(feedUrl);
  console.log(`[news:${feed}] response status:`, response.status, response.ok);
  if (!response.ok) {
    throw new Error(`Feed request failed with status ${response.status}`);
  }

  const text = await response.text();
  console.log(`[news:${feed}] response length:`, text.length);

  const xml = new DOMParser().parseFromString(text, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) {
    console.error(`[news:${feed}] XML parse error:`, parseError.textContent);
    throw new Error("Failed to parse BBC feed XML");
  }

  const rawItems = xml.querySelectorAll("item");
  console.log(`[news:${feed}] <item> elements found:`, rawItems.length);

  const headlines = [...rawItems]
    .slice(0, NEWS_HEADLINE_COUNT)
    .map((item) => ({
      title: item.querySelector("title")?.textContent?.trim() ?? "",
      link: item.querySelector("link")?.textContent?.trim() ?? "",
    }))
    .filter((headline) => headline.title && headline.link);

  console.log(`[news:${feed}] usable headlines after filtering:`, headlines.length);

  await browser.storage.local.set({ [cacheKey]: { fetchedAt: Date.now(), headlines } });
  return headlines;
}

const SUGGEST_URLS = {
  duckduckgo: (q) => `https://ac.duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
  google: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
  bing: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`,
  ecosia: (q) => `https://ac.ecosia.org/autocomplete?q=${encodeURIComponent(q)}&type=list`,
};
const SUGGEST_MAX_RESULTS = 8;

function parseSuggestions(data) {
  if (!Array.isArray(data)) return [];

  // OpenSearch-style: ["query", ["suggestion", ...]] (Google, Bing, Ecosia)
  if (Array.isArray(data[1]) && data[1].every((item) => typeof item === "string")) {
    return data[1];
  }

  // DuckDuckGo-style: [{ phrase: "suggestion" }, ...]
  if (data.length && data.every((item) => item && typeof item === "object" && typeof item.phrase === "string")) {
    return data.map((item) => item.phrase);
  }

  // Flat array of strings
  if (data.every((item) => typeof item === "string")) {
    return data;
  }

  return [];
}

async function getSuggestions(engine, query) {
  const buildUrl = SUGGEST_URLS[engine];
  if (!buildUrl || !query.trim()) return [];

  const response = await fetch(buildUrl(query));
  if (!response.ok) {
    throw new Error(`Suggest request failed with status ${response.status}`);
  }

  const data = await response.json();
  return parseSuggestions(data).slice(0, SUGGEST_MAX_RESULTS);
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "get-headlines") {
    const feed = message.feed === "sport" ? "sport" : "news";
    return getHeadlines(feed).catch((error) => {
      console.error(`[news:${feed}] getHeadlines failed:`, error);
      throw error;
    });
  }

  if (message?.type === "get-suggestions") {
    return getSuggestions(message.engine, message.query ?? "").catch((error) => {
      console.error(`[suggest:${message.engine}] getSuggestions failed:`, error);
      return [];
    });
  }

  return undefined;
});
