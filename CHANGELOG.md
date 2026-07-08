# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-07-08

Adds an optional **YouTube playlist sync**: alongside the CSV, every polled YouTube song can be added to a playlist on your own YouTube account, in both `watch` and `scrape` mode. The CSV stays the source of truth — the sync is entirely optional and never interferes with CSV logging.

### Added

- **YouTube playlist sync** (opt-in via `YOUTUBE_PLAYLIST_ID`): newly-seen YouTube song requests are appended to a fixed playlist in your own account, in addition to the CSV. Works in both `watch` and `scrape` mode. Non-YouTube requests (e.g. SoundCloud) are skipped.
- **`npm run login:youtube`** — one-time Google OAuth2 authorization (offline access) that stores `youtube-tokens.json`; access tokens refresh automatically, preserving the long-lived refresh token that Google omits on refresh responses.
- **Playlist-side de-duplication** seeded from the playlist's actual contents at startup, independent of the CSV — enabling the feature later or restarting never re-adds songs already in the playlist.
- New `.env` settings: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `YOUTUBE_PLAYLIST_ID`.
- Shared OAuth callback server extracted into `oauth-callback.ts`, reused by both the Nightbot and YouTube logins (behaviour-preserving for the existing `npm run login`).

### Notes

- The YouTube Data API has a default quota of 10,000 units/day and each added song costs 50 units (~200 songs/day); if the quota is exhausted the sync pauses for the rest of the run with a notice, while CSV logging continues.
- The playlist keeps whatever visibility (public/unlisted/private) you set on it — the tool never changes it. A partial or missing YouTube configuration degrades to CSV-only with a warning, never aborting the run.

### Security

- `youtube-tokens.json` is git-ignored and written with `0600` permissions; OAuth client secrets and tokens are never logged.

## [0.2.0] — 2026-07-08

Adds a second, credential-free way to capture a queue. **API mode** (`watch`) is for the channel operator reading their own queue via OAuth; the new **scrape mode** can be used by anyone to follow any publicly viewable queue by its URL.

### Added

- **Scrape mode** (`npm run scrape <url>`) watches any publicly viewable Nightbot queue by its public URL (e.g. `https://nightbot.tv/t/<username>/song_requests`) — no OAuth, no login, no credentials. It resolves the channel via the public `GET /1/channels/{provider}/{username}` endpoint and reads the same public queue JSON the Nightbot website uses (`Nightbot-Channel` header).
- **Per-channel CSV** by default in scrape mode (`./song-requests-<username>.csv`), so following multiple channels never mixes their songs; `CSV_PATH` still overrides.
- Separate **`PUBLIC_POLL_INTERVAL_SECONDS`** (default 10s) for scrape mode, kept politely higher than the API mode's 5s against the unauthenticated endpoint.
- Shared `runWatchLoop` powering both modes, so dedup, CSV append, SIGINT handling, and 429 backoff behave identically in API and scrape mode.

### Fixed

- An empty `CSV_PATH=` in `.env` is now treated as unset and falls back to the default path, instead of producing an empty path (`ENOENT ... open ''`).

## [0.1.0] — 2026-07-07

Initial release. A local CLI that polls your Nightbot song-request queue and appends every newly-seen song to a UTF-8 CSV, preserving a permanent history even after songs have played and left the queue.

### Added

- **OAuth2 login** (`npm run login`) via a short-lived local callback server; tokens are stored in `tokens.json`, with `state` validation on the callback.
- **Watch loop** (`npm run watch`) that polls `GET /1/song_requests/queue` on a configurable interval (`POLL_INTERVAL_SECONDS`, default 5s).
- Captures **both** the currently playing song (`_currentSong`) and every queued item, so songs are recorded before they disappear after playing.
- **De-duplication** by track/video ID — each song is stored once, even if requested multiple times; known IDs are seeded from the existing CSV on start.
- **UTF-8 CSV with BOM** (Excel-friendly) and RFC-4180 quoting. Columns: `track_id, title, url, requester, duration_seconds, provider, first_seen_at`.
- **Automatic token refresh** before expiry, with a clear "run `npm run login` again" message when the refresh token has expired.
- **Resilient polling**: network/server errors are logged and the loop continues; HTTP 429 triggers exponential backoff (30s → 300s cap).
- Configuration via `.env` (`NIGHTBOT_CLIENT_ID`, `NIGHTBOT_CLIENT_SECRET`, `NIGHTBOT_REDIRECT_URI`, `POLL_INTERVAL_SECONDS`, `CSV_PATH`).
- `npm run release` builds a distributable zip containing only the files needed to install and run the tool.

### Security

- No runtime vulnerabilities (`npm audit` is clean).
- `.env`, `tokens.json`, and generated `*.csv` files are git-ignored and never committed. The token file is written with `0600` permissions.

[0.3.0]: https://github.com/elricco/nightbot-queue-save/releases/tag/v0.3.0
[0.2.0]: https://github.com/elricco/nightbot-queue-save/releases/tag/v0.2.0
[0.1.0]: https://github.com/elricco/nightbot-queue-save/releases/tag/v0.1.0
