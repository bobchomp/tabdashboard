const SETTINGS_KEY = "settings";
const USER_NAME = "Ross";

const SEARCH_ENGINES = {
  duckduckgo: { label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  google: { label: "Google", url: "https://www.google.com/search?q=" },
  bing: { label: "Bing", url: "https://www.bing.com/search?q=" },
  ecosia: { label: "Ecosia", url: "https://www.ecosia.org/search?q=" },
};
const DEFAULT_SETTINGS = { searchEngine: "duckduckgo", appleId: "", appSpecificPassword: "" };

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
const onThisDayEl = document.getElementById("on-this-day");
const wordWidgetEl = document.getElementById("word-widget");
const currencyWidgetEl = document.getElementById("currency-widget");
const quoteWidgetEl = document.getElementById("quote-widget");

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
const appleIdInput = document.getElementById("apple-id-input");
const applePasswordInput = document.getElementById("apple-password-input");
const calendarWidget = document.getElementById("calendar-widget");
const icsFeedWidget = document.getElementById("ics-feed-widget");

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

let onThisDayEvents = [];
let onThisDayIndex = 0;

function renderOnThisDayFallback() {
  onThisDayEl.innerHTML = "";
  const label = document.createElement("div");
  label.className = "otd-label";
  label.textContent = "On this day";
  const event = document.createElement("div");
  event.className = "otd-event";
  event.textContent = "Unable to load today's event.";
  onThisDayEl.append(label, event);
}

function renderOnThisDayEvent(event) {
  onThisDayEl.innerHTML = "";

  const label = document.createElement("div");
  label.className = "otd-label";
  label.append("On this day in ");
  const yearStrong = document.createElement("strong");
  yearStrong.textContent = event.year;
  label.appendChild(yearStrong);

  const eventEl = document.createElement("div");
  eventEl.className = "otd-event";
  eventEl.appendChild(document.createTextNode(event.text));

  onThisDayEl.append(label, eventEl);

  if (event.url) {
    const link = document.createElement("a");
    link.className = "otd-link";
    link.href = event.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append("Find out more");
    link.insertAdjacentHTML(
      "beforeend",
      `<svg class="otd-link-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>`
    );
    onThisDayEl.appendChild(link);
  }
}

const ON_THIS_DAY_ROTATE_MS = 12_000;

let isRotatingOnThisDay = false;
let onThisDayAutoTimer = null;

async function advanceOnThisDay() {
  if (onThisDayEvents.length < 2) return;
  if (isRotatingOnThisDay) return;
  isRotatingOnThisDay = true;

  onThisDayEl.classList.add("otd-fade-out");
  await sleep(220);

  onThisDayIndex = (onThisDayIndex + 1) % onThisDayEvents.length;
  renderOnThisDayEvent(onThisDayEvents[onThisDayIndex]);

  onThisDayEl.classList.remove("otd-fade-out");
  isRotatingOnThisDay = false;
}

function startOnThisDayAutoRotate() {
  if (onThisDayAutoTimer) clearInterval(onThisDayAutoTimer);
  onThisDayAutoTimer = null;
  if (onThisDayEvents.length < 2) return;
  onThisDayAutoTimer = setInterval(advanceOnThisDay, ON_THIS_DAY_ROTATE_MS);
}

async function renderOnThisDay() {
  let events;
  try {
    events = await browser.runtime.sendMessage({ type: "get-on-this-day" });
  } catch (error) {
    console.error("[on-this-day] sendMessage failed:", error);
    events = [];
  }

  onThisDayEvents = Array.isArray(events) ? events.filter((event) => event && event.text) : [];

  if (!onThisDayEvents.length) {
    renderOnThisDayFallback();
    return;
  }

  onThisDayIndex = 0;
  renderOnThisDayEvent(onThisDayEvents[onThisDayIndex]);
  startOnThisDayAutoRotate();
}

onThisDayEl.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  advanceOnThisDay();
  startOnThisDayAutoRotate();
});

