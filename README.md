# Custom New Tab Dashboard

A personal Firefox New Tab replacement: a search bar with live suggestions,
a world clock, an "on this day" history fact, an iCloud calendar widget, and
a live BBC News/Sport ticker, with settings stored locally via
`browser.storage.local`. Plain HTML/CSS/JS, no build step. External
requests: the chosen search engine's suggestion API as you type (DuckDuckGo,
Google, Bing, or Ecosia — whichever is selected in Settings), BBC's public
RSS feeds for the news ticker (cached ~15 minutes), Wikipedia's public "on
this day" API (cached per calendar day), and — only if you've entered
credentials in Settings — Apple's iCloud CalDAV server for the calendar
widget (cached ~15 minutes).

### iCloud calendar setup

The calendar widget reads your iCloud calendar via CalDAV. To use it:

1. Go to https://appleid.apple.com, sign in, and generate an **app-specific
   password** (Sign-In and Security → App-Specific Passwords). Do not use
   your real Apple ID password.
2. Open the dashboard's Settings (gear icon, top right) and enter your Apple
   ID email and that app-specific password.

That password is stored as plain text in `browser.storage.local` — fine for
a personal, locally-installed extension, but worth knowing since it isn't
encrypted at rest. It's sent only to `caldav.icloud.com`, over HTTPS, via
the background script.

CalDAV uses non-standard HTTP methods (`PROPFIND`, `REPORT`) that trigger a
browser CORS preflight regardless of the extension's host permissions, and
iCloud's CalDAV server — built for desktop calendar apps, not browsers —
doesn't send the `Access-Control-*` headers a preflight needs. The
extension works around this with a `webRequest` listener (`webRequest` +
`webRequestBlocking` permissions) that adds those headers onto responses
from `caldav.icloud.com` only — the same technique standalone "CORS
unblock" extensions use, just scoped to this one host instead of every
site.

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

- More widgets as they come up (weather is the current front-runner).
