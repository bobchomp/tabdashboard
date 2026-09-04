const STORAGE_KEY = "quickLinks";
const SETTINGS_KEY = "settings";

const SEARCH_ENGINES = {
  duckduckgo: { label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  google: { label: "Google", url: "https://www.google.com/search?q=" },
  bing: { label: "Bing", url: "https://www.bing.com/search?q=" },
  ecosia: { label: "Ecosia", url: "https://www.ecosia.org/search?q=" },
};
const DEFAULT_LOCATION = { name: "Inverness", lat: 57.4778, lng: -4.2247, timezone: "Europe/London" };
const DEFAULT_SETTINGS = {
  searchEngine: "duckduckgo",
  appleId: "",
  appSpecificPassword: "",
  userName: "Ross",
  location: DEFAULT_LOCATION,
};

// Firefox's non-persistent background script can still be waking up when
// several sendMessage calls fire near-simultaneously on page load, which
// intermittently fails one of them with "Could not establish connection"
// even though the listener is registered and working. Retry once after a
// short delay rather than treating that race as a real failure.
async function sendMessageWithRetry(message, attempts = 2) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (error) {
      const isConnectionRace = /Could not establish connection/i.test(error?.message || "");
      if (!isConnectionRace || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

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

const TILE_PALETTE = [
  { bg: "#C9B8F0", text: "#4A3E80" },
  { bg: "#B8ECD3", text: "#2B6B4D" },
  { bg: "#FFD3B0", text: "#8A5A2B" },
  { bg: "#FBE7A1", text: "#8A6A12" },
  { bg: "#F7C6DE", text: "#99416B" },
];

const ADD_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
const EDIT_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;

const clockEls = document.querySelectorAll("[data-clock]");
const clockMainEl = document.querySelector(".clock-main");
const clockMainCityEl = clockMainEl.querySelector(".clock-city");
const newsTrack = document.getElementById("news-track");
const newsLogoBtn = document.getElementById("news-logo");
const onThisDayEl = document.getElementById("on-this-day");
const currencyWidgetEl = document.getElementById("currency-widget");
const quoteWidgetEl = document.getElementById("quote-widget");
const sunriseWidgetEl = document.getElementById("sunrise-widget");

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

const linksGrid = document.getElementById("links");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");

const linkDialog = document.getElementById("link-dialog");
const linkForm = document.getElementById("link-form");
const linkDialogTitle = document.getElementById("link-dialog-title");
const linkTitleInput = document.getElementById("link-title");
const linkUrlInput = document.getElementById("link-url");
const linkDeleteBtn = document.getElementById("link-delete");
const linkCancelBtn = document.getElementById("link-cancel");
const linkCloseBtn = document.getElementById("link-close");

const greetingEl = document.getElementById("greeting");
const settingsBtn = document.getElementById("settings-btn");
const settingsDialog = document.getElementById("settings-dialog");
const settingsForm = document.getElementById("settings-form");
const settingsCancelBtn = document.getElementById("settings-cancel");
const settingsCloseBtn = document.getElementById("settings-close");
const searchEngineSelect = document.getElementById("search-engine-select");
const appleIdInput = document.getElementById("apple-id-input");
const applePasswordInput = document.getElementById("apple-password-input");
const nameInput = document.getElementById("name-input");
const locationInput = document.getElementById("location-input");
const locationErrorEl = document.getElementById("location-error");
const calendarWidget = document.getElementById("calendar-widget");
const icsFeedWidget = document.getElementById("ics-feed-widget");

let links = [];
let editingId = null;
let settings = { ...DEFAULT_SETTINGS };

async function loadLinks() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  links = result[STORAGE_KEY] || [];
  render();
}

async function saveLinks() {
  await browser.storage.local.set({ [STORAGE_KEY]: links });
}

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

  const location = settings.location || DEFAULT_SETTINGS.location;
  clockMainCityEl.textContent = location.name;
  clockMainEl.dataset.clock = location.timezone || "local";

  renderGreeting();
  renderClocks();
}

function renderGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  greetingEl.textContent = `${greeting}, ${settings.userName || DEFAULT_SETTINGS.userName}`;
}

