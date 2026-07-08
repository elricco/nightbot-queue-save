# CLAUDE.md

Kontext und Konventionen für die Arbeit an diesem Repo.

## Zweck

Lokales CLI-Tool, das die Nightbot-Song-Request-Queue pollt und jeden neuen Song
in eine UTF-8-CSV (mit BOM) schreibt. Details im Design-Spec unter
`docs/superpowers/specs/2026-07-06-nightbot-queue-save-design.md`.

## Befehle

- `npm run login` — OAuth2-Login (lokaler Callback-Server), schreibt `tokens.json`.
- `npm run watch` — Polling-Schleife, hängt neue Songs an die CSV an.
- `npm run scrape <url>` — Public-Mode: pollt eine öffentlich einsehbare Queue über ihre URL, ohne OAuth. Schreibt pro Channel eine eigene CSV.
- `npm test` — Vitest-Unit-Tests.
- `npm run typecheck` — `tsc --noEmit`.

## Architektur

- `src/config.ts` — `.env` laden/validieren, Defaults.
- `src/csv.ts` — RFC-4180 CSV (BOM), Dedup über `track_id` (Spalte 0).
- `src/nightbot.ts` — `extractSongs` (aus `_currentSong` + `queue`), `fetchQueue`.
- `src/auth.ts` — Authorize-URL, Token-Tausch/-Refresh, `tokens.json`, `login`.
- `src/public.ts` — `parsePublicUrl`, `resolveChannelId`, `fetchPublicQueue`
  (öffentliche Endpunkte, Header `Nightbot-Channel`).
- `src/watch.ts` — `collectNewSongs` (rein, testbar), `runWatchLoop` (geteilte
  Schleife) + `watch` (API) / `scrape` (Public).
- `src/index.ts` — CLI-Dispatch (`login` | `watch` | `scrape`).

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

## Releasing

SemVer, Tags im Format `vX.Y.Z`. Die Release-Zip enthält nur Betriebs-Dateien
(`src/`, `package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`,
`README.md`) — gebaut über `scripts/make-release.sh`; `release/` ist gitignored.
`tsx` ist eine Runtime-`dependency` (Betrieb via `npm install --omit=dev`).

Schritte für eine neue Version:

1. `version` in `package.json` anheben (SemVer).
2. `CHANGELOG.md` um einen Abschnitt `## [X.Y.Z] — YYYY-MM-DD` ergänzen und den
   Link-Verweis am Ende der Datei setzen.
3. `npm run typecheck && npm test` — muss grün sein.
4. `npm run release` — erzeugt `release/nightbot-queue-save-X.Y.Z.zip`.
   Optional verifizieren: entpacken, `npm ci --omit=dev`, `npm run start -- bogus`.
5. Commit + Push der Doku-/Versionsänderungen.
6. `git tag -a vX.Y.Z -m "vX.Y.Z — <Titel>"` und `git push origin vX.Y.Z`.
7. `gh release create vX.Y.Z --title "…" --notes-file <notes> release/…zip`.

Release-Notes/README sind bewusst auf Englisch (public-facing).
