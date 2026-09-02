const NEWS_FEED_URL = "https://feeds.bbci.co.uk/news/rss.xml";
const NEWS_CACHE_KEY = "newsCache";
const NEWS_CACHE_MS = 15 * 60 * 1000;
const NEWS_HEADLINE_COUNT = 12;

async function getHeadlines() {
  const cached = (await browser.storage.local.get(NEWS_CACHE_KEY))[NEWS_CACHE_KEY];
  if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_MS) {
    console.log("[news] serving cached headlines:", cached.headlines.length);
    return cached.headlines;
  }

  console.log("[news] fetching", NEWS_FEED_URL);
  const response = await fetch(NEWS_FEED_URL);
  console.log("[news] response status:", response.status, response.ok);
  if (!response.ok) {
    throw new Error(`Feed request failed with status ${response.status}`);
  }

  const text = await response.text();
  console.log("[news] response length:", text.length, "starts with:", text.slice(0, 120));

  const xml = new DOMParser().parseFromString(text, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) {
    console.error("[news] XML parse error:", parseError.textContent);
    throw new Error("Failed to parse BBC feed XML");
  }

  const rawItems = xml.querySelectorAll("item");
  console.log("[news] <item> elements found:", rawItems.length);

  const headlines = [...rawItems]
    .slice(0, NEWS_HEADLINE_COUNT)
    .map((item) => ({
      title: item.querySelector("title")?.textContent?.trim() ?? "",
      link: item.querySelector("link")?.textContent?.trim() ?? "",
    }))
    .filter((headline) => headline.title && headline.link);

  console.log("[news] usable headlines after filtering:", headlines.length);

  await browser.storage.local.set({ [NEWS_CACHE_KEY]: { fetchedAt: Date.now(), headlines } });
  return headlines;
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "get-headlines") {
    return getHeadlines().catch((error) => {
      console.error("[news] getHeadlines failed:", error);
      throw error;
    });
  }
  return undefined;
});
