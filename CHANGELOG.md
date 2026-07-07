# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-07

Initial release. A local CLI that polls your Nightbot song-request queue and
appends every newly-seen song to a UTF-8 CSV, preserving a permanent history
even after songs have played and left the queue.

### Added

- **OAuth2 login** (`npm run login`) via a short-lived local callback server;
  tokens are stored in `tokens.json`, with `state` validation on the callback.
- **Watch loop** (`npm run watch`) that polls `GET /1/song_requests/queue` on a
  configurable interval (`POLL_INTERVAL_SECONDS`, default 5s).
- Captures **both** the currently playing song (`_currentSong`) and every queued
  item, so songs are recorded before they disappear after playing.
- **De-duplication** by track/video ID — each song is stored once, even if
  requested multiple times; known IDs are seeded from the existing CSV on start.
- **UTF-8 CSV with BOM** (Excel-friendly) and RFC-4180 quoting. Columns:
  `track_id, title, url, requester, duration_seconds, provider, first_seen_at`.
- **Automatic token refresh** before expiry, with a clear "run `npm run login`
  again" message when the refresh token has expired.
- **Resilient polling**: network/server errors are logged and the loop
  continues; HTTP 429 triggers exponential backoff (30s → 300s cap).
- Configuration via `.env` (`NIGHTBOT_CLIENT_ID`, `NIGHTBOT_CLIENT_SECRET`,
  `NIGHTBOT_REDIRECT_URI`, `POLL_INTERVAL_SECONDS`, `CSV_PATH`).
- `npm run release` builds a distributable zip containing only the files needed
  to install and run the tool.

### Security

- No runtime vulnerabilities (`npm audit` is clean).
- `.env`, `tokens.json`, and generated `*.csv` files are git-ignored and never
  committed. The token file is written with `0600` permissions.

[0.1.0]: https://github.com/elricco/nightbot-queue-save/releases/tag/v0.1.0
