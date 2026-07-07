# Public Mode (`npm run scrape <url>`) — Design

Datum: 2026-07-07
Status: Entwurf (zur Umsetzung freigegeben)

## Zweck

Ein zweiter Betriebsmodus, der eine **öffentlich einsehbare** Nightbot-Song-Request-Queue
anhand ihrer öffentlichen URL (z. B. `https://nightbot.tv/t/elricco1978/song_requests`)
beobachtet und — genau wie der bestehende API-Mode — jeden neuen Song in eine CSV schreibt.
Ohne OAuth-Login, für beliebige fremde Channels.

## Zentrale Erkenntnis: kein Scraping

Die öffentliche Nightbot-Seite ist eine React-SPA; statisches HTML-Parsen ist nicht möglich.
Die SPA bezieht ihre Daten jedoch über **zwei öffentliche, auth-freie** JSON-Endpunkte
(verifiziert am 2026-07-07):

1. `GET /1/channels/{provider}/{username}` → liefert u. a. `channel._id`.
   Beispiel: `.../channels/t/elricco1978` → `_id: "66261213709e0dbaf5c96f9d"`.
   Der Provider-Kurzcode `t` (aus der URL `/t/...`) wird von der API akzeptiert und
   muss **nicht** zu `twitch` expandiert werden.
2. `GET /1/song_requests/queue` mit HTTP-Header `Nightbot-Channel: <channel._id>`
   → liefert **exakt dieselbe** `{ _currentSong, queue }`-Struktur wie der authentifizierte
   Queue-Endpunkt im API-Mode.

Der Unterschied zum API-Mode ist damit ausschließlich die *Herkunft* der Queue-Daten
(Header statt Bearer-Token) und der Wegfall der OAuth-Credentials. Die bestehende
Extraktion ([`extractSongs`](../../../src/nightbot.ts)), CSV-Serialisierung, Dedup und
Watch-Mechanik werden **unverändert** wiederverwendet.

## Architektur

### Refactor: geteilte Watch-Schleife

Die aktuelle [`watch()`](../../../src/watch.ts) vermischt die Polling-Mechanik (Backoff,
SIGINT-Handling, Dedup, CSV-Append, Logging) mit der API-spezifischen Datenbeschaffung
(`getValidAccessToken` + `fetchQueue`). Diese beiden Aspekte werden getrennt:

- Neue Funktion `runWatchLoop(config, fetchOnce)` enthält die gesamte generische Mechanik.
  Parameter `fetchOnce: () => Promise<RawQueue>` liefert bei jedem Poll die Rohdaten.
- `watch(config)` (API-Mode) ruft `runWatchLoop` mit
  `fetchOnce = async () => fetchQueue(await getValidAccessToken(config), config.apiBaseUrl)`.
- `scrape(config, channelId)` (Public-Mode) ruft `runWatchLoop` mit
  `fetchOnce = () => fetchPublicQueue(channelId, config.apiBaseUrl)`.

`AuthError` ist nur im API-Mode relevant; im Public-Mode kann diese Fehlerklasse nicht
auftreten. Das 429-Backoff und das SIGINT-Stopping gelten für beide Modi unverändert.

### Neues Modul `src/public.ts`

- `parsePublicUrl(input: string): { provider: string; username: string }` — **rein/testbar**.
  Akzeptiert:
  - die volle Browser-URL: `https://nightbot.tv/t/elricco1978/song_requests`
  - kulant auch die Kurzform: `t/elricco1978`
  Extrahiert die beiden Pfadsegmente nach dem Host bzw. vor `/song_requests`. Wirft bei
  unbrauchbarer Eingabe einen aussagekräftigen Fehler (fehlendes/leeres Segment).
  Der Provider wird **nicht** normalisiert (`t` bleibt `t`).
