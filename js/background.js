const SETTINGS_STORAGE_KEY = "settings";

// iCloud's CalDAV entry point (caldav.icloud.com) redirects discovery to a
// per-account partition server (e.g. p01-caldav.icloud.com), so the CORS
// workaround has to cover any icloud.com host, not just the bare one.
// These servers are built for desktop CalDAV clients, not browsers: they
// never send Access-Control-* headers, and PROPFIND/REPORT are non-simple
// HTTP methods that trigger a CORS preflight regardless of host_permissions.
// Inject the missing headers onto every response from icloud.com (including
// the browser's own preflight OPTIONS response) so the browser accepts it.
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const headers = (details.responseHeaders || []).filter(
      (h) => !/^access-control-/i.test(h.name)
    );
    headers.push({ name: "Access-Control-Allow-Origin", value: "*" });
    headers.push({
      name: "Access-Control-Allow-Methods",
      value: "GET, POST, PUT, DELETE, OPTIONS, PROPFIND, PROPPATCH, REPORT, MKCALENDAR",
    });
    headers.push({
      name: "Access-Control-Allow-Headers",
      value: "Authorization, Content-Type, Depth, If-Match, If-None-Match",
    });
    return { responseHeaders: headers };
  },
  { urls: ["https://*.icloud.com/*"] },
  ["blocking", "responseHeaders"]
);

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

const ON_THIS_DAY_CACHE_KEY = "onThisDayCache";

function todayMonthDay() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

const ON_THIS_DAY_PICK_COUNT = 3;

async function getOnThisDay() {
  const dateKey = todayMonthDay();

  const cached = (await browser.storage.local.get(ON_THIS_DAY_CACHE_KEY))[ON_THIS_DAY_CACHE_KEY];
  if (cached && cached.dateKey === dateKey && Array.isArray(cached.events)) {
    console.log("[on-this-day] serving cached events for", dateKey);
    return cached.events;
  }

  const [month, day] = dateKey.split("-");
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`;
  console.log("[on-this-day] fetching", url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`On this day request failed with status ${response.status}`);
  }

  const data = await response.json();
  const rawEvents = Array.isArray(data.events)
    ? data.events.filter((item) => item && typeof item.text === "string" && typeof item.year === "number")
    : [];
  console.log("[on-this-day] events found:", rawEvents.length);
  if (!rawEvents.length) {
    throw new Error("No events returned");
  }

  const pool = [...rawEvents];
  const pickCount = Math.min(ON_THIS_DAY_PICK_COUNT, pool.length);
  const picked = [];
  for (let i = 0; i < pickCount; i++) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }

  const events = picked.map((item) => {
    const page = Array.isArray(item.pages)
      ? item.pages.find((p) => p?.content_urls?.desktop?.page)
      : null;
    return {
      year: item.year,
      text: item.text,
      url: page ? page.content_urls.desktop.page : null,
    };
  });

  console.log("[on-this-day] picked events:", events.length);
  await browser.storage.local.set({ [ON_THIS_DAY_CACHE_KEY]: { dateKey, events } });
  return events;
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

const QUOTE_OF_DAY_CACHE_KEY = "quoteOfDayCache";
const QUOTE_OF_DAY_PICK_COUNT = 3;

async function fetchRandomQuote() {
  const response = await fetch("https://dummyjson.com/quotes/random");
  if (!response.ok) return null;

  const data = await response.json();
  if (!data || typeof data.quote !== "string" || typeof data.author !== "string") return null;

  return { text: data.quote, author: data.author };
}

async function getQuoteOfTheDay() {
  const dateKey = todayDateKey();

  const cached = (await browser.storage.local.get(QUOTE_OF_DAY_CACHE_KEY))[QUOTE_OF_DAY_CACHE_KEY];
  if (cached && cached.dateKey === dateKey && Array.isArray(cached.quotes)) {
    console.log("[quote-of-day] serving cached quotes for", dateKey);
    return cached.quotes;
  }

  const results = await Promise.allSettled(
    Array.from({ length: QUOTE_OF_DAY_PICK_COUNT }, () => fetchRandomQuote())
  );

  const seen = new Set();
  const quotes = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const key = `${result.value.text}|${result.value.author}`;
    if (seen.has(key)) continue;
    seen.add(key);
    quotes.push(result.value);
  }

  if (!quotes.length) throw new Error("No quotes could be resolved");

  console.log("[quote-of-day] picked quotes:", quotes.length);
  await browser.storage.local.set({ [QUOTE_OF_DAY_CACHE_KEY]: { dateKey, quotes } });
  return quotes;
}

const EXCHANGE_RATES_CACHE_KEY = "exchangeRatesCache";
const EXCHANGE_RATE_TARGETS = ["USD", "EUR", "JPY", "AUD"];

async function getExchangeRates() {
  const dateKey = todayDateKey();

  const cached = (await browser.storage.local.get(EXCHANGE_RATES_CACHE_KEY))[EXCHANGE_RATES_CACHE_KEY];
  if (cached && cached.dateKey === dateKey && Array.isArray(cached.rates)) {
    console.log("[exchange-rates] serving cached rates for", dateKey);
    return cached.rates;
  }

  const url = `https://api.frankfurter.app/latest?from=GBP&to=${EXCHANGE_RATE_TARGETS.join(",")}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Exchange rate request failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data || typeof data.rates !== "object" || !data.rates) {
    throw new Error("Unexpected exchange rate response shape");
  }

  const rates = EXCHANGE_RATE_TARGETS
    .filter((code) => typeof data.rates[code] === "number")
    .map((code) => ({ code, rate: data.rates[code] }));

  if (!rates.length) throw new Error("No exchange rates returned");

  console.log("[exchange-rates] picked rates:", rates.length);
  await browser.storage.local.set({ [EXCHANGE_RATES_CACHE_KEY]: { dateKey, rates } });
  return rates;
}