function renderSideWidgetMessage(container, label, message) {
  container.innerHTML = "";
  const labelEl = document.createElement("div");
  labelEl.className = "side-widget-label";
  labelEl.textContent = label;
  const empty = document.createElement("div");
  empty.className = "side-widget-empty";
  empty.textContent = message;
  container.append(labelEl, empty);
}

async function renderWordOfDay() {
  let word;
  try {
    word = await browser.runtime.sendMessage({ type: "get-word-of-day" });
  } catch (error) {
    console.error("[word-of-day] sendMessage failed:", error);
    word = null;
  }

  if (!word || !word.word || !word.definition) {
    renderSideWidgetMessage(wordWidgetEl, "Word of the day", "Unable to load a word today.");
    return;
  }

  wordWidgetEl.innerHTML = "";

  const label = document.createElement("div");
  label.className = "side-widget-label";
  label.textContent = "Word of the day";

  const wordEl = document.createElement("div");
  wordEl.className = "word-of-day-word";
  wordEl.textContent = word.word;

  wordWidgetEl.append(label, wordEl);

  if (word.partOfSpeech) {
    const pos = document.createElement("div");
    pos.className = "word-of-day-pos";
    pos.textContent = word.partOfSpeech;
    wordWidgetEl.appendChild(pos);
  }

  const definition = document.createElement("div");
  definition.className = "word-of-day-definition";
  definition.textContent = word.definition;
  wordWidgetEl.appendChild(definition);
}

async function renderQuoteOfDay() {
  let quote;
  try {
    quote = await browser.runtime.sendMessage({ type: "get-quote-of-day" });
  } catch (error) {
    console.error("[quote-of-day] sendMessage failed:", error);
    quote = null;
  }

  if (!quote || !quote.text || !quote.author) {
    renderSideWidgetMessage(quoteWidgetEl, "Quote of the day", "Unable to load a quote today.");
    return;
  }

  quoteWidgetEl.innerHTML = "";

  const label = document.createElement("div");
  label.className = "side-widget-label";
  label.textContent = "Quote of the day";

  const text = document.createElement("div");
  text.className = "quote-of-day-text";
  text.textContent = `"${quote.text}"`;

  const author = document.createElement("div");
  author.className = "quote-of-day-author";
  author.textContent = `— ${quote.author}`;

  quoteWidgetEl.append(label, text, author);
}

const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", JPY: "¥", AUD: "A$" };

async function renderCurrencyWidget() {
  let rates;
  try {
    rates = await browser.runtime.sendMessage({ type: "get-exchange-rates" });
  } catch (error) {
    console.error("[exchange-rates] sendMessage failed:", error);
    rates = null;
  }

  if (!Array.isArray(rates) || !rates.length) {
    renderSideWidgetMessage(currencyWidgetEl, "Exchange rates", "Unable to load exchange rates today.");
    return;
  }

  currencyWidgetEl.innerHTML = "";

  const label = document.createElement("div");
  label.className = "side-widget-label";
  label.textContent = "GBP exchange rates";

  const list = document.createElement("div");
  list.className = "currency-rates";

  for (const { code, rate } of rates) {
    const row = document.createElement("div");
    row.className = "currency-rate-row";

    const pair = document.createElement("div");
    pair.className = "currency-rate-pair";
    pair.textContent = `GBP → ${code}`;

    const value = document.createElement("div");
    value.className = "currency-rate-value";
    const symbol = CURRENCY_SYMBOLS[code] || "";
    value.textContent = `${symbol}${rate.toFixed(2)}`;

    row.append(pair, value);
    list.appendChild(row);
  }

  currencyWidgetEl.append(label, list);
}

