const NEWS_FEED_URL = "https://feeds.bbci.co.uk/news/rss.xml";
const NEWS_CACHE_KEY = "newsCache";
const NEWS_CACHE_MS = 15 * 60 * 1000;
const NEWS_HEADLINE_COUNT = 12;

async function getHeadlines() {
  const cached = (await browser.storage.local.get(NEWS_CACHE_KEY))[NEWS_CACHE_KEY];
  if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_MS) {
    return cached.headlines;
  }

  const response = await fetch(NEWS_FEED_URL);
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  const headlines = [...xml.querySelectorAll("item")]
    .slice(0, NEWS_HEADLINE_COUNT)
    .map((item) => ({
      title: item.querySelector("title")?.textContent?.trim() ?? "",
      link: item.querySelector("link")?.textContent?.trim() ?? "",
    }))
    .filter((headline) => headline.title && headline.link);

  await browser.storage.local.set({ [NEWS_CACHE_KEY]: { fetchedAt: Date.now(), headlines } });
  return headlines;
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "get-headlines") {
    return getHeadlines();
  }
  return undefined;
});