const SUNRISE_SUNSET_CACHE_KEY = "sunriseSunsetCache";
const DEFAULT_LOCATION = { name: "Inverness", lat: 57.4778, lng: -4.2247, timezone: "Europe/London" };

async function getConfiguredLocation() {
  const stored = (await browser.storage.local.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY] || {};
  const location = stored.location;
  if (location && typeof location.lat === "number" && typeof location.lng === "number") {
    return location;
  }
  return DEFAULT_LOCATION;
}

async function resolveLocation(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Location lookup failed with status ${response.status}`);
  }

  const data = await response.json();
  const result = Array.isArray(data?.results) ? data.results[0] : null;
  if (!result || typeof result.latitude !== "number" || typeof result.longitude !== "number") {
    throw new Error(`No location found for "${query}"`);
  }

  return {
    name: result.name,
    lat: result.latitude,
    lng: result.longitude,
    timezone: result.timezone || "UTC",
  };
}

async function getSunriseSunset() {
  const location = await getConfiguredLocation();
  const dateKey = todayDateKey();

  const cached = (await browser.storage.local.get(SUNRISE_SUNSET_CACHE_KEY))[SUNRISE_SUNSET_CACHE_KEY];
  if (
    cached &&
    cached.dateKey === dateKey &&
    cached.lat === location.lat &&
    cached.lng === location.lng &&
    cached.sunrise &&
    cached.sunset
  ) {
    console.log("[sunrise-sunset] serving cached times for", dateKey);
    return { sunrise: cached.sunrise, sunset: cached.sunset };
  }

  const url = `https://api.sunrise-sunset.org/json?lat=${location.lat}&lng=${location.lng}&formatted=0`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sunrise/sunset request failed with status ${response.status}`);
  }

  const data = await response.json();
  if (data?.status !== "OK" || !data.results?.sunrise || !data.results?.sunset) {
    throw new Error("Unexpected sunrise/sunset response shape");
  }

  const result = { sunrise: data.results.sunrise, sunset: data.results.sunset };
  console.log("[sunrise-sunset] fetched times for", dateKey);
  await browser.storage.local.set({
    [SUNRISE_SUNSET_CACHE_KEY]: { dateKey, lat: location.lat, lng: location.lng, ...result },
  });
  return result;
}

const WEATHER_CACHE_KEY = "weatherCache";
const WEATHER_CACHE_MS = 20 * 60 * 1000;