function formatEventDayLabel(date) {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function formatEventTime(event) {
  if (event.allDay) return "All day";
  return new Date(event.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function renderCalendarMessageInto(container, message, { label }) {
  container.hidden = false;
  container.innerHTML = "";
  if (label) {
    const labelEl = document.createElement("div");
    labelEl.className = "calendar-label";
    labelEl.textContent = label;
    container.appendChild(labelEl);
  }

  const scroll = document.createElement("div");
  scroll.className = "calendar-scroll";
  const empty = document.createElement("div");
  empty.className = "calendar-empty";
  empty.textContent = message;
  scroll.appendChild(empty);
  container.appendChild(scroll);
}

function renderCalendarEventsInto(container, events, { label }) {
  container.hidden = false;
  container.innerHTML = "";

  if (label) {
    const labelEl = document.createElement("div");
    labelEl.className = "calendar-label";
    labelEl.textContent = label;
    container.appendChild(labelEl);
  }

  const scroll = document.createElement("div");
  scroll.className = "calendar-scroll";
  container.appendChild(scroll);

  let currentDayKey = null;
  let currentDayEl = null;

  for (const event of events) {
    const start = new Date(event.start);
    const dayKey = start.toDateString();

    if (dayKey !== currentDayKey) {
      currentDayKey = dayKey;
      currentDayEl = document.createElement("div");
      currentDayEl.className = "calendar-day";

      const heading = document.createElement("div");
      heading.className = "calendar-day-heading";
      heading.textContent = formatEventDayLabel(start);
      currentDayEl.appendChild(heading);

      scroll.appendChild(currentDayEl);
    }

    const eventEl = document.createElement("div");
    eventEl.className = "calendar-event";

    const title = document.createElement("div");
    title.className = "calendar-event-title";
    title.textContent = event.summary;

    const time = document.createElement("div");
    time.className = "calendar-event-time";
    time.textContent = formatEventTime(event);

    eventEl.append(title, time);
    currentDayEl.appendChild(eventEl);
  }
}

async function renderCalendar() {
  if (!settings.appleId || !settings.appSpecificPassword) {
    renderCalendarMessageInto(calendarWidget, "Add your Apple ID in Settings to see your calendar.", { label: "Calendar" });
    return;
  }

  let events;
  try {
    events = await browser.runtime.sendMessage({ type: "get-calendar-events" });
  } catch (error) {
    console.error("[calendar] sendMessage failed:", error);
    renderCalendarMessageInto(calendarWidget, "Unable to load your calendar right now.", { label: "Calendar" });
    return;
  }

  if (!events) {
    renderCalendarMessageInto(calendarWidget, "Add your Apple ID in Settings to see your calendar.", { label: "Calendar" });
    return;
  }

  if (!events.length) {
    renderCalendarMessageInto(calendarWidget, "Nothing here for the next 7 days.", { label: "Calendar" });
    return;
  }

  renderCalendarEventsInto(calendarWidget, events, { label: "Calendar" });
}

async function renderIcsFeedCalendar() {
  let events;
  try {
    events = await browser.runtime.sendMessage({ type: "get-ics-feed-events" });
  } catch (error) {
    console.error("[ics-feed] sendMessage failed:", error);
    renderCalendarMessageInto(icsFeedWidget, "Nothing here right now.", { label: "Dollops Ice Cream" });
    return;
  }

  if (!events || !events.length) {
    renderCalendarMessageInto(icsFeedWidget, "Nothing here for the next 7 days.", { label: "Dollops Ice Cream" });
    return;
  }

  renderCalendarEventsInto(icsFeedWidget, events, { label: "Dollops Ice Cream" });
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
  appleIdInput.value = settings.appleId;
  applePasswordInput.value = settings.appSpecificPassword;
  settingsDialog.showModal();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const credentialsChanged =
    appleIdInput.value.trim() !== settings.appleId ||
    applePasswordInput.value.trim() !== settings.appSpecificPassword;

  settings.searchEngine = searchEngineSelect.value;
  settings.appleId = appleIdInput.value.trim();
  settings.appSpecificPassword = applePasswordInput.value.trim();
  await saveSettings();
  applySettings();
  settingsDialog.close();

  if (credentialsChanged) renderCalendar();
});

settingsCancelBtn.addEventListener("click", () => settingsDialog.close());
settingsCloseBtn.addEventListener("click", () => settingsDialog.close());

function runSearch(rawQuery) {
  const query = rawQuery.trim();
  if (!query) return;

  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(query) ||
    (/^[^\s]+\.[^\s]{2,}$/i.test(query) && !query.includes(" "));

  if (looksLikeUrl) {
    window.location.href = normalizeUrl(query);
  } else {
    const engine = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES[DEFAULT_SETTINGS.searchEngine];
    window.location.href = `${engine.url}${encodeURIComponent(query)}`;
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(searchInput.value);
});

const SUGGESTION_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
const searchSuggestionsEl = document.getElementById("search-suggestions");

let suggestionItems = [];
let activeSuggestionIndex = -1;
let suggestDebounceTimer = null;
let suggestRequestId = 0;

function hideSuggestions() {
  searchSuggestionsEl.hidden = true;
  searchSuggestionsEl.innerHTML = "";
  suggestionItems = [];
  activeSuggestionIndex = -1;
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");
}

function selectSuggestion(text) {
  searchInput.value = text;
  hideSuggestions();
  runSearch(text);
}

function renderSuggestions(items) {
  if (!items.length) {
    hideSuggestions();
    return;
  }

  suggestionItems = items;
  activeSuggestionIndex = -1;
  searchSuggestionsEl.innerHTML = "";

  items.forEach((text, index) => {
    const li = document.createElement("li");
    li.className = "suggestion";
    li.id = `suggestion-${index}`;
    li.setAttribute("role", "option");
    li.innerHTML = SUGGESTION_ICON;
    const label = document.createElement("span");
    label.textContent = text;
    li.appendChild(label);
    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectSuggestion(text);
    });
    searchSuggestionsEl.appendChild(li);
  });

  searchSuggestionsEl.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
}

