# Custom New Tab Dashboard

A personal Firefox New Tab replacement: a search bar with live suggestions,
a world clock, an "on this day" history fact (with a GBP exchange rate and
quote-of-the-day widget, plus a sunrise/sunset card that alternates with
current weather, underneath), a calendar widget (iCloud plus a second
subscribed ICS feed), and a live BBC News/Sport ticker, with settings
stored locally via `browser.storage.local`. Plain HTML/CSS/JS, no build
step. External requests: the chosen search engine's suggestion API as you
type (DuckDuckGo, Google, Bing, or Ecosia — whichever is selected in
Settings), BBC's public RSS feeds for the news ticker (cached ~15 minutes),
Wikipedia's public "on this day" API (cached per calendar day), Apple's
iCloud CalDAV server for the calendar widget (cached ~15 minutes, only if
you've entered credentials in Settings), a hardcoded `.ics` subscription
feed shown directly beneath it (cached ~15 minutes), Frankfurter's free
exchange-rate API (`api.frankfurter.app`, ECB rates) for the GBP rate
ticker, DummyJSON (`dummyjson.com/quotes/random`) for quote-of-the-day,
sunrise-sunset.org for the sunrise/sunset times (cached per calendar day),
Open-Meteo's free forecast API (`api.open-meteo.com`) for current weather
(cached ~20 minutes), and Open-Meteo's free geocoding API
(`geocoding-api.open-meteo.com`) to resolve the location you type into
Settings into coordinates + timezone (only called when you change it, then
cached).

### Name and location

Settings (gear icon) lets you set your name (used in the "Good morning, …"
greeting) and a location — type any city name. It's resolved to coordinates
and a timezone via Open-Meteo's geocoding API when you hit Save, and used
for both the main clock (city label + timezone) and the sunrise/sunset
widget. If the city can't be found, Settings shows an error and won't save
until you fix it or clear the field back to the default (Inverness).

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
from any `icloud.com` host only — the same technique standalone "CORS
unblock" extensions use, just scoped to this one host instead of every
site.

### Extra fixture/rota feeds (folded into the Apple calendar)

Four more public `.ics` feeds — Ross County FC, the Premier League, a
church rota, and Brentford FC — are fetched and merged directly into the
Apple calendar widget's event list (sorted together with the CalDAV
events), rather than shown as their own section. They only appear once an
Apple ID is configured, since the whole widget is gated on that. Their
URLs are hardcoded in `js/background.js` alongside the second calendar's
feed below.

### Second calendar (ICS feed)

A second calendar — a `webcal://` subscription link — is fetched and shown
directly beneath the iCloud one, in the same plain style with no heading of
its own. The feed URL (which includes an access token) is hardcoded in
`js/background.js`, same as the extra fixture/rota feeds above; since that
file is committed to this repo, treat the repo itself as sensitive if it
ever needs to be shared or made public. Unlike the iCloud calendar, these
are plain `.ics` files over a normal GET request, so they didn't need the
CORS workaround above — just a host permission per domain.

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
