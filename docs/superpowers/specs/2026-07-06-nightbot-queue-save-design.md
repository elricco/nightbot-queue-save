# Nightbot Song Request Queue Saver — Design

**Datum:** 2026-07-06
**Status:** Freigegeben (Brainstorming abgeschlossen)

## Problem

Nightbot besitzt eine Song-Request-Queue, deren Einträge nach dem Abspielen aus
der Liste verschwinden. Es gibt keine dauerhafte Historie der requesteten Songs.
Ziel ist ein lokal betreibbares Tool, das die Queue regelmäßig abfragt und jeden
je gesehenen Song dauerhaft in einer CSV-Datei festhält.

## Ziele

- Lokal betreibbar, minimale Abhängigkeiten.
- OAuth2-Authentifizierung gegen die Nightbot-API, Credentials über `.env`.
- Regelmäßiges Polling der Song-Request-Queue (alle paar Sekunden).
- Persistente Speicherung neuer Songs in einer UTF-8-CSV (Excel-kompatibel).
- Bereits gespeicherte Songs werden übersprungen, neue angehängt.
- Keine Secrets im Git (`.gitignore` schützt `.env` und Tokens).

## Nicht-Ziele (YAGNI)

- Kein Web-UI, kein Dashboard.
- Keine Datenbank — eine flache CSV genügt.
- Keine Bearbeitung/Steuerung der Queue (kein Skip/Pause/Add).
- Kein Multi-Channel-Support — ein Nightbot-Konto pro Instanz.

## Technische Entscheidungen

| Entscheidung        | Wahl                          | Begründung |
|---------------------|-------------------------------|------------|
| Runtime             | Node.js / TypeScript          | Node v24 bereits installiert; gutes Ökosystem für OAuth, HTTP, CSV. |
| OAuth-Bootstrap     | Lokaler Callback-Server       | Komfortabel: Browser öffnen, Redirect auf localhost automatisch abfangen. |
| Dedup-Schlüssel     | Track-/Video-ID (pro Song)    | Ein Song wird nur einmal gespeichert, auch bei mehrfachen Requests. |
| CSV-Encoding        | UTF-8 mit BOM                 | Excel zeigt Umlaute korrekt; überall lesbar. |

## Architektur

Ein CLI-Tool mit zwei Befehlen:

### `login`
1. Startet einen kurzlebigen lokalen HTTP-Server auf der Redirect-URI
   (Default `http://localhost:8080/callback`).
2. Öffnet die Nightbot-Autorisierungs-URL (`https://api.nightbot.tv/oauth2/authorize`)
   im Browser, inkl. `client_id`, `redirect_uri`, `response_type=code`, `scope`,
   `state`.
3. Fängt den zurückgelieferten `code` am Callback ab, validiert `state`.
4. Tauscht den Code am Token-Endpoint (`https://api.nightbot.tv/oauth2/token`,
   `grant_type=authorization_code`) gegen Access- + Refresh-Token.
5. Speichert die Tokens in `tokens.json` (gitignored) inkl. Ablaufzeitpunkt.
6. Fährt den lokalen Server herunter.

**Benötigter Scope:** `song_requests_queue` (Lesen der Queue).

### `watch` (Default-Befehl)
1. Lädt Tokens aus `tokens.json`. Fehlt die Datei → Hinweis, zuerst `login`
   auszuführen.
2. Liest die bestehende CSV (falls vorhanden) und lädt alle bekannten
   `track_id`-Werte in ein In-Memory-Set.
3. Polling-Schleife (Intervall aus `POLL_INTERVAL_SECONDS`, Default 5s):
   - `GET /1/song_requests/queue` mit `Authorization: Bearer <access_token>`.
   - Erfasst **sowohl** `_currentSong` (der gerade laufende Song) **als auch**
     alle Einträge im `queue`-Array. So wird jeder Song abgefangen, solange er
     noch sichtbar ist — bevor er nach dem Abspielen verschwindet.
   - Für jeden gesehenen Song: ist die `track_id` unbekannt, wird eine CSV-Zeile
     angehängt und die ID dem Set hinzugefügt.
