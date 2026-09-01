const STORAGE_KEY = "quickLinks";
const TILE_COLORS = ["#7c8cff", "#ff8a5c", "#4dd0a7", "#ff6b9d", "#ffc65c", "#5cc8ff"];

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

let links = [];
let editingId = null;

async function loadLinks() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  links = result[STORAGE_KEY] || [];
  render();
}

async function saveLinks() {
  await browser.storage.local.set({ [STORAGE_KEY]: links });
}

function colorFor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return TILE_COLORS[hash % TILE_COLORS.length];
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

    const icon = document.createElement("div");
    icon.className = "tile-icon";
    icon.style.background = link.color;
    icon.textContent = (link.title || link.url).trim().charAt(0).toUpperCase();

    const label = document.createElement("div");
    label.className = "tile-label";
    label.textContent = link.title;

    const editBtn = document.createElement("button");
    editBtn.className = "tile-edit";
    editBtn.type = "button";
    editBtn.textContent = "✎";
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
  addTile.textContent = "+";
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
    links.push({
      id: crypto.randomUUID(),
      title,
      url,
      color: colorFor(title || url),
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

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(query) ||
    (/^[^\s]+\.[^\s]{2,}$/i.test(query) && !query.includes(" "));

  if (looksLikeUrl) {
    window.location.href = normalizeUrl(query);
  } else {
    window.location.href = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
  }
});

loadLinks();