// WMO weather codes (used by Open-Meteo) collapsed into a handful of
// general buckets, each matched to a simple icon on the newtab side.
const WEATHER_CODE_MAP = {
  0: { label: "Clear sky", icon: "sun" },
  1: { label: "Mainly clear", icon: "sun" },
  2: { label: "Partly cloudy", icon: "cloud" },
  3: { label: "Overcast", icon: "cloud" },
  45: { label: "Fog", icon: "cloud" },
  48: { label: "Fog", icon: "cloud" },
  51: { label: "Light drizzle", icon: "rain" },
  53: { label: "Drizzle", icon: "rain" },
  55: { label: "Dense drizzle", icon: "rain" },
  56: { label: "Freezing drizzle", icon: "rain" },
  57: { label: "Freezing drizzle", icon: "rain" },
  61: { label: "Light rain", icon: "rain" },
  63: { label: "Rain", icon: "rain" },
  65: { label: "Heavy rain", icon: "rain" },
  66: { label: "Freezing rain", icon: "rain" },
  67: { label: "Freezing rain", icon: "rain" },
  71: { label: "Light snow", icon: "snow" },
  73: { label: "Snow", icon: "snow" },
  75: { label: "Heavy snow", icon: "snow" },
  77: { label: "Snow grains", icon: "snow" },
  80: { label: "Rain showers", icon: "rain" },
  81: { label: "Rain showers", icon: "rain" },
  82: { label: "Violent rain showers", icon: "rain" },
  85: { label: "Snow showers", icon: "snow" },
  86: { label: "Snow showers", icon: "snow" },
  95: { label: "Thunderstorm", icon: "storm" },
  96: { label: "Thunderstorm with hail", icon: "storm" },
  99: { label: "Thunderstorm with hail", icon: "storm" },
};

async function getWeather() {
  const location = await getConfiguredLocation();

  const cached = (await browser.storage.local.get(WEATHER_CACHE_KEY))[WEATHER_CACHE_KEY];
  if (
    cached &&
    cached.lat === location.lat &&
    cached.lng === location.lng &&
    Date.now() - cached.fetchedAt < WEATHER_CACHE_MS
  ) {
    console.log("[weather] serving cached weather");
    return { tempC: cached.tempC, label: cached.label, icon: cached.icon };
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lng}&current=temperature_2m,weather_code&temperature_unit=celsius`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Weather request failed with status ${response.status}`);
  }

  const data = await response.json();
  const current = data?.current;
  if (!current || typeof current.temperature_2m !== "number" || typeof current.weather_code !== "number") {
    throw new Error("Unexpected weather response shape");
  }

  const condition = WEATHER_CODE_MAP[current.weather_code] || { label: "Unknown", icon: "cloud" };
  const result = { tempC: current.temperature_2m, label: condition.label, icon: condition.icon };

  console.log("[weather] fetched:", result.label, result.tempC);
  await browser.storage.local.set({
    [WEATHER_CACHE_KEY]: { fetchedAt: Date.now(), lat: location.lat, lng: location.lng, ...result },
  });
  return result;
}

const CALDAV_ROOT = "https://caldav.icloud.com/";
const CALENDAR_DISCOVERY_CACHE_KEY = "calendarDiscoveryCache";
const CALENDAR_EVENTS_CACHE_KEY = "calendarEventsCache";
const CALENDAR_DISCOVERY_CACHE_MS = 24 * 60 * 60 * 1000;
const CALENDAR_EVENTS_CACHE_MS = 15 * 60 * 1000;
// Bump this whenever what gets merged into the cached event list changes
// (e.g. adding/removing a feed) so an in-flight cache from before the
// change doesn't get served as if it already reflects it.
const CALENDAR_CACHE_VERSION = 2;
const CALENDAR_LOOKAHEAD_DAYS = 7;
const CALENDAR_MAX_EVENTS = 20;
const CALDAV_NS = "DAV:";
const CALDAV_CAL_NS = "urn:ietf:params:xml:ns:caldav";

async function getCalendarCredentials() {
  const stored = (await browser.storage.local.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY] || {};
  const appleId = (stored.appleId || "").trim();
  const password = (stored.appSpecificPassword || "").trim();
  if (!appleId || !password) return null;
  return { appleId, password };
}

