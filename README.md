# Nightbot Song Request Queue Saver

Nightbot removes song requests from the queue once they have been played, so there is no lasting record of what was requested. This tool polls the Nightbot song-request queue every few seconds and appends every newly-seen song to a UTF-8 CSV file, giving you a permanent history.

## How it works

There are two modes. **API mode** (`login` + `watch`) is for the channel operator: it uses OAuth to read *your own* queue. **Scrape mode** (`scrape`) can be used by anyone to follow *any* publicly viewable queue — no account, no login, no credentials.

- `login` performs the OAuth2 authorization-code flow via a short-lived local web server and stores your tokens in `tokens.json`.
- `watch` polls `GET /1/song_requests/queue`, captures both the currently playing song and every queued item, and appends songs it has not seen before.
- `scrape <url>` watches any *publicly viewable* queue by its public URL (e.g. `https://nightbot.tv/t/<username>/song_requests`) — no login required. It reads the same public JSON the Nightbot website uses.
- Songs are de-duplicated by their track/video ID, so each song is stored once even if it is requested multiple times.

## Requirements

- Node.js 20 or newer.
- A Nightbot account and a registered Nightbot application (API mode only; scrape mode needs neither).

## Install (end users)

If you just want to run the tool, grab the packaged release instead of cloning:

1. Download `nightbot-queue-save-<version>.zip` from the [Releases page](https://github.com/elricco/nightbot-queue-save/releases/latest) and unzip it.
2. Open a terminal in the unzipped folder and install the runtime dependencies:

   ```bash
   npm install --omit=dev
   ```

3. To watch your own queue, follow steps 2–3 of **Setup** below, then run `npm run login` and `npm run watch`. To follow a public queue, skip straight to `npm run scrape <url>` — no setup or login needed.

## Setup (from source)

1. Install dependencies:

   ```bash
   npm install
   ```

   To run the tool only (no test tooling), a lean install is enough:

   ```bash
   npm install --omit=dev
   ```

2. Register an application at <https://nightbot.tv/account/applications> (API mode only):
   - Set the **Redirect URI** to `http://localhost:8080/callback` (must match `NIGHTBOT_REDIRECT_URI`).
   - Copy the **Client ID** and **Client Secret**.

3. Create your `.env` from the template and fill in the credentials:

   ```bash
   cp .env.example .env
   ```

   | Variable                       | Default                          | Description |
   |--------------------------------|----------------------------------|-------------|
   | `NIGHTBOT_CLIENT_ID`           | —                                | OAuth client ID (API mode). |
   | `NIGHTBOT_CLIENT_SECRET`       | —                                | OAuth client secret (API mode). |
   | `NIGHTBOT_REDIRECT_URI`        | `http://localhost:8080/callback` | Must match the app registration. |
   | `POLL_INTERVAL_SECONDS`        | `5`                              | Queue poll interval (API mode). |
   | `CSV_PATH`                     | `./song-requests.csv`            | Output CSV path (overrides the per-channel default in scrape mode). |
   | `PUBLIC_POLL_INTERVAL_SECONDS` | `10`                             | Queue poll interval (scrape mode). |

## Usage

1. Authorize once (opens your browser):

   ```bash
   npm run login
   ```

2. Start watching the queue:

   ```bash
   npm run watch
   ```

   Press `Ctrl-C` to stop. New songs are appended to the CSV as they appear.

### Watch a public queue (no login)

To follow someone else's publicly viewable queue, skip `login` and pass the public URL:

```bash
npm run scrape https://nightbot.tv/t/<username>/song_requests
```

Each channel is written to its own CSV (`./song-requests-<username>.csv` by default; `CSV_PATH` overrides). Press `Ctrl-C` to stop.

## Optional: YouTube playlist sync

Alongside the CSV, the tool can add every polled **YouTube** song to a playlist on your own YouTube account. It works in both `watch` and `scrape` mode. It is entirely optional: leave `YOUTUBE_PLAYLIST_ID` empty and nothing changes.

Setup (one-time):

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **YouTube Data API v3**.
2. Create an **OAuth client ID** (Desktop or Web) with the redirect URI `http://localhost:8080/callback`.
3. Put the client ID and secret into `.env` (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`).
4. Create a playlist in YouTube and set its ID as `YOUTUBE_PLAYLIST_ID`. YouTube has no "new empty playlist" button — you create a playlist by adding at least one video to it: open any video, click **Save**, choose **New playlist**, then name it and pick its visibility (public, unlisted, or private). It's a little annoying, but that's currently the only way; the seed video just stays in the playlist (harmless).
5. Find the playlist ID in the playlist's URL: it is the part right after `list=` and before the next `&`. The reliable way to get that URL is to right-click the playlist in your library and choose **Copy link** — if you just open a playlist that has only one video, the browser strips everything after the video ID from the address bar. A copied link looks like `https://www.youtube.com/watch?v=EXAMPLEvid1&list=PLexamplePlaylistId&pp=EXAMPLEppToken`, where the ID is `PLexamplePlaylistId`.
6. Run `npm run login:youtube` once to authorize (writes `youtube-tokens.json`).

Then `npm run watch` or `npm run scrape <url>` will append new YouTube songs to that playlist in addition to the CSV.

Notes: the playlist keeps whatever visibility you set on it — the tool never changes it. Non-YouTube requests (e.g. SoundCloud) are skipped. The YouTube Data API has a default quota of 10,000 units/day and each added song costs 50 units (~200 songs/day); if the quota is exhausted the playlist sync pauses for the rest of the run and prints a notice, while CSV logging continues.

## CSV format

UTF-8 with a BOM (so Excel shows accented characters correctly) and RFC-4180 quoting. Columns:

`track_id, title, url, requester, duration_seconds, provider, first_seen_at`

## Security

`.env`, `tokens.json`, and generated `*.csv` files are git-ignored. Never commit your client secret or tokens.

## Development

```bash
npm test        # run the unit tests
npm run typecheck
```

## Building a release

Create a zip containing only the files needed to install and run the tool (source, `package.json`, lockfile, `tsconfig.json`, `.env.example`, README — no tests, docs, or `node_modules`):

```bash
npm run release
```

The archive is written to `release/nightbot-queue-save-<version>.zip`. To use it, unzip, then inside the folder run `npm install --omit=dev` followed by `npm run login` and `npm run watch` (or `npm run scrape <url>`).
