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
Mozilla's free **unlisted / self-distribution** signing via `web-ext`
(Mozilla's own CLI, already set up as a dev dependency in this repo —
`npm install` pulls it in; it's dev tooling only, the extension itself still
has no build step):

1. Get a free AMO API key/secret at
   https://addons.mozilla.org/developers/addon/api/key/ (requires a free
   Firefox account). Keep the secret private — treat it like a password.
2. Run the signing script from the repo root, with those two values as
   environment variables so they never appear in shell history or process
   listings:
   ```
   cd /home/user/tabdashboard
   npm install
   WEB_EXT_API_KEY=your-key WEB_EXT_API_SECRET=your-secret npm run sign
   ```
   This validates the extension, submits it for Mozilla's automated review,
   and — usually within a few minutes — downloads the signed `.xpi` into
   `web-ext-artifacts/` (gitignored).
3. Open the signed `.xpi` with Firefox (drag it into a Firefox window, or
   File → Open File). Firefox will prompt to install it permanently.
4. Future updates: bump `"version"` in `manifest.json`, then re-run the same
   `npm run sign` command — Firefox treats it as an update as long as
   `gecko.id` in `manifest.json` stays the same. A version that adds a new
   permission (like several added this session) will prompt you to accept
   it on update.

`npm run lint` runs `web-ext lint` on its own (no API key needed) if you
just want to validate the manifest/extension without signing.

Submitting for signing uploads the extension to Mozilla's servers — worth
knowing since `js/background.js` has a few feed URLs with access tokens
hardcoded in it (the Dollops Ice Cream feed, the Ross County/Brentford
fixture feeds, and the church rota feed). Your Apple ID and app-specific
password are never in the code — those only ever live in
`browser.storage.local`, entered via Settings.

## Download site (`download-site/`)

A small, self-contained static site with one page: a download button for
the current signed `.xpi`, plus install instructions. It's meant to be
deployed on Vercel with **Root Directory** set to `download-site/` in the
Vercel project settings (this repo has no top-level `vercel.json`, only
`download-site/vercel.json`, which just sets the right MIME type on the
`.xpi` so Firefox offers to install it directly instead of just saving the
file).

The download link always points at the same URL
(`latest/tabdashboard.xpi`) — only the file's *contents* change on each
release, so the page never needs hand-editing. After signing:

```
npm run publish-download
```

copies the newest file from `web-ext-artifacts/` into
`download-site/latest/tabdashboard.xpi` and writes
`download-site/latest/version.json` (version + timestamp, which the page
reads to show "Version X.X.X — updated …"). Commit and push
`download-site/` to deploy the new version — Vercel redeploys automatically
on push if the project is connected to this GitHub repo.

`npm run release` does the whole thing in one go: it interactively asks for
your AMO API key and secret (the secret is masked as you type, and neither
value is ever written to disk or the shell's history), signs, publishes,
then commits and pushes `download-site/` for you so Vercel redeploys. Just
run:

```
npm run release
```

and follow the prompts.

## Project layout

- `manifest.json` — extension manifest, overrides `chrome_url_overrides.newtab`
- `newtab.html` / `css/style.css` / `js/newtab.js` — the dashboard page
- `icons/icon.svg` — extension icon
- `download-site/` — separate static site for downloading the signed build
  (see above); not part of the extension itself

## Roadmap

- More widgets as they come up (weather is the current front-runner).
