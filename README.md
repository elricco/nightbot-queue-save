# Nightbot Song Request Queue Saver

Nightbot removes song requests from the queue once they have been played, so
there is no lasting record of what was requested. This tool polls the Nightbot
song-request queue every few seconds and appends every newly-seen song to a
UTF-8 CSV file, giving you a permanent history.

## How it works

- `login` performs the OAuth2 authorization-code flow via a short-lived local
  web server and stores your tokens in `tokens.json`.
- `watch` polls `GET /1/song_requests/queue`, captures both the currently
  playing song and every queued item, and appends songs it has not seen before.
- Songs are de-duplicated by their track/video ID, so each song is stored once
  even if it is requested multiple times.

## Requirements

- Node.js 20 or newer.
- A Nightbot account and a registered Nightbot application.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Register an application at <https://nightbot.tv/account/applications>:
   - Set the **Redirect URI** to `http://localhost:8080/callback`
     (must match `NIGHTBOT_REDIRECT_URI`).
   - Copy the **Client ID** and **Client Secret**.

3. Create your `.env` from the template and fill in the credentials:

   ```bash
   cp .env.example .env
   ```

   | Variable                 | Default                          | Description |
   |--------------------------|----------------------------------|-------------|
   | `NIGHTBOT_CLIENT_ID`     | —                                | OAuth client ID. |
   | `NIGHTBOT_CLIENT_SECRET` | —                                | OAuth client secret. |
   | `NIGHTBOT_REDIRECT_URI`  | `http://localhost:8080/callback` | Must match the app registration. |
   | `POLL_INTERVAL_SECONDS`  | `5`                              | Queue poll interval. |
   | `CSV_PATH`               | `./song-requests.csv`            | Output CSV path. |

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

## CSV format

UTF-8 with a BOM (so Excel shows accented characters correctly) and RFC-4180
quoting. Columns:

`track_id, title, url, requester, duration_seconds, provider, first_seen_at`

## Security

`.env`, `tokens.json`, and generated `*.csv` files are git-ignored. Never commit
your client secret or tokens.

## Development

```bash
npm test        # run the unit tests
npm run typecheck
```
