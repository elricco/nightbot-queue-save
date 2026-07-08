# YouTube-Playlist-Sync — Design-Spec

**Datum:** 2026-07-08
**Status:** Entwurf (zur Umsetzung freigegeben nach Review)

## Zweck

Zusätzlich zur CSV sollen gepollte **YouTube-Songs** in eine YouTube-Playlist im
eigenen Konto eingefügt werden. Das Feature ist rein optional und additiv: Die
CSV bleibt in jedem Fall die „source of truth"; die Playlist ist ein Nebenprodukt.
Ist das Feature nicht konfiguriert, verhält sich das Tool exakt wie bisher.

Gilt für **beide Modi** (`watch` und `scrape`). Die Playlist liegt immer im
YouTube-Konto des Betreibers — unabhängig davon, wessen Queue gepollt wird.

## Grundprinzipien

- **Optional & additiv.** Leeres `YOUTUBE_PLAYLIST_ID` → keine Verhaltensänderung
  (nur CSV). Kein Zwang, YouTube einzurichten.
- **Nur YouTube-Songs.** Für jeden gepollten `Song` mit `provider === "youtube"`
  ist `trackId` bereits die 11-stellige Video-ID — genau der Wert, den
  `playlistItems.insert` erwartet. Andere Provider werden still übersprungen.
- **Sichtbarkeit** (öffentlich/privat/unlisted) ist die der vom Nutzer vorab
  angelegten Playlist. Das Tool legt keine Playlist an und ändert die
  Sichtbarkeit nicht.
- **Feste Playlist.** Die Ziel-Playlist wird per `YOUTUBE_PLAYLIST_ID` in `.env`
  vorgegeben; kein Auto-Anlegen, keine Datumslisten.

## Voraussetzungen (einmalig, manuell durch den Nutzer)

1. Google-Cloud-Projekt anlegen, **YouTube Data API v3** aktivieren.
2. OAuth-Client-ID erstellen (Typ Desktop oder Web), Redirect-URI
   `http://localhost:8080/callback` registrieren.
3. Client-ID und -Secret in `.env` eintragen.
4. Playlist in YouTube anlegen (mit gewünschter Sichtbarkeit), ihre ID kopieren
   und als `YOUTUBE_PLAYLIST_ID` eintragen.

Es gibt keinen API-Weg ohne eigene App-Registrierung — das ist eine Google-
Vorgabe, keine Design-Entscheidung.

## Konfiguration (`.env`)

```
# --- YouTube-Playlist-Sync (optional) ---
# OAuth-Client aus einem Google-Cloud-Projekt mit aktivierter YouTube Data API v3.
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=http://localhost:8080/callback
# ID einer bereits in YouTube angelegten Playlist. Leer = Feature aus.
YOUTUBE_PLAYLIST_ID=
```