// en-GB's default weekday+day+month formatting omits the comma
// ("Friday 4 September"), so build it from two calls instead.
function formatFullDate(date, timeZone) {
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long", timeZone });
  const dayMonth = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone });
  return `${weekday}, ${dayMonth}`;
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

    const dateEl = el.querySelector(".clock-date");
    if (dateEl) {
      dateEl.textContent = formatFullDate(now, timeZone === "local" ? undefined : timeZone);
    }
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

let quoteOfDayItems = [];
let quoteOfDayIndex = 0;

function renderQuoteOfDayItem(quote) {
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

let currencyRates = [];
let currencyIndex = 0;

function renderCurrencyRate(rate) {
  currencyWidgetEl.innerHTML = "";

  const label = document.createElement("div");
  label.className = "side-widget-label";
  label.textContent = "GBP exchange rates";

  const row = document.createElement("div");
  row.className = "currency-rate-row";

  const pair = document.createElement("div");
  pair.className = "currency-rate-pair";
  pair.textContent = `GBP → ${rate.code}`;

  const value = document.createElement("div");
  value.className = "currency-rate-value";
  const symbol = CURRENCY_SYMBOLS[rate.code] || "";
  value.textContent = `${symbol}${rate.rate.toFixed(2)}`;

  row.append(pair, value);
  currencyWidgetEl.append(label, row);
}

function advanceOnThisDayIndex() {
  onThisDayIndex = (onThisDayIndex + 1) % onThisDayEvents.length;
  renderOnThisDayEvent(onThisDayEvents[onThisDayIndex]);
}

function advanceQuoteIndex() {
  quoteOfDayIndex = (quoteOfDayIndex + 1) % quoteOfDayItems.length;
  renderQuoteOfDayItem(quoteOfDayItems[quoteOfDayIndex]);
}

function advanceCurrencyIndex() {
  currencyIndex = (currencyIndex + 1) % currencyRates.length;
  renderCurrencyRate(currencyRates[currencyIndex]);
}

// The exchange-rate widget cycles every 6s; on-this-day and quote-of-the-day
// cycle every 12s (every other exchange-rate tick), so all three land on the
// same change together every 12s, with the exchange rate also changing once
// on its own halfway in between. One shared timer with a tick counter drives
// all of it, rather than separate per-widget timers, so they can't drift.
const TICK_MS = 6_000;

let isRotating = false;
let rotateAutoTimer = null;
let tickCount = 0;

// A card's height is auto (driven by its content), and CSS can't transition
// to/from "auto" directly. Lock the card to its current pixel height, swap
// the content, measure the new natural height, then animate between the two
// explicit pixel values so the height change — and the reflow it causes in
// the cards below it — is smooth instead of an instant jump.
function animateHeightChange(el, updateContent) {
  const startHeight = el.offsetHeight;
  el.style.height = `${startHeight}px`;
  el.style.overflow = "hidden";

  updateContent();

  el.style.height = "auto";
  const endHeight = el.offsetHeight;
  el.style.height = `${startHeight}px`;
  void el.offsetHeight; // force the browser to commit startHeight before animating

  const cleanup = () => {
    el.style.height = "";
    el.style.overflow = "";
    el.removeEventListener("transitionend", onTransitionEnd);
  };
  const onTransitionEnd = (event) => {
    if (event.propertyName === "height") cleanup();
  };
  el.addEventListener("transitionend", onTransitionEnd);
  setTimeout(cleanup, 400); // fallback in case transitionend never fires

  requestAnimationFrame(() => {
    el.style.height = `${endHeight}px`;
  });
}

// Fades out, advances, height-animates, and fades back in every entry in
// the group at the same time — used for both a single manually-clicked
// widget and the multi-widget auto-tick, so simultaneous changes are always
// driven by one fade/sleep/advance pass rather than several racing ones.
async function fadeAndAdvance(entries) {
  if (!entries.length || isRotating) return;
  isRotating = true;

  for (const { el } of entries) el.classList.add("rotator-fade-out");
  await sleep(220);

  for (const { el, advance } of entries) {
    animateHeightChange(el, advance);
    el.classList.remove("rotator-fade-out");
  }

  isRotating = false;
}

async function handleAutoTick() {
  tickCount++;
  const entries = [];

  if (currencyRates.length >= 2) {
    entries.push({ el: currencyWidgetEl, advance: advanceCurrencyIndex });
  }
  if (tickCount % 2 === 0) {
    if (onThisDayEvents.length >= 2) entries.push({ el: onThisDayEl, advance: advanceOnThisDayIndex });
    if (quoteOfDayItems.length >= 2) entries.push({ el: quoteWidgetEl, advance: advanceQuoteIndex });
    if (sunriseTimes && weatherData) entries.push({ el: sunriseWidgetEl, advance: advanceSunriseWidgetView });
  }

  await fadeAndAdvance(entries);
}

function startAutoRotate() {
  if (rotateAutoTimer) clearInterval(rotateAutoTimer);
  rotateAutoTimer = null;
  tickCount = 0;
  const canRotateAny =
    onThisDayEvents.length >= 2 ||
    quoteOfDayItems.length >= 2 ||
    currencyRates.length >= 2 ||
    (sunriseTimes && weatherData);
  if (!canRotateAny) return;
  rotateAutoTimer = setInterval(handleAutoTick, TICK_MS);
}

async function renderOnThisDay() {
  let events;
  try {
    events = await sendMessageWithRetry({ type: "get-on-this-day" });
  } catch (error) {
    console.error("[on-this-day] sendMessage failed:", error);
    events = [];
  }

  onThisDayEvents = Array.isArray(events) ? events.filter((event) => event && event.text) : [];

  if (!onThisDayEvents.length) {
    renderOnThisDayFallback();
  } else {
    onThisDayIndex = 0;
    renderOnThisDayEvent(onThisDayEvents[onThisDayIndex]);
  }
  startAutoRotate();
}

async function renderQuoteOfDay() {
  let quotes;
  try {
    quotes = await sendMessageWithRetry({ type: "get-quote-of-day" });
  } catch (error) {
    console.error("[quote-of-day] sendMessage failed:", error);
    quotes = [];
  }

  quoteOfDayItems = Array.isArray(quotes) ? quotes.filter((quote) => quote && quote.text && quote.author) : [];

  if (!quoteOfDayItems.length) {
    renderSideWidgetMessage(quoteWidgetEl, "Quote of the day", "Unable to load a quote today.");
  } else {
    quoteOfDayIndex = 0;
    renderQuoteOfDayItem(quoteOfDayItems[quoteOfDayIndex]);
  }
  startAutoRotate();
}

async function renderCurrencyWidget() {
  let rates;
  try {
    rates = await sendMessageWithRetry({ type: "get-exchange-rates" });
  } catch (error) {
    console.error("[exchange-rates] sendMessage failed:", error);
    rates = null;
  }

  currencyRates = Array.isArray(rates) ? rates.filter((rate) => rate && rate.code && typeof rate.rate === "number") : [];

  if (!currencyRates.length) {
    renderSideWidgetMessage(currencyWidgetEl, "Exchange rates", "Unable to load exchange rates today.");
  } else {
    currencyIndex = 0;
    renderCurrencyRate(currencyRates[currencyIndex]);
  }
  startAutoRotate();
}

function formatDayTime(isoString) {
  return new Date(isoString).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const WEATHER_ICONS = {
  sun: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5"></circle>
    <line x1="12" y1="1" x2="12" y2="3"></line>
    <line x1="12" y1="21" x2="12" y2="23"></line>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
    <line x1="1" y1="12" x2="3" y2="12"></line>
    <line x1="21" y1="12" x2="23" y2="12"></line>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
  </svg>`,
  cloud: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
  </svg>`,
  rain: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="16" y1="13" x2="16" y2="21"></line>
    <line x1="8" y1="13" x2="8" y2="21"></line>
    <line x1="12" y1="15" x2="12" y2="23"></line>
    <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"></path>
  </svg>`,
  snow: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"></path>
    <line x1="8" y1="16" x2="8.01" y2="16"></line>
    <line x1="8" y1="20" x2="8.01" y2="20"></line>
    <line x1="12" y1="18" x2="12.01" y2="18"></line>
    <line x1="12" y1="22" x2="12.01" y2="22"></line>
    <line x1="16" y1="16" x2="16.01" y2="16"></line>
    <line x1="16" y1="20" x2="16.01" y2="20"></line>
  </svg>`,
  storm: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"></path>
    <polyline points="13 11 9 17 15 17 11 23"></polyline>
  </svg>`,
};

let sunriseTimes = null;
let weatherData = null;
let sunriseWidgetView = "sunrise";

function renderSunriseSunsetView() {
  sunriseWidgetEl.innerHTML = "";

  const locationName = (settings.location || DEFAULT_SETTINGS.location).name;
  const label = document.createElement("div");
  label.className = "side-widget-label";
  label.textContent = `Sunrise & sunset (${locationName})`;

  const rows = document.createElement("div");
  rows.className = "sunrise-rows";

  const entries = [
    ["Sunrise", sunriseTimes.sunrise],
    ["Sunset", sunriseTimes.sunset],
  ];

  for (const [name, iso] of entries) {
    const row = document.createElement("div");
    row.className = "sunrise-row";

    const nameEl = document.createElement("div");
    nameEl.className = "sunrise-label";
    nameEl.textContent = name;

    const timeEl = document.createElement("div");
    timeEl.className = "sunrise-time";
    timeEl.textContent = formatDayTime(iso);

    row.append(nameEl, timeEl);
    rows.appendChild(row);
  }

  sunriseWidgetEl.append(label, rows);
}

function renderWeatherView() {
  sunriseWidgetEl.innerHTML = "";

  const locationName = (settings.location || DEFAULT_SETTINGS.location).name;
  const label = document.createElement("div");
  label.className = "side-widget-label";
  label.textContent = `Weather (${locationName})`;

  const row = document.createElement("div");
  row.className = "weather-row";
  row.innerHTML = WEATHER_ICONS[weatherData.icon] || WEATHER_ICONS.cloud;

  const temp = document.createElement("div");
  temp.className = "weather-temp";
  temp.textContent = `${Math.round(weatherData.tempC)}°C`;
  row.appendChild(temp);

  const condition = document.createElement("div");
  condition.className = "weather-condition";
  condition.textContent = weatherData.label;

  sunriseWidgetEl.append(label, row, condition);
}

function renderSunriseWidgetContent() {
  if (sunriseWidgetView === "weather" && weatherData) {
    renderWeatherView();
  } else if (sunriseTimes) {
    renderSunriseSunsetView();
  } else if (weatherData) {
    renderWeatherView();
  }
}

function advanceSunriseWidgetView() {
  sunriseWidgetView = sunriseWidgetView === "sunrise" ? "weather" : "sunrise";
  renderSunriseWidgetContent();
}

async function renderSunriseWidget() {
  const [sunriseResult, weatherResult] = await Promise.allSettled([
    sendMessageWithRetry({ type: "get-sunrise-sunset" }),
    sendMessageWithRetry({ type: "get-weather" }),
  ]);

  sunriseTimes =
    sunriseResult.status === "fulfilled" && sunriseResult.value?.sunrise && sunriseResult.value?.sunset
      ? sunriseResult.value
      : null;
  if (sunriseResult.status === "rejected") {
    console.error("[sunrise-sunset] sendMessage failed:", sunriseResult.reason);
  }

  weatherData =
    weatherResult.status === "fulfilled" &&
    weatherResult.value &&
    typeof weatherResult.value.tempC === "number"
      ? weatherResult.value
      : null;
  if (weatherResult.status === "rejected") {
    console.error("[weather] sendMessage failed:", weatherResult.reason);
  }

  sunriseWidgetView = "sunrise";

  if (!sunriseTimes && !weatherData) {
    renderSideWidgetMessage(sunriseWidgetEl, "Sunrise & weather", "Unable to load sunrise/sunset or weather today.");
  } else {
    renderSunriseWidgetContent();
  }
  startAutoRotate();
}

onThisDayEl.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  if (onThisDayEvents.length >= 2) {
    fadeAndAdvance([{ el: onThisDayEl, advance: advanceOnThisDayIndex }]);
  }
  startAutoRotate();
});

quoteWidgetEl.addEventListener("click", () => {
  if (quoteOfDayItems.length >= 2) {
    fadeAndAdvance([{ el: quoteWidgetEl, advance: advanceQuoteIndex }]);
  }
  startAutoRotate();
});

function formatEventDayLabel(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dayStart - today) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return formatFullDate(date);
}

function formatEventTime(event) {
  if (event.allDay) return "All day";
  return new Date(event.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Slowly, continuously auto-scrolls a box up and down between its ends,
// pausing briefly at each end and whenever the user hovers/touches/wheels
// it. Re-render calls a fresh scroll box into existence each time (see
// container._stopAutoScroll below), so this returns a cleanup function the
// caller stops before starting a new one, rather than leaving the previous
// box's rAF loop running forever on a detached element.
function enableAutoScroll(el, { speed = 0.3, pauseMs = 1800 } = {}) {
  let direction = 1;
  let paused = false;
  let rafId = null;
  let waitTimer = null;
  let resumeTimer = null;
  // scrollTop is rounded to a whole pixel by the browser on every read, so
  // el.scrollTop += 0.3 never accumulates (each frame reads back the same
  // rounded value it just wrote). Track the true position separately as a
  // float and only ever write it to the DOM, never read it back mid-scroll.
  let position = el.scrollTop;

  const maxScroll = () => el.scrollHeight - el.clientHeight;

  function waitThenReverse() {
    paused = true;
    waitTimer = setTimeout(() => {
      direction *= -1;
      paused = false;
    }, pauseMs);
  }

  function step() {
    const limit = maxScroll();
    if (!paused && limit > 1) {
      position += direction * speed;
      if (direction === 1 && position >= limit) {
        position = limit;
        el.scrollTop = position;
        waitThenReverse();
      } else if (direction === -1 && position <= 0) {
        position = 0;
        el.scrollTop = position;
        waitThenReverse();
      } else {
        el.scrollTop = position;
      }
    }
    rafId = requestAnimationFrame(step);
  }

  function pauseForInteraction() {
    paused = true;
    if (resumeTimer) clearTimeout(resumeTimer);
  }
  function resumeAfterInteraction() {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      position = el.scrollTop; // pick up wherever the user left it
      paused = false;
    }, 2000);
  }

  el.addEventListener("mouseenter", pauseForInteraction);
  el.addEventListener("mouseleave", resumeAfterInteraction);
  el.addEventListener("wheel", resumeAfterInteraction, { passive: true });
  el.addEventListener("touchstart", pauseForInteraction, { passive: true });
  el.addEventListener("touchend", resumeAfterInteraction, { passive: true });

  rafId = requestAnimationFrame(step);

  return () => {
    cancelAnimationFrame(rafId);
    if (waitTimer) clearTimeout(waitTimer);
    if (resumeTimer) clearTimeout(resumeTimer);
  };
}

function renderCalendarMessageInto(container, message, { label }) {
  container._stopAutoScroll?.();
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
  container._stopAutoScroll = enableAutoScroll(scroll);
}

function renderCalendarEventsInto(container, events, { label }) {
  container._stopAutoScroll?.();
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
  container._stopAutoScroll = enableAutoScroll(scroll);

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
    events = await sendMessageWithRetry({ type: "get-calendar-events" });
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
    events = await sendMessageWithRetry({ type: "get-ics-feed-events" });
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
    headlines = await sendMessageWithRetry({ type: "get-headlines", feed: currentNewsFeed });
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

function paletteFor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return TILE_PALETTE[hash % TILE_PALETTE.length];
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function faviconUrlFor(pageUrl) {
  try {
    const { hostname } = new URL(pageUrl);
    return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
  } catch {
    return null;
  }
}

function showFallbackIcon(icon, link, palette) {
  icon.innerHTML = "";
  icon.style.background = palette.bg;
  icon.style.color = palette.text;
  icon.textContent = (link.title || link.url).trim().charAt(0).toUpperCase();
}

function render() {
  linksGrid.innerHTML = "";

  for (const link of links) {
    const tile = document.createElement("a");
    tile.className = "link-tile";
    tile.href = link.url;

    const palette = link.colorBg ? { bg: link.colorBg, text: link.colorText } : paletteFor(link.title || link.url);

    const icon = document.createElement("div");
    icon.className = "tile-icon";

    const faviconUrl = faviconUrlFor(link.url);
    if (faviconUrl) {
      icon.style.background = "#fff";
      const img = document.createElement("img");
      img.className = "tile-favicon";
      img.src = faviconUrl;
      img.alt = "";
      img.addEventListener("error", () => showFallbackIcon(icon, link, palette));
      icon.appendChild(img);
    } else {
      showFallbackIcon(icon, link, palette);
    }

    const label = document.createElement("div");
    label.className = "tile-label";
    label.textContent = link.title;

    const editBtn = document.createElement("button");
    editBtn.className = "tile-edit";
    editBtn.type = "button";
    editBtn.innerHTML = EDIT_ICON;
    editBtn.setAttribute("aria-label", "Edit link");
    editBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDialog(link);
    });

    tile.append(icon, label, editBtn);
    linksGrid.appendChild(tile);
  }

  const addTile = document.createElement("button");
  addTile.type = "button";
  addTile.className = "add-tile";
  addTile.innerHTML = ADD_ICON;
  addTile.setAttribute("aria-label", "Add link");
  addTile.addEventListener("click", () => openDialog(null));
  linksGrid.appendChild(addTile);
}

function openDialog(link) {
  editingId = link ? link.id : null;
  linkDialogTitle.textContent = link ? "Edit link" : "Add link";
  linkTitleInput.value = link ? link.title : "";
  linkUrlInput.value = link ? link.url : "";
  linkDeleteBtn.hidden = !link;
  linkDialog.showModal();
  linkTitleInput.focus();
}

linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = linkTitleInput.value.trim();
  const url = normalizeUrl(linkUrlInput.value);
  if (!title || !url) return;

  if (editingId) {
    const existing = links.find((l) => l.id === editingId);
    existing.title = title;
    existing.url = url;
  } else {
    const palette = paletteFor(title || url);
    links.push({
      id: crypto.randomUUID(),
      title,
      url,
      colorBg: palette.bg,
      colorText: palette.text,
    });
  }

  await saveLinks();
  render();
  linkDialog.close();
});

linkDeleteBtn.addEventListener("click", async () => {
  links = links.filter((l) => l.id !== editingId);
  await saveLinks();
  render();
  linkDialog.close();
});

linkCancelBtn.addEventListener("click", () => linkDialog.close());
linkCloseBtn.addEventListener("click", () => linkDialog.close());

settingsBtn.addEventListener("click", () => {
  searchEngineSelect.value = settings.searchEngine;
  appleIdInput.value = settings.appleId;
  applePasswordInput.value = settings.appSpecificPassword;
  nameInput.value = settings.userName;
  locationInput.value = settings.location.name;
  locationErrorEl.hidden = true;
  settingsDialog.showModal();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const credentialsChanged =
    appleIdInput.value.trim() !== settings.appleId ||
    applePasswordInput.value.trim() !== settings.appSpecificPassword;

  const newLocationName = locationInput.value.trim();
  let resolvedLocation = settings.location;

  if (!newLocationName) {
    resolvedLocation = DEFAULT_SETTINGS.location;
  } else if (newLocationName !== settings.location.name) {
    const submitBtn = settingsForm.querySelector('button[type="submit"]');
    locationErrorEl.hidden = true;
    submitBtn.disabled = true;
    try {
      resolvedLocation = await sendMessageWithRetry({ type: "resolve-location", query: newLocationName });
      if (!resolvedLocation || typeof resolvedLocation.lat !== "number" || typeof resolvedLocation.lng !== "number") {
        throw new Error("No location found");
      }
    } catch (error) {
      console.error("[location] resolve failed:", error);
      locationErrorEl.textContent = `Couldn't find "${newLocationName}" — check the spelling and try again.`;
      locationErrorEl.hidden = false;
      submitBtn.disabled = false;
      return;
    }
    submitBtn.disabled = false;
  }

  const locationChanged = resolvedLocation.name !== settings.location.name ||
    resolvedLocation.lat !== settings.location.lat ||
    resolvedLocation.lng !== settings.location.lng;

  settings.searchEngine = searchEngineSelect.value;
  settings.appleId = appleIdInput.value.trim();
  settings.appSpecificPassword = applePasswordInput.value.trim();
  settings.userName = nameInput.value.trim() || DEFAULT_SETTINGS.userName;
  settings.location = resolvedLocation;

  await saveSettings();
  applySettings();
  settingsDialog.close();

  if (credentialsChanged) renderCalendar();
  if (locationChanged) renderSunriseWidget();
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
    const results = await sendMessageWithRetry({
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
loadSettings().then(() => {
  renderCalendar();
  renderSunriseWidget();
});
renderIcsFeedCalendar();
renderOnThisDay();
renderCurrencyWidget();
renderQuoteOfDay();
loadLinks();
loadNewsProgress().then(() => {
  renderNewsLogo();
  renderNews();
});
