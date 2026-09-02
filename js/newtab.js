const STORAGE_KEY = "quickLinks";
const SETTINGS_KEY = "settings";
const USER_NAME = "Ross";

const SEARCH_ENGINES = {
  duckduckgo: { label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  google: { label: "Google", url: "https://www.google.com/search?q=" },
  bing: { label: "Bing", url: "https://www.bing.com/search?q=" },
  ecosia: { label: "Ecosia", url: "https://www.ecosia.org/search?q=" },
};
const DEFAULT_SETTINGS = { searchEngine: "duckduckgo" };

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

function render() {
  linksGrid.innerHTML = "";

  for (const link of links) {
    const tile = document.createElement("a");
    tile.className = "link-tile";
    tile.href = link.url;

    const palette = link.colorBg ? { bg: link.colorBg, text: link.colorText } : paletteFor(link.title || link.url);

    const icon = document.createElement("div");
    icon.className = "tile-icon";
    icon.style.background = palette.bg;
    icon.style.color = palette.text;
    icon.textContent = (link.title || link.url).trim().charAt(0).toUpperCase();

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

renderGreeting();
renderClocks();
setInterval(renderClocks, 30_000);
loadSettings();
loadLinks();