4. Läuft, bis der Nutzer den Prozess beendet (Ctrl-C, sauberes Shutdown).

## Token-Handling

- Vor jedem Request wird geprüft, ob der Access-Token bald abläuft.
- Falls ja: Refresh über `grant_type=refresh_token` am Token-Endpoint, neue
  Tokens werden in `tokens.json` persistiert.
- Schlägt der Refresh fehl (Refresh-Token abgelaufen/ungültig): klare
  Fehlermeldung mit Aufforderung, `login` erneut auszuführen.

## Datenmodell — CSV

- Encoding: **UTF-8 mit BOM**.
- Trennzeichen: Komma. Felder mit Komma/Anführungszeichen/Zeilenumbruch werden
  RFC-4180-konform in Anführungszeichen gesetzt und escaped.
- Header wird nur beim Neuanlegen der Datei geschrieben.

**Spalten:**

| Spalte             | Beschreibung |
|--------------------|--------------|
| `track_id`         | Nightbot-interne Track-/Video-ID (Dedup-Schlüssel). |
| `title`            | Song-Titel. |
| `url`              | Direkter Link (YouTube, SoundCloud, …). |
| `requester`        | Anzeigename des Requesters. |
| `duration_seconds` | Länge in Sekunden. |
| `provider`         | Quelle (z. B. `youtube`, `soundcloud`). |
| `first_seen_at`    | ISO-8601-Zeitstempel, wann der Song erstmals gesehen wurde. |

## Fehlerbehandlung

- **Token abgelaufen:** automatischer Refresh; scheitert er → Aufforderung zu `login`.
- **Netzwerk-/API-Fehler (5xx, Timeout):** geloggt, Schleife läuft weiter; kein
  Abbruch, keine Datenverluste.
- **Rate-Limit (HTTP 429):** exponentielles Backoff, dann Weiterlauf.
- **CSV-Schreiben:** Append-Modus; die Datei wird nie überschrieben, bestehende
  Daten bleiben erhalten.

## Konfiguration (`.env`)

| Variable                 | Default                          | Beschreibung |
|--------------------------|----------------------------------|--------------|
| `NIGHTBOT_CLIENT_ID`     | —                                | OAuth-Client-ID (Nightbot Applications). |
| `NIGHTBOT_CLIENT_SECRET` | —                                | OAuth-Client-Secret. |
| `NIGHTBOT_REDIRECT_URI`  | `http://localhost:8080/callback` | Muss mit der App-Registrierung übereinstimmen. |
| `POLL_INTERVAL_SECONDS`  | `5`                              | Abfrageintervall der Queue. |
| `CSV_PATH`               | `./song-requests.csv`            | Zielpfad der CSV. |

## Projektstruktur / Dateien

```
.gitignore              # zuerst — schützt .env, tokens.json, CSV
.env.example            # Vorlage der benötigten Variablen
README.md               # Setup & Nutzung für Menschen
CLAUDE.md               # Kontext & Konventionen für Claude
package.json
tsconfig.json
src/
  config.ts             # .env laden & validieren
  auth.ts               # OAuth-Flow, Token-Refresh, tokens.json
  nightbot.ts           # API-Client (Queue abrufen)
  csv.ts                # CSV lesen (bekannte IDs) & anhängen (UTF-8 BOM)
  watch.ts              # Polling-Schleife
  index.ts              # CLI-Einstieg (login | watch)
```

## Teststrategie

- Unit-Tests für die reine Logik ohne Netzwerk:
  - CSV-Escaping (Komma/Quote/Umlaute), BOM-Präfix, Header-Verhalten.
  - Dedup: bekannte IDs aus vorhandener CSV werden übersprungen.
  - Extraktion der Song-Felder aus einer Nightbot-Queue-Beispielantwort
    (inkl. `_currentSong` + `queue`).
  - Token-Ablauf-Logik (Refresh nötig ja/nein).
- OAuth- und Polling-Schleife werden manuell gegen einen echten Nightbot-Account
  verifiziert (End-to-End).
```