function setActiveSuggestion(index) {
  const options = searchSuggestionsEl.querySelectorAll(".suggestion");
  options.forEach((el) => el.classList.remove("active"));
  activeSuggestionIndex = index;
  if (index >= 0 && options[index]) {
    options[index].classList.add("active");
    searchInput.setAttribute("aria-activedescendant", options[index].id);
  } else {
    searchInput.removeAttribute("aria-activedescendant");
  }
}

async function fetchSuggestions(query) {
  const requestId = ++suggestRequestId;
  try {
    const results = await browser.runtime.sendMessage({
      type: "get-suggestions",
      engine: settings.searchEngine,
      query,
    });
    if (requestId !== suggestRequestId) return;
    renderSuggestions(results || []);
  } catch {
    if (requestId !== suggestRequestId) return;
    hideSuggestions();
  }
}

searchInput.addEventListener("input", () => {
  const query = searchInput.value;
  clearTimeout(suggestDebounceTimer);

  if (query.trim().length < 2) {
    suggestRequestId++;
    hideSuggestions();
    return;
  }

  suggestDebounceTimer = setTimeout(() => fetchSuggestions(query), 180);
});

searchInput.addEventListener("keydown", (event) => {
  if (searchSuggestionsEl.hidden) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveSuggestion(Math.min(activeSuggestionIndex + 1, suggestionItems.length - 1));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveSuggestion(Math.max(activeSuggestionIndex - 1, -1));
  } else if (event.key === "Escape") {
    hideSuggestions();
  } else if (event.key === "Enter" && activeSuggestionIndex >= 0) {
    event.preventDefault();
    selectSuggestion(suggestionItems[activeSuggestionIndex]);
  }
});

searchInput.addEventListener("blur", () => {
  hideSuggestions();
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
loadSettings().then(() => renderCalendar());
renderIcsFeedCalendar();
renderOnThisDay();
renderWordOfDay();
renderCurrencyWidget();
renderQuoteOfDay();
loadNewsProgress().then(() => {
  renderNewsLogo();
  renderNews();
});