Das Feature ist genau dann aktiv, wenn `YOUTUBE_PLAYLIST_ID` gesetzt ist. Fehlt
dann `youtube-tokens.json`, gibt das Tool einen Hinweis aus
(„bitte `npm run login:youtube`") und läuft CSV-only weiter (nicht fatal).

## Architektur

Neue Module (je eine klar umrissene Aufgabe, passend zu den bestehenden
Konventionen):

- **`src/youtube-auth.ts`** — Google-OAuth2, eigener Flow, eigene
  `youtube-tokens.json`. Unterschiede zu Nightbots `auth.ts`:
  - Authorize-Endpunkt `https://accounts.google.com/o/oauth2/v2/auth`,
    Token-Endpunkt `https://oauth2.googleapis.com/token`.
  - Authorize-Parameter `access_type=offline` und `prompt=consent`, damit ein
    Refresh-Token ausgegeben wird.
  - **Refresh-Antworten enthalten kein neues `refresh_token`** → das bestehende
    Refresh-Token muss beim Schreiben der aktualisierten Tokens erhalten bleiben.
  - Scope: `https://www.googleapis.com/auth/youtube`.
  - Wiederverwendet den lokalen Callback-Server-Ansatz aus `auth.ts`
    (gleicher Port 8080, Läufe überschneiden sich nicht).
- **`src/youtube.ts`** — dünner API-Wrapper über `fetch`:
  - `listPlaylistVideoIds(accessToken, playlistId): Promise<string[]>` —
    paginiert über `playlistItems.list` (`part=contentDetails`, `maxResults=50`)
    und sammelt alle `contentDetails.videoId`.
  - `insertPlaylistItem(accessToken, playlistId, videoId): Promise<void>` —
    `playlistItems.insert` (`part=snippet`).
  - Erkennt `403 quotaExceeded`/`rateLimitExceeded` und wirft einen typisierten
    Quota-Fehler, den der Sink erkennt.
- **`src/youtube-sync.ts`** — die eigentliche Sync-Logik (Sink), testbar von der
  I/O getrennt gehalten:
  - Hält ein „bereits in der Playlist"-Set von Video-IDs.
  - `seed(...)`: einmal beim Start die vorhandenen Video-IDs laden.
  - `push(songs)`: aus der Liste alle `provider === "youtube"`-Songs
    herausfiltern, deren Video-ID noch nicht im Set ist, und einfügen.

Integration in `src/watch.ts`:

- `runWatchLoop` erhält einen optionalen **Sink** `{ push(songs: Song[]) }`.
  Nach dem Extrahieren pro Poll wird `push` mit **allen** extrahierten Songs des
  aktuellen Polls aufgerufen (nicht nur den CSV-Neuzugängen) — so ist die
  Playlist-Dedup vollständig von der CSV-Dedup entkoppelt.
- `watch`/`scrape` bauen den Sink nur, wenn das Feature aktiv ist, seedn ihn und
  reichen ihn an `runWatchLoop` durch. Ohne Feature bleibt der Sink `undefined`
  und der Loop ist unverändert.

`src/index.ts`: neuer Dispatch-Zweig `login:youtube`.

## Datenfluss (pro Poll, Feature aktiv)

1. `fetchOnce()` liefert die rohe Queue.
2. `extractSongs` → vollständige Song-Liste des Polls.
3. CSV-Pfad wie bisher: `collectNewSongs` → nur Neuzugänge → `appendSong`.
4. Playlist-Pfad: `sink.push(alleSongs)` → filtert YouTube-Songs, deren Video-ID
   noch nicht im „bereits drin"-Set ist → `insertPlaylistItem` → ID ins Set.

## Dedup-Strategie

Beim Start lädt der Sink einmal die vorhandenen Video-IDs der Playlist
(`listPlaylistVideoIds`, ~1 Quota-Einheit pro 50 Einträge — vernachlässigbar) und
führt sie als „bereits drin"-Set. Der Abgleich ist damit **unabhängig von der
CSV**: Wer das Feature später aktiviert (CSV bereits gefüllt) oder nach einem
Fehlversuch neu startet, bekommt fehlende Songs korrekt nachgetragen, ohne
Duplikate. Stateless — kein zusätzliches State-File.

## Fehler- und Quota-Handling

Die CSV läuft in allen Fällen ungestört weiter.

- **Quota-Kontext:** Standard-Kontingent 10.000 Einheiten/Tag;
  `playlistItems.insert` kostet 50 Einheiten → ca. **200 hinzugefügte Songs/Tag**.
- **`403 quotaExceeded` / `rateLimitExceeded`:** Playlist-Sync für den restlichen
  Run **pausieren** (interner Flag; keine weiteren Insert-Versuche) und einen
  deutlichen **CLI-Hinweis** ausgeben (z. B. „YouTube-Quota erschöpft — Playlist-
  Sync für diesen Run pausiert; CSV läuft weiter.").
- **Transiente Fehler** (Netz, 5xx): loggen; Video-ID kommt **nicht** ins Set →
  der nächste Poll versucht es erneut.
- **Auth-Fehler:** Refresh versuchen (mit Erhalt des alten Refresh-Tokens);
  scheitert der Refresh, Hinweis „bitte `npm run login:youtube`" ausgeben und den
  Playlist-Sync für den Run pausieren — der Watch-Loop (CSV) läuft weiter.
- **Fehlende `youtube-tokens.json` bei gesetzter `YOUTUBE_PLAYLIST_ID`:** einmaliger
  Hinweis beim Start, CSV-only weiter.

## Testing (TDD, reine Logik)

Unit-Tests für die von I/O getrennte Logik:

- **`youtube-auth`**: Authorize-URL-Bau (`access_type=offline`, `prompt=consent`,
  Scope, `state`); Token-Ablauf/`needsRefresh`; Refresh bewahrt das alte
  Refresh-Token, wenn die Antwort keins liefert.
- **`youtube` (API-Parsing)**: `listPlaylistVideoIds` aggregiert über
  paginierte Antworten korrekt; Quota-Fehler wird als typisierter Fehler erkannt.
- **`youtube-sync`**: `push` fügt nur unbekannte YouTube-Video-IDs ein und
  überspringt Nicht-YouTube-Provider und bereits bekannte IDs; nach
  Quota-Fehler werden keine weiteren Inserts versucht (pausiert).

Der OAuth-Callback-Server und die reale Playlist-Integration werden — wie der
bestehende Login-Flow — manuell E2E verifiziert.

## Dokumentation

- `.env.example` um den YouTube-Abschnitt ergänzen.
- `README.md`: kurzer Abschnitt „Optional: YouTube playlist sync" (englisch,
  public-facing) mit Setup-Schritten (Cloud-Projekt, `login:youtube`,
  `YOUTUBE_PLAYLIST_ID`) und Quota-Hinweis.
- `package.json`: Skript `login:youtube`.
- `.gitignore`: `youtube-tokens.json` (analog zu `tokens.json`).

## Bewusst nicht enthalten (YAGNI)

- Kein Auto-Anlegen von Playlists, keine Datums-/Pro-Run-Listen.
- Keine Pro-Channel-Playlists im Scrape-Mode (eine feste Playlist genügt).
- Kein Entfernen/Reordering von Playlist-Einträgen.
- Keine anderen Provider (nur YouTube).