async function caldavRequest(method, url, credentials, { headers = {}, body } = {}) {
  console.log(`[calendar] ${method} ${url}`);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${credentials.appleId}:${credentials.password}`)}`,
        "Content-Type": "application/xml; charset=utf-8",
        ...headers,
      },
      body,
    });
  } catch (error) {
    console.error(`[calendar] ${method} ${url} threw before a response:`, error);
    throw error;
  }
  console.log(`[calendar] ${method} ${url} -> ${response.status}`);
  if (!response.ok) {
    const error = new Error(`CalDAV ${method} ${url} failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error(`CalDAV ${method} ${url} returned unparseable XML`);
  }
  return xml;
}

function findPropText(xmlDoc, tagNameNoNs) {
  const els = xmlDoc.getElementsByTagNameNS("*", tagNameNoNs);
  return els.length ? els[0].textContent.trim() : null;
}

// Finds the <href> nested INSIDE a specific property element (e.g.
// current-user-principal), not just the first <href> in the document —
// a multistatus response's outer <D:response> always has its own <href>
// (echoing the request URL) ahead of the property-specific one.
function findNestedHref(xmlDoc, propTagNoNs) {
  const propEls = xmlDoc.getElementsByTagNameNS("*", propTagNoNs);
  if (!propEls.length) return null;
  const hrefEls = propEls[0].getElementsByTagNameNS("*", "href");
  return hrefEls.length ? hrefEls[0].textContent.trim() : null;
}

function resolveHref(href, base) {
  if (!href) return null;
  return new URL(href, base).toString();
}

async function discoverPrincipalUrl(credentials) {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop><D:current-user-principal/></D:prop>
</D:propfind>`;
  const xml = await caldavRequest("PROPFIND", CALDAV_ROOT, credentials, { headers: { Depth: "0" }, body });
  const href = findNestedHref(xml, "current-user-principal");
  const url = resolveHref(href, CALDAV_ROOT);
  if (!url) throw new Error("Could not discover CalDAV principal URL");
  return url;
}

async function discoverCalendarHomeUrl(credentials, principalUrl) {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><C:calendar-home-set/></D:prop>
</D:propfind>`;
  const xml = await caldavRequest("PROPFIND", principalUrl, credentials, { headers: { Depth: "0" }, body });
  const href = findNestedHref(xml, "calendar-home-set");
  const url = resolveHref(href, principalUrl);
  if (!url) throw new Error("Could not discover CalDAV calendar home");
  return url;
}

async function discoverCalendars(credentials, calendarHomeUrl) {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:resourcetype/>
    <D:displayname/>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>`;
  const xml = await caldavRequest("PROPFIND", calendarHomeUrl, credentials, { headers: { Depth: "1" }, body });

  const responses = [...xml.getElementsByTagNameNS("*", "response")];
  const calendars = [];

  for (const responseEl of responses) {
    const href = findPropText(responseEl, "href");
    const url = resolveHref(href, calendarHomeUrl);
    if (!url || url === calendarHomeUrl) continue;
    if (/\/(inbox|outbox|notification)\/?$/.test(url)) continue;

    const resourcetypeEls = [...responseEl.getElementsByTagNameNS("*", "resourcetype")];
    const isCalendar = resourcetypeEls.some(
      (rt) => rt.getElementsByTagNameNS(CALDAV_CAL_NS, "calendar").length > 0
    );
    if (!isCalendar) continue;

    const supportedComponents = [...responseEl.getElementsByTagNameNS("*", "comp")].map((el) =>
      el.getAttribute("name")
    );
    if (supportedComponents.length && !supportedComponents.includes("VEVENT")) continue;

    calendars.push(url);
  }

  return calendars;
}

async function discoverCalendarSetup(credentials, { forceRefresh = false } = {}) {
  const cached = (await browser.storage.local.get(CALENDAR_DISCOVERY_CACHE_KEY))[CALENDAR_DISCOVERY_CACHE_KEY];
  if (
    !forceRefresh &&
    cached &&
    cached.appleId === credentials.appleId &&
    Date.now() - cached.discoveredAt < CALENDAR_DISCOVERY_CACHE_MS
  ) {
    return cached.calendars;
  }

  const principalUrl = await discoverPrincipalUrl(credentials);
  const calendarHomeUrl = await discoverCalendarHomeUrl(credentials, principalUrl);
  const calendars = await discoverCalendars(credentials, calendarHomeUrl);

  await browser.storage.local.set({
    [CALENDAR_DISCOVERY_CACHE_KEY]: { appleId: credentials.appleId, discoveredAt: Date.now(), calendars },
  });
  return calendars;
}

function formatCaldavDate(date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

async function fetchCalendarEvents(credentials, calendarUrl, rangeStart, rangeEnd) {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${formatCaldavDate(rangeStart)}" end="${formatCaldavDate(rangeEnd)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
  const xml = await caldavRequest("REPORT", calendarUrl, credentials, { headers: { Depth: "1" }, body });
  const dataEls = [...xml.getElementsByTagNameNS(CALDAV_CAL_NS, "calendar-data")];
  return dataEls.map((el) => el.textContent).join("\n");
}

function unfoldIcs(text) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function parseIcsDate(value, isAllDay) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (isAllDay || !h) {
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  if (z) {
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  }
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

function parseVEventBlock(block) {
  const lines = block.split(/\r\n|\n|\r/).filter((line) => line && !/^(BEGIN|END):/i.test(line));
  const event = {};
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const rawKey = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);
    const [key, ...params] = rawKey.split(";");
    const isAllDay = params.some((p) => p.toUpperCase() === "VALUE=DATE");

    if (key === "SUMMARY") event.summary = value;
    else if (key === "DTSTART") {
      event.start = parseIcsDate(value, isAllDay);
      event.allDay = isAllDay;
    } else if (key === "DTEND") {
      event.end = parseIcsDate(value, isAllDay);
    } else if (key === "UID") event.uid = value;
  }
  return event;
}

function extractEvents(icsText) {
  const unfolded = unfoldIcs(icsText);
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  return blocks
    .map(parseVEventBlock)
    .filter((event) => event.summary && event.start instanceof Date && !Number.isNaN(event.start.getTime()));
}

async function fetchAllCalendarEvents(credentials, calendars, rangeStart, rangeEnd) {
  const allEvents = [];
  for (const calendarUrl of calendars) {
    const icsText = await fetchCalendarEvents(credentials, calendarUrl, rangeStart, rangeEnd);
    allEvents.push(...extractEvents(icsText));
  }
  return allEvents;
}

// Public .ics feeds folded into the Apple calendar widget alongside the
// CalDAV events — fixture lists and a church rota, not tied to the Apple ID.
const EXTRA_CALENDAR_FEED_URLS = [
  "https://ics.fixtur.es/v2/ross-county.ics?90d022a450a049c8",
  "https://ics.ecal.com/ecal-sub/66d1d58368f1fc0008e4629d/English%20Premier%20League.ics",
  "https://smithton.churchsuite.com/my/ical/rotas/8381b30a4ada15ebf6016eb675d3252a",
  "https://ics.fixtur.es/v2/brentford-fc.ics?5b5429364fa6cb0c",
];

async function fetchExtraCalendarFeed(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Extra calendar feed request failed with status ${response.status} for ${url}`);
  }
  const text = await response.text();
  return extractEvents(text);
}

async function getExtraCalendarFeedEvents() {
  const results = await Promise.allSettled(EXTRA_CALENDAR_FEED_URLS.map(fetchExtraCalendarFeed));
  const events = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      console.log("[calendar] extra feed parsed:", EXTRA_CALENDAR_FEED_URLS[index], result.value.length, "events");
      events.push(...result.value);
    } else {
      console.error("[calendar] extra feed failed:", EXTRA_CALENDAR_FEED_URLS[index], result.reason);
    }
  });
  return events;
}

async function getUpcomingCalendarEvents() {
  const credentials = await getCalendarCredentials();
  if (!credentials) return null;

  const cached = (await browser.storage.local.get(CALENDAR_EVENTS_CACHE_KEY))[CALENDAR_EVENTS_CACHE_KEY];
  if (
    cached &&
    cached.version === CALENDAR_CACHE_VERSION &&
    cached.appleId === credentials.appleId &&
    Date.now() - cached.fetchedAt < CALENDAR_EVENTS_CACHE_MS
  ) {
    console.log("[calendar] serving cached events:", cached.events.length);
    return cached.events;
  }

  const rangeStart = new Date();
  const rangeEnd = new Date(rangeStart.getTime() + CALENDAR_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  let calendars = await discoverCalendarSetup(credentials);
  console.log("[calendar] discovered calendars:", calendars.length);

  let allEvents;
  try {
    allEvents = await fetchAllCalendarEvents(credentials, calendars, rangeStart, rangeEnd);
  } catch (error) {
    if (error.status !== 404) throw error;
    console.warn("[calendar] REPORT 404'd — discovery cache is stale, re-discovering calendars");
    calendars = await discoverCalendarSetup(credentials, { forceRefresh: true });
    console.log("[calendar] re-discovered calendars:", calendars.length);
    allEvents = await fetchAllCalendarEvents(credentials, calendars, rangeStart, rangeEnd);
  }

  const rawExtraEvents = await getExtraCalendarFeedEvents();
  const extraEvents = rawExtraEvents.filter((event) => event.start >= rangeStart && event.start <= rangeEnd);
  console.log(
    "[calendar] extra feed events in range:",
    extraEvents.length,
    "of",
    rawExtraEvents.length,
    "parsed; personal calendar events:",
    allEvents.length
  );
  allEvents.push(...extraEvents);

  const events = allEvents
    .sort((a, b) => a.start - b.start)
    .slice(0, CALENDAR_MAX_EVENTS)
    .map((event) => ({
      summary: event.summary,
      start: event.start.toISOString(),
      end: event.end instanceof Date ? event.end.toISOString() : null,
      allDay: !!event.allDay,
    }));

  console.log("[calendar] events after filtering:", events.length);
  await browser.storage.local.set({
    [CALENDAR_EVENTS_CACHE_KEY]: {
      version: CALENDAR_CACHE_VERSION,
      appleId: credentials.appleId,
      fetchedAt: Date.now(),
      events,
    },
  });
  return events;
}

const ICS_FEED_URL = "https://admin.dollopsicecream.co.uk/api/admin/ical?token=lDzWdnkupiLDYUUifZl7Luc3wygpundy";
const ICS_FEED_CACHE_KEY = "icsFeedCache";
const ICS_FEED_CACHE_MS = 15 * 60 * 1000;
const ICS_FEED_LOOKAHEAD_DAYS = 7;
const ICS_FEED_MAX_EVENTS = 8;

async function getIcsFeedEvents() {
  const cached = (await browser.storage.local.get(ICS_FEED_CACHE_KEY))[ICS_FEED_CACHE_KEY];
  if (cached && Date.now() - cached.fetchedAt < ICS_FEED_CACHE_MS) {
    console.log("[ics-feed] serving cached events:", cached.events.length);
    return cached.events;
  }

  console.log("[ics-feed] fetching", ICS_FEED_URL);
  const response = await fetch(ICS_FEED_URL);
  console.log("[ics-feed] response status:", response.status, response.ok);
  if (!response.ok) {
    throw new Error(`ICS feed request failed with status ${response.status}`);
  }

  const text = await response.text();
  const rangeStart = new Date();
  const rangeEnd = new Date(rangeStart.getTime() + ICS_FEED_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const events = extractEvents(text)
    .filter((event) => event.start >= rangeStart && event.start <= rangeEnd)
    .sort((a, b) => a.start - b.start)
    .slice(0, ICS_FEED_MAX_EVENTS)
    .map((event) => ({
      summary: event.summary,
      start: event.start.toISOString(),
      end: event.end instanceof Date ? event.end.toISOString() : null,
      allDay: !!event.allDay,
    }));

  console.log("[ics-feed] events after filtering:", events.length);
  await browser.storage.local.set({ [ICS_FEED_CACHE_KEY]: { fetchedAt: Date.now(), events } });
  return events;
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

  if (message?.type === "get-on-this-day") {
    return getOnThisDay().catch((error) => {
      console.error("[on-this-day] getOnThisDay failed:", error);
      throw error;
    });
  }

  if (message?.type === "get-calendar-events") {
    return getUpcomingCalendarEvents().catch((error) => {
      console.error("[calendar] getUpcomingCalendarEvents failed:", error);
      throw error;
    });
  }

  if (message?.type === "get-ics-feed-events") {
    return getIcsFeedEvents().catch((error) => {
      console.error("[ics-feed] getIcsFeedEvents failed:", error);
      throw error;
    });
  }

  if (message?.type === "get-quote-of-day") {
    return getQuoteOfTheDay().catch((error) => {
      console.error("[quote-of-day] getQuoteOfTheDay failed:", error);
      throw error;
    });
  }

  if (message?.type === "get-exchange-rates") {
    return getExchangeRates().catch((error) => {
      console.error("[exchange-rates] getExchangeRates failed:", error);
      throw error;
    });
  }

  if (message?.type === "get-sunrise-sunset") {
    return getSunriseSunset().catch((error) => {
      console.error("[sunrise-sunset] getSunriseSunset failed:", error);
      throw error;
    });
  }

  if (message?.type === "resolve-location") {
    return resolveLocation(message.query).catch((error) => {
      console.error("[location] resolveLocation failed:", error);
      throw error;
    });
  }

  if (message?.type === "get-weather") {
    return getWeather().catch((error) => {
      console.error("[weather] getWeather failed:", error);
      throw error;
    });
  }

  return undefined;
});
