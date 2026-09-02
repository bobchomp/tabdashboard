const SETTINGS_KEY = "settings";
const USER_NAME = "Ross";

const SEARCH_ENGINES = {
  duckduckgo: { label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  google: { label: "Google", url: "https://www.google.com/search?q=" },
  bing: { label: "Bing", url: "https://www.bing.com/search?q=" },
  ecosia: { label: "Ecosia", url: "https://www.ecosia.org/search?q=" },
};
const DEFAULT_SETTINGS = { searchEngine: "duckduckgo" };

const NEWS_SCROLL_PX_PER_SEC = 55;

const NEWS_LOGOS = {
  news: {
    label: "News",
    icon: `<svg width="34" height="30" viewBox="0 0 34 30" fill="none">
      <rect x="0" y="0" width="16" height="16" rx="2" fill="#BB1919"></rect>
      <rect x="18" y="6" width="16" height="16" rx="2" fill="#BB1919"></rect>
      <rect x="4" y="18" width="12" height="12" rx="2" fill="#BB1919"></rect>
    </svg>`,
  },
  sport: {
    label: "Sport",
    icon: `<svg width="34" height="28" viewBox="0 0 34 28" fill="none">
      <path d="M0 0H26L20 8H0Z" fill="#FFC300"></path>
      <path d="M2 10H20L15 18H2Z" fill="#FFA000"></path>
      <path d="M4 20H14L10 28H4Z" fill="#FF7A00"></path>
    </svg>`,
  },
};

const clockEls = document.querySelectorAll("[data-clock]");
const newsTrack = document.getElementById("news-track");
const newsLogoBtn = document.getElementById("news-logo");

let currentNewsFeed = "news";
let newsProgress = { news: 0, sport: 0 };
let newsFeedVirtualStart = null;

async function loadNewsProgress() {
  const stored = (await browser.storage.local.get("newsProgress")).newsProgress;
  if (stored) {
    newsProgress = { ...newsProgress, ...stored };
  }
}

function currentNewsElapsedSeconds() {
  if (newsFeedVirtualStart === null) return 0;
  return (Date.now() - newsFeedVirtualStart) / 1000;
}

async function saveNewsProgress() {
  if (newsFeedVirtualStart === null) return;
  newsProgress[currentNewsFeed] = currentNewsElapsedSeconds();
  await browser.storage.local.set({ newsProgress });
}

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");

const greetingEl = document.getElementById("greeting");
const settingsBtn = document.getElementById("settings-btn");
const settingsDialog = document.getElementById("settings-dialog");
const settingsForm = document.getElementById("settings-form");
const settingsCancelBtn = document.getElementById("settings-cancel");
const settingsCloseBtn = document.getElementById("settings-close");
const searchEngineSelect = document.getElementById("search-engine-select");

let settings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  settings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  applySettings();
}

async function saveSettings() {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

function applySettings() {
  const engine = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES[DEFAULT_SETTINGS.searchEngine];
  searchInput.placeholder = `Search ${engine.label} or enter address`;
}

function renderGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  greetingEl.textContent = `${greeting}, ${USER_NAME}`;
}

function renderClocks() {
  const now = new Date();
  for (const el of clockEls) {
    const timeZone = el.dataset.clock;
    const time = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone === "local" ? undefined : timeZone,
    });
    el.querySelector(".clock-time").textContent = time;
  }
}

function buildNewsRun(headlines) {
  const run = document.createDocumentFragment();
  headlines.forEach((headline, index) => {
    const link = document.createElement("a");
    link.className = "news-item";
    link.href = headline.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = headline.title;
    run.appendChild(link);

    if (index < headlines.length - 1) {
      const dot = document.createElement("span");
      dot.className = "news-dot";
      dot.textContent = "•";
      dot.setAttribute("aria-hidden", "true");
      run.appendChild(dot);
    }
  });
  return run;
}

function renderNewsLogo() {
  const other = currentNewsFeed === "news" ? "sport" : "news";
  const config = NEWS_LOGOS[currentNewsFeed];
  newsLogoBtn.innerHTML = `${config.icon}<span>${config.label}</span>`;
  newsLogoBtn.setAttribute("aria-label", `Showing BBC ${config.label}. Click to switch to BBC ${NEWS_LOGOS[other].label}.`);
}

async function renderNews() {
  newsTrack.textContent = "Loading headlines…";
  let headlines;
  try {
    headlines = await browser.runtime.sendMessage({ type: "get-headlines", feed: currentNewsFeed });
  } catch (error) {
    console.error("[news] sendMessage failed:", error);
    newsTrack.textContent = "Unable to load BBC headlines right now.";
    return;
  }

  if (!headlines || !headlines.length) {
    newsTrack.textContent = "Unable to load BBC headlines right now.";
    return;
  }

  newsTrack.innerHTML = "";
  newsTrack.appendChild(buildNewsRun(headlines));
  const spacer = document.createElement("span");
  spacer.className = "news-dot";
  spacer.textContent = "•";
  spacer.setAttribute("aria-hidden", "true");
  newsTrack.appendChild(spacer);
  newsTrack.appendChild(buildNewsRun(headlines));

  requestAnimationFrame(() => {
    const runWidth = newsTrack.scrollWidth / 2;
    const duration = runWidth / NEWS_SCROLL_PX_PER_SEC;
    newsTrack.style.animationDuration = `${duration}s`;

    const resumeOffset = (newsProgress[currentNewsFeed] ?? 0) % duration;
    newsFeedVirtualStart = Date.now() - resumeOffset * 1000;
    newsTrack.style.animationDelay = `-${resumeOffset}s`;
  });
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

settingsBtn.addEventListener("click", () => {
  searchEngineSelect.value = settings.searchEngine;
  settingsDialog.showModal();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  settings.searchEngine = searchEngineSelect.value;
  await saveSettings();
  applySettings();
  settingsDialog.close();
});

settingsCancelBtn.addEventListener("click", () => settingsDialog.close());
settingsCloseBtn.addEventListener("click", () => settingsDialog.close());

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(query) ||
    (/^[^\s]+\.[^\s]{2,}$/i.test(query) && !query.includes(" "));

  if (looksLikeUrl) {
    window.location.href = normalizeUrl(query);
  } else {
    const engine = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES[DEFAULT_SETTINGS.searchEngine];
    window.location.href = `${engine.url}${encodeURIComponent(query)}`;
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isSwitchingNewsFeed = false;

newsLogoBtn.addEventListener("click", async () => {
  if (isSwitchingNewsFeed) return;
  isSwitchingNewsFeed = true;

  await saveNewsProgress();

  newsLogoBtn.classList.add("news-fade-out");
  newsTrack.classList.add("news-fade-out");
  await sleep(220);

  currentNewsFeed = currentNewsFeed === "news" ? "sport" : "news";
  renderNewsLogo();
  await renderNews();

  newsLogoBtn.classList.remove("news-fade-out");
  newsTrack.classList.remove("news-fade-out");
  isSwitchingNewsFeed = false;
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveNewsProgress();
});
window.addEventListener("pagehide", saveNewsProgress);
setInterval(saveNewsProgress, 10_000);

renderGreeting();
renderClocks();
setInterval(renderClocks, 30_000);
loadSettings();
loadNewsProgress().then(() => {
  renderNewsLogo();
  renderNews();
});
