# Custom New Tab Dashboard

A personal Firefox New Tab replacement: a search bar with live suggestions,
a world clock, an "on this day" history fact, and a live BBC News/Sport
ticker, with settings stored locally via `browser.storage.local`. Plain
HTML/CSS/JS, no build step. External requests: the chosen search engine's
suggestion API as you type (DuckDuckGo, Google, Bing, or Ecosia — whichever
is selected in Settings), BBC's public RSS feeds for the news ticker (cached
~15 minutes), and Wikipedia's public "on this day" API (cached per calendar
day).

## Try it out (temporary install)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` from this folder.
4. Open a new tab to see it.

This is reloaded fresh (and un-installed) whenever Firefox restarts, so it's
good for iterating but not for daily use.

## Install permanently

Firefox only keeps non-temporary extensions installed if they're signed by
Mozilla. For a personal extension you don't want listed publicly, use
Mozilla's free **unlisted / self-distribution** signing:

1. Zip the extension contents (not the folder itself):
   ```
   cd /home/user/tabdashboard
   zip -r -FS ../tabdashboard.xpi * -x '*.git*'
   ```
2. Go to https://addons.mozilla.org/developers/addon/submit/distribution
   (requires a free Firefox account) and choose **"On your own"** (unlisted).
3. Upload `tabdashboard.xpi`. Mozilla runs an automated validation and signs
   it — usually within a few minutes.
4. Download the signed `.xpi` from the submission page and open it with
   Firefox (drag it into a Firefox window, or File → Open File). Firefox will
   prompt to install it permanently.
5. Future updates: bump `"version"` in `manifest.json`, re-zip, and re-submit
   through the same listing page — Firefox will treat it as an update if the
   `gecko.id` in `manifest.json` stays the same. A version that adds a new
   `host_permissions` entry (like the BBC feed access added for the news
   ticker) will prompt you to accept the new permission on update.

Alternatively, `web-ext` (Mozilla's CLI, `npm install -g web-ext`) can drive
steps 1–4 for you: `web-ext sign --api-key=... --api-secret=...` using an API
key from https://addons.mozilla.org/developers/addon/api/key/.

## Project layout

- `manifest.json` — extension manifest, overrides `chrome_url_overrides.newtab`
- `newtab.html` / `css/style.css` / `js/newtab.js` — the dashboard page
- `icons/icon.svg` — extension icon

## Roadmap

- Sync quick links across devices via a small Supabase backend (deferred
  until the widget set is finalized).
- Additional widgets (weather, clock, notes, etc.) once decided.