- `resolveChannelId(provider, username, apiBaseUrl): Promise<string>` —
  `GET {apiBaseUrl}/1/channels/{provider}/{username}`, gibt `channel._id` zurück.
  Bei 404/unbekanntem Channel: klare Fehlermeldung („Channel nicht gefunden: …").
- `fetchPublicQueue(channelId, apiBaseUrl): Promise<RawQueue>` —
  `GET {apiBaseUrl}/1/song_requests/queue` mit Header `Nightbot-Channel: <channelId>`.
  429- und `!ok`-Handling analog zu [`fetchQueue`](../../../src/nightbot.ts).
  `RawQueue` wird aus `nightbot.ts` exportiert und wiederverwendet.

### Config

Der Public-Mode darf `NIGHTBOT_CLIENT_ID`/`NIGHTBOT_CLIENT_SECRET` **nicht** erzwingen.
Der Loader wird geteilt:

- `loadConfig()` — unverändert (voll, für `login`/`watch`).
- `loadPublicConfig()` — schlank, ohne OAuth-Felder. Enthält:
  - `apiBaseUrl` (`https://api.nightbot.tv`)
  - `pollIntervalSeconds` — aus **eigener** Env-Variable `PUBLIC_POLL_INTERVAL_SECONDS`,
    Default **10** (höflicher gegenüber dem unauthentifizierten öffentlichen Endpunkt als
    die 5s des API-Mode). Gleiche Validierung (positive endliche Zahl).
  - `csvPath` — siehe unten.

Um die geteilte Schleife und `fetchPublicQueue` mit einem einheitlichen Config-Objekt zu
versorgen, kann `runWatchLoop` einen schmalen strukturellen Typ erwarten
(`{ csvPath, pollIntervalSeconds, apiBaseUrl }`), den sowohl `Config` als auch die
Public-Config erfüllen. (Umsetzungsdetail; alternativ ein gemeinsamer `WatchConfig`-Typ.)

### CSV-Ziel pro Channel

- Ist `CSV_PATH` in der `.env` gesetzt → dieser Pfad übersteuert (wie im API-Mode).
- Ist `CSV_PATH` **nicht** gesetzt → Default `./song-requests-<username>.csv`.
  Verhindert Dedup-Kollisionen/Vermischung, wenn nacheinander mehrere Channels beobachtet
  werden. Der `<username>` stammt aus `parsePublicUrl`.

### CLI

- Neuer `scrape`-Zweig in [`index.ts`](../../../src/index.ts):
  1. URL aus `process.argv[3]` lesen; fehlt sie → Usage-Fehler + Exit 1.
  2. `parsePublicUrl(url)` → `{ provider, username }`.
  3. `loadPublicConfig(username)` (leitet CSV-Default aus `username` ab).
  4. `resolveChannelId(provider, username, config.apiBaseUrl)` → `channelId`.
  5. `scrape(config, channelId)`.
- `package.json`: neues Script `"scrape": "tsx src/index.ts scrape"`.
- Unbekannte Kommandos: Usage-Text um `scrape <url>` ergänzen.

## Datenfluss (Public-Mode)

```
URL ──parsePublicUrl──▶ {provider, username}
                             │
        resolveChannelId ────┘──▶ channelId
                             │
   runWatchLoop(config, () => fetchPublicQueue(channelId)):
       loop:
         RawQueue ──extractSongs──▶ Song[]
                  ──collectNewSongs(known)──▶ neue Songs
                  ──appendSong(csvPath)──▶ CSV
         sleep(pollIntervalSeconds)   [429 → Backoff]
```

## Fehlerbehandlung

- Ungültige/fehlende URL → sofortiger Usage-Fehler vor jeglichem Netzwerkzugriff.
- Channel nicht gefunden (404 bei `resolveChannelId`) → klare Meldung, Exit 1.
- 429 auf dem Queue-Endpunkt → bestehender exponentieller Backoff (30s → max 300s).
- Sonstige transiente Poll-Fehler → geloggt, Schleife läuft weiter (wie API-Mode).
- SIGINT (Ctrl-C) → sauberer Stopp (wie API-Mode).

## Tests (TDD, wie im Repo etabliert)

Unit-getestet (reine/logische Teile):

- `parsePublicUrl`: volle URL, Kurzform `provider/username`, mit/ohne `/song_requests`,
  ungültige Eingaben (leer, zu wenige Segmente).
- CSV-Default-Ableitung: mit gesetztem vs. ungesetztem `CSV_PATH`.
- `PUBLIC_POLL_INTERVAL_SECONDS`-Validierung/Default in `loadPublicConfig`.
- `collectNewSongs`-Dedup bleibt durch bestehende Tests abgedeckt (geteilte Logik).

Manuell E2E verifiziert (I/O-lastig, wie OAuth-Callback & Polling-Schleife):
`resolveChannelId`, `fetchPublicQueue`, `runWatchLoop`.

## Bewusst nicht enthalten (YAGNI)

- Kein Headless-Browser, kein HTML-Parser (unnötig — öffentliche JSON-API vorhanden).
- Kein gleichzeitiges Beobachten mehrerer Channels in einem Prozess.
- Keine Provider-Normalisierung (`t` → `twitch`), da die API `t` akzeptiert.

## Dokumentation

`README.md` (Englisch, public-facing) und `.env.example` um den Public-Mode ergänzen:
`PUBLIC_POLL_INTERVAL_SECONDS`, das `scrape`-Script und das Beispiel mit voller URL.
`CLAUDE.md` um Modul/Befehl ergänzen.
