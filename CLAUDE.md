# CLAUDE.md

Kontext und Konventionen für die Arbeit an diesem Repo.

## Zweck

Lokales CLI-Tool, das die Nightbot-Song-Request-Queue pollt und jeden neuen Song
in eine UTF-8-CSV (mit BOM) schreibt. Details im Design-Spec unter
`docs/superpowers/specs/2026-07-06-nightbot-queue-save-design.md`.

## Befehle

- `npm run login` — OAuth2-Login (lokaler Callback-Server), schreibt `tokens.json`.
- `npm run watch` — Polling-Schleife, hängt neue Songs an die CSV an.
- `npm test` — Vitest-Unit-Tests.
- `npm run typecheck` — `tsc --noEmit`.

## Architektur

- `src/config.ts` — `.env` laden/validieren, Defaults.
- `src/csv.ts` — RFC-4180 CSV (BOM), Dedup über `track_id` (Spalte 0).
- `src/nightbot.ts` — `extractSongs` (aus `_currentSong` + `queue`), `fetchQueue`.
- `src/auth.ts` — Authorize-URL, Token-Tausch/-Refresh, `tokens.json`, `login`.
- `src/watch.ts` — `collectNewSongs` (rein, testbar) + `watch`-Schleife.
- `src/index.ts` — CLI-Dispatch (`login` | `watch`).

## Konventionen

- ES-Module, TypeScript strict. Lokale Imports mit `.js`-Endung (NodeNext-Stil).
- Node built-in `fetch` — keine HTTP-Bibliothek.
- TDD: reine Logik (CSV, Extraktion, Token-Ablauf, URL-Bau) ist unit-getestet.
  OAuth-Callback-Server und Polling-Schleife werden manuell E2E verifiziert.
- Niemals `.env`, `tokens.json` oder CSVs committen (siehe `.gitignore`).

## Nightbot-API

- Queue: `GET /1/song_requests/queue` (Scope `song_requests_queue`).
- OAuth: `https://api.nightbot.tv/oauth2/authorize` und `/oauth2/token`.
- Access-Token 30 Tage, Refresh-Token 60 Tage; Auto-Refresh vor Ablauf.
