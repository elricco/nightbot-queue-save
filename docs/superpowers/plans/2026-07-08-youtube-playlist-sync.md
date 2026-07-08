# YouTube Playlist Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zusätzlich zur CSV werden gepollte YouTube-Songs in eine feste, per `.env` vorgegebene YouTube-Playlist im eigenen Konto eingefügt — in beiden Modi (`watch` und `scrape`), rein optional.

**Architecture:** Vier neue, jeweils fokussierte Module (`youtube-auth`, `youtube`, `youtube-sync`, `oauth-callback`) plus ein optionaler Sink-Hook in der bestehenden `runWatchLoop`. Die Playlist-Dedup ist von der CSV entkoppelt: Beim Start werden die bereits in der Playlist enthaltenen Video-IDs geladen; pro Poll werden alle noch nicht enthaltenen YouTube-Video-IDs eingefügt. Die CSV bleibt „source of truth" und läuft bei jedem YouTube-Fehler ungestört weiter.

**Tech Stack:** TypeScript (strict, ES-Module, NodeNext), Node built-in `fetch`, Vitest, YouTube Data API v3, Google OAuth2.

## Global Constraints

- ES-Module, TypeScript strict. Lokale Imports mit `.js`-Endung (NodeNext-Stil).
- Node built-in `fetch` — keine HTTP-Bibliothek.
- Tests liegen in `test/` und importieren aus `../src/<mod>.js`; getestet wird **nur reine Logik** (URL-Bau, Token-Ablauf/-Merge, Parsing, Sink-Logik). OAuth-Callback-Server und reale API-Aufrufe werden manuell E2E verifiziert — kein `fetch`-Mocking.
- Niemals `.env`, `tokens.json`, `youtube-tokens.json` oder CSVs committen.
- Doku (README/CHANGELOG): keine harten Zeilenumbrüche — Absätze/Bullets als Einzelzeile.
- Jeder Task endet grün: `npm run typecheck && npm test`.

---

### Task 1: YouTube-Config + Env-Dateien

**Files:**
- Modify: `src/types.ts` (neuer Typ `YouTubeConfig`)
- Modify: `src/config.ts` (`buildYouTubeConfig`, `loadYouTubeConfig`)
- Modify: `.env.example` (YouTube-Abschnitt)
- Modify: `.gitignore` (`youtube-tokens.json`)
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
  - `interface YouTubeConfig { clientId: string; clientSecret: string; redirectUri: string; playlistId: string; tokensPath: string }`
  - `buildYouTubeConfig(env: Record<string, string | undefined>): YouTubeConfig | null`
  - `loadYouTubeConfig(): YouTubeConfig | null`
- Semantik: `null` = YouTube gar nicht konfiguriert (weder `YOUTUBE_CLIENT_ID` noch `YOUTUBE_PLAYLIST_ID` gesetzt). `playlistId === ""` ist erlaubt (Login vor Playlist-Wahl möglich). Feature ist aktiv, wenn Rückgabe nicht null **und** `playlistId !== ""`.

- [ ] **Step 1: Failing test schreiben**

In `test/config.test.ts` ergänzen (Import-Zeile oben um `buildYouTubeConfig` erweitern, falls `config` schon importiert wird; sonst neuen Import ergänzen):

```ts
import { buildYouTubeConfig } from "../src/config.js";

describe("buildYouTubeConfig", () => {
  it("returns null when YouTube is entirely unconfigured", () => {
    expect(buildYouTubeConfig({})).toBeNull();
  });

  it("builds config with defaults when client creds and playlist are set", () => {
    const yt = buildYouTubeConfig({
      YOUTUBE_CLIENT_ID: "cid",
      YOUTUBE_CLIENT_SECRET: "csecret",
      YOUTUBE_PLAYLIST_ID: "PL123",
    });
    expect(yt).toEqual({
      clientId: "cid",
      clientSecret: "csecret",
      redirectUri: "http://localhost:8080/callback",
      playlistId: "PL123",
      tokensPath: "./youtube-tokens.json",
    });
  });

  it("allows an empty playlistId when only creds are set (login before choosing a playlist)", () => {
    const yt = buildYouTubeConfig({ YOUTUBE_CLIENT_ID: "cid", YOUTUBE_CLIENT_SECRET: "csecret" });
    expect(yt?.playlistId).toBe("");
  });

  it("throws when a playlist is set but the client id is missing", () => {
    expect(() => buildYouTubeConfig({ YOUTUBE_PLAYLIST_ID: "PL123" })).toThrow(/YOUTUBE_CLIENT_ID/);
  });

  it("throws when the client id is set but the secret is missing", () => {
    expect(() => buildYouTubeConfig({ YOUTUBE_CLIENT_ID: "cid", YOUTUBE_PLAYLIST_ID: "PL123" })).toThrow(/YOUTUBE_CLIENT_SECRET/);
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run test/config.test.ts -t buildYouTubeConfig`
Expected: FAIL — `buildYouTubeConfig is not a function` / kein Export.

- [ ] **Step 3: Typ ergänzen**

In `src/types.ts` unter die bestehenden Interfaces:

```ts
export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  playlistId: string; // may be "" — feature is active only when non-empty
  tokensPath: string;
}
```

- [ ] **Step 4: Builder implementieren**

In `src/config.ts` den Import erweitern und die Funktionen ergänzen:

```ts
import type { Config, WatchConfig, YouTubeConfig } from "./types.js";
```

```ts
// Returns null when YouTube is entirely unconfigured. Throws when partially
// configured in a way that cannot work (playlist without credentials).
export function buildYouTubeConfig(
  env: Record<string, string | undefined>,
): YouTubeConfig | null {
  const clientId = env.YOUTUBE_CLIENT_ID?.trim();
  const playlistId = env.YOUTUBE_PLAYLIST_ID?.trim() ?? "";
  if (!clientId && !playlistId) return null;
  if (!clientId) throw new Error("YOUTUBE_PLAYLIST_ID is set but YOUTUBE_CLIENT_ID is missing");
  const clientSecret = env.YOUTUBE_CLIENT_SECRET?.trim();
  if (!clientSecret) throw new Error("Missing required env var YOUTUBE_CLIENT_SECRET");
  return {
    clientId,
    clientSecret,
    redirectUri: env.YOUTUBE_REDIRECT_URI?.trim() || "http://localhost:8080/callback",
    playlistId,
    tokensPath: env.YOUTUBE_TOKENS_PATH?.trim() || "./youtube-tokens.json",
  };
}

export function loadYouTubeConfig(): YouTubeConfig | null {
  loadDotenv();
  return buildYouTubeConfig(process.env);
}
```

- [ ] **Step 5: Test läuft grün**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (alle, inkl. bestehender).

- [ ] **Step 6: `.env.example` ergänzen**

Am Ende von `.env.example` anhängen:

```
# --- YouTube playlist sync (optional) ---
# OAuth client from a Google Cloud project with the YouTube Data API v3 enabled.
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=http://localhost:8080/callback
# ID of a playlist you already created in YouTube. Empty = feature off.
YOUTUBE_PLAYLIST_ID=
```

- [ ] **Step 7: `.gitignore` ergänzen**

In `.gitignore` unter `tokens.json` eine Zeile ergänzen:

```
youtube-tokens.json
```

- [ ] **Step 8: Typecheck + Commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/types.ts src/config.ts test/config.test.ts .env.example .gitignore
git commit -m "feat: YouTube config loading + env scaffolding

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: OAuth-Callback-Server extrahieren (DRY-Refactor)

Zieht den lokalen Callback-Server + `openBrowser` aus `auth.ts` in ein wiederverwendbares Modul, damit der YouTube-Login (Task 3) denselben Flow nutzt. Verhaltensneutral für den Nightbot-Login.

**Files:**
- Create: `src/oauth-callback.ts`
- Modify: `src/auth.ts` (`login` nutzt Helper; `openBrowser` + `createServer`-Block entfallen)
- Test: keine neuen Unit-Tests (Server = manuell E2E). Regression über die bestehende Suite + Typecheck.

**Interfaces:**
- Produces:
  - `openBrowser(url: string): void`
  - `waitForOAuthCode(opts: { authUrl: string; redirectUri: string; state: string; label: string }): Promise<string>` — startet einen lokalen HTTP-Server auf dem Port der `redirectUri`, öffnet `authUrl` im Browser, wartet auf den Callback, prüft `state` und löst mit dem `code` auf. Bei State-Mismatch/fehlendem Code: rejektet.
- Consumes: nichts aus früheren Tasks.

- [ ] **Step 1: `src/oauth-callback.ts` anlegen**

```ts
import { createServer } from "node:http";
import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best effort — the URL is also printed to the console */
  }
}

// Runs a one-shot local callback server, returns the OAuth `code`.
export function waitForOAuthCode(opts: {
  authUrl: string;
  redirectUri: string;
  state: string;
  label: string;
}): Promise<string> {
  const redirect = new URL(opts.redirectUri);
  const port = Number(redirect.port || "80");
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (reqUrl.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = reqUrl.searchParams.get("code");
      const returnedState = reqUrl.searchParams.get("state");
      if (returnedState !== opts.state || !code) {
        res.writeHead(400).end("Invalid state or missing code. Close this tab and retry.");
        server.close();
        reject(new Error("OAuth callback failed: state mismatch or missing code."));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(`<h1>${opts.label} login complete.</h1><p>You can close this tab and return to the terminal.</p>`);
      server.close();
      resolve(code);
    });
    server.listen(port, () => {
      console.log(`Waiting for ${opts.label} authorization on ${opts.redirectUri} ...`);
      console.log(`If your browser did not open, visit:\n${opts.authUrl}\n`);
      openBrowser(opts.authUrl);
    });
    server.on("error", reject);
  });
}
```

- [ ] **Step 2: `auth.ts` auf den Helper umstellen**

In `src/auth.ts`: `import { createServer } from "node:http";`, `import { spawn } from "node:child_process";` und die lokale `openBrowser`-Funktion entfernen. Stattdessen oben ergänzen:

```ts
import { waitForOAuthCode } from "./oauth-callback.js";
```

Die gesamte `login`-Funktion ersetzen durch:

```ts
export async function login(config: Config): Promise<void> {
  const state = randomUUID();
  const authUrl = buildAuthorizeUrl(config, state);
  const code = await waitForOAuthCode({
    authUrl,
    redirectUri: config.redirectUri,
    state,
    label: "Nightbot",
  });
  const tokens = await exchangeCode(config, code);
  writeTokens(config.tokensPath, tokens);
  console.log(`Tokens saved to ${config.tokensPath}.`);
}
```

(`randomUUID` bleibt importiert; prüfen, dass `createServer`/`spawn`-Imports und die alte `openBrowser`-Definition wirklich entfernt sind.)

- [ ] **Step 3: Regression grün**

Run: `npm run typecheck && npm test`
Expected: PASS (unverändertes Verhalten; `auth.test.ts` bleibt grün).

- [ ] **Step 4: Manuelle E2E-Notiz**

Optional vor dem Merge: `npm run login` einmal real durchspielen (Browser-Redirect → „Nightbot login complete." → `tokens.json` geschrieben). Nur Doku-Hinweis, kein Blocker für den Commit.

- [ ] **Step 5: Commit**

```bash
git add src/oauth-callback.ts src/auth.ts
git commit -m "refactor: extract shared OAuth callback server into oauth-callback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: YouTube-OAuth (`youtube-auth.ts`)

**Files:**
- Create: `src/youtube-auth.ts`
- Test: `test/youtube-auth.test.ts`

**Interfaces:**
- Consumes: `YouTubeConfig` (Task 1); `Tokens` (types); `readTokens`, `writeTokens`, `needsRefresh` aus `src/auth.js`; `waitForOAuthCode` aus `src/oauth-callback.js`.
- Produces:
  - `class YouTubeAuthError extends Error { readonly pauseSync = true }`
  - `buildYouTubeAuthorizeUrl(config: YouTubeConfig, state: string): string`
  - `mergeRefreshedTokens(previous: Tokens, resp: { access_token: string; refresh_token?: string; expires_in: number }, now?: number): Tokens`
  - `exchangeYouTubeCode(config: YouTubeConfig, code: string): Promise<Tokens>`
  - `refreshYouTubeTokens(config: YouTubeConfig, previous: Tokens): Promise<Tokens>`
  - `getValidYouTubeAccessToken(config: YouTubeConfig): Promise<string>` (wirft `YouTubeAuthError`)
  - `loginYouTube(config: YouTubeConfig): Promise<void>`

- [ ] **Step 1: Failing test schreiben**

`test/youtube-auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildYouTubeAuthorizeUrl, mergeRefreshedTokens, getValidYouTubeAccessToken, YouTubeAuthError } from "../src/youtube-auth.js";
import type { YouTubeConfig, Tokens } from "../src/types.js";

const cfg: YouTubeConfig = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "http://localhost:8080/callback",
  playlistId: "PL123",
  tokensPath: "./test/no-such-youtube-tokens.json",
};

describe("buildYouTubeAuthorizeUrl", () => {
  it("targets Google and requests offline access with a refresh token", () => {
    const url = new URL(buildYouTubeAuthorizeUrl(cfg, "STATE123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8080/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("STATE123");
  });
});

describe("mergeRefreshedTokens", () => {
  const previous: Tokens = { accessToken: "old", refreshToken: "R_OLD", expiresAt: 0 };

  it("keeps the previous refresh token when the response omits one", () => {
    const merged = mergeRefreshedTokens(previous, { access_token: "new", expires_in: 3600 }, 1_000);
    expect(merged.accessToken).toBe("new");
    expect(merged.refreshToken).toBe("R_OLD");
    expect(merged.expiresAt).toBe(1_000 + 3600 * 1000);
  });

  it("uses a new refresh token when the response provides one", () => {
    const merged = mergeRefreshedTokens(previous, { access_token: "new", refresh_token: "R_NEW", expires_in: 3600 }, 0);
    expect(merged.refreshToken).toBe("R_NEW");
  });
});

describe("getValidYouTubeAccessToken", () => {
  it("throws YouTubeAuthError when no tokens file exists", async () => {
    await expect(getValidYouTubeAccessToken(cfg)).rejects.toBeInstanceOf(YouTubeAuthError);
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run test/youtube-auth.test.ts`
Expected: FAIL — Modul/Exports fehlen.

- [ ] **Step 3: `src/youtube-auth.ts` implementieren**

```ts
import { randomUUID } from "node:crypto";
import type { Tokens, YouTubeConfig } from "./types.js";
import { readTokens, writeTokens, needsRefresh } from "./auth.js";
import { waitForOAuthCode } from "./oauth-callback.js";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube";

// Marker error: signals the sync should pause for the rest of the run.
export class YouTubeAuthError extends Error {
  readonly pauseSync = true as const;
}

export function buildYouTubeAuthorizeUrl(config: YouTubeConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

// Google omits refresh_token on refresh responses — preserve the previous one.
export function mergeRefreshedTokens(
  previous: Tokens,
  resp: TokenResponse,
  now: number = Date.now(),
): Tokens {
  const expiresIn =
    typeof resp.expires_in === "number" && Number.isFinite(resp.expires_in) ? resp.expires_in : 0;
  return {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token ?? previous.refreshToken,
    expiresAt: now + expiresIn * 1000,
  };
}

async function postToken(config: YouTubeConfig, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`YouTube token request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeYouTubeCode(config: YouTubeConfig, code: string): Promise<Tokens> {
  const resp = await postToken(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });
  // On the first consent Google returns a refresh_token; seed from an empty previous.
  return mergeRefreshedTokens({ accessToken: "", refreshToken: "", expiresAt: 0 }, resp);
}

export async function refreshYouTubeTokens(config: YouTubeConfig, previous: Tokens): Promise<Tokens> {
  const resp = await postToken(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: previous.refreshToken,
  });
  return mergeRefreshedTokens(previous, resp);
}

export async function getValidYouTubeAccessToken(config: YouTubeConfig): Promise<string> {
  const tokens = readTokens(config.tokensPath);
  if (!tokens) {
    throw new YouTubeAuthError('No YouTube tokens found. Run "npm run login:youtube" first.');
  }
  if (needsRefresh(tokens, Date.now())) {
    let refreshed: Tokens;
    try {
      refreshed = await refreshYouTubeTokens(config, tokens);
    } catch (err) {
      throw new YouTubeAuthError(
        `YouTube token refresh failed — run "npm run login:youtube" again. (${(err as Error).message})`,
      );
    }
    writeTokens(config.tokensPath, refreshed);
    return refreshed.accessToken;
  }
  return tokens.accessToken;
}

export async function loginYouTube(config: YouTubeConfig): Promise<void> {
  const state = randomUUID();
  const authUrl = buildYouTubeAuthorizeUrl(config, state);
  const code = await waitForOAuthCode({
    authUrl,
    redirectUri: config.redirectUri,
    state,
    label: "YouTube",
  });
  const tokens = await exchangeYouTubeCode(config, code);
  writeTokens(config.tokensPath, tokens);
  console.log(`YouTube tokens saved to ${config.tokensPath}.`);
}
```

- [ ] **Step 4: Test läuft grün**

Run: `npx vitest run test/youtube-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + Commit**

Run: `npm run typecheck && npm test`

```bash
git add src/youtube-auth.ts test/youtube-auth.test.ts
git commit -m "feat: YouTube (Google) OAuth2 auth module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: YouTube Data API v3 Wrapper (`youtube.ts`)

**Files:**
- Create: `src/youtube.ts`
- Test: `test/youtube.test.ts`

**Interfaces:**
- Produces:
  - `class QuotaExceededError extends Error { readonly pauseSync = true }`
  - `aggregateVideoIds(pages: PlaylistItemsPage[]): string[]` (pure)
  - `isQuotaError(status: number, body: string): boolean` (pure)
  - `listPlaylistVideoIds(accessToken: string, playlistId: string): Promise<string[]>`
  - `insertPlaylistItem(accessToken: string, playlistId: string, videoId: string): Promise<void>` (wirft `QuotaExceededError` bei Quota)
  - `interface PlaylistItemsPage { items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string }`

- [ ] **Step 1: Failing test schreiben**

`test/youtube.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aggregateVideoIds, isQuotaError } from "../src/youtube.js";

describe("aggregateVideoIds", () => {
  it("flattens video ids across pages and skips missing ones", () => {
    const ids = aggregateVideoIds([
      { items: [{ contentDetails: { videoId: "a" } }, { contentDetails: { videoId: "b" } }] },
      { items: [{ contentDetails: {} }, { contentDetails: { videoId: "c" } }] },
    ]);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("handles empty/absent items", () => {
    expect(aggregateVideoIds([{}, { items: [] }])).toEqual([]);
  });
});

describe("isQuotaError", () => {
  it("is true for a 403 with a quotaExceeded reason", () => {
    expect(isQuotaError(403, '{"error":{"errors":[{"reason":"quotaExceeded"}]}}')).toBe(true);
    expect(isQuotaError(403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}')).toBe(true);
  });

  it("is false for other 403s and non-403 statuses", () => {
    expect(isQuotaError(403, '{"error":{"errors":[{"reason":"forbidden"}]}}')).toBe(false);
    expect(isQuotaError(404, "quotaExceeded")).toBe(false);
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run test/youtube.test.ts`
Expected: FAIL — Modul/Exports fehlen.

- [ ] **Step 3: `src/youtube.ts` implementieren**

```ts
const API_BASE = "https://www.googleapis.com/youtube/v3";

export class QuotaExceededError extends Error {
  readonly pauseSync = true as const;
}

export interface PlaylistItemsPage {
  items?: { contentDetails?: { videoId?: string } }[];
  nextPageToken?: string;
}

export function aggregateVideoIds(pages: PlaylistItemsPage[]): string[] {
  const ids: string[] = [];
  for (const page of pages) {
    for (const item of page.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id) ids.push(id);
    }
  }
  return ids;
}

export function isQuotaError(status: number, body: string): boolean {
  return status === 403 && /quotaExceeded|rateLimitExceeded/.test(body);
}

export async function listPlaylistVideoIds(
  accessToken: string,
  playlistId: string,
): Promise<string[]> {
  const pages: PlaylistItemsPage[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      part: "contentDetails",
      maxResults: "50",
      playlistId,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${API_BASE}/playlistItems?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      if (isQuotaError(res.status, body)) throw new QuotaExceededError("YouTube API quota exceeded.");
      throw new Error(`playlistItems.list failed: ${res.status} ${body}`);
    }
    const page = (await res.json()) as PlaylistItemsPage;
    pages.push(page);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return aggregateVideoIds(pages);
}

export async function insertPlaylistItem(
  accessToken: string,
  playlistId: string,
  videoId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/playlistItems?part=snippet`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (isQuotaError(res.status, body)) throw new QuotaExceededError("YouTube API quota exceeded.");
    throw new Error(`playlistItems.insert failed: ${res.status} ${body}`);
  }
}
```

- [ ] **Step 4: Test läuft grün**

Run: `npx vitest run test/youtube.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + Commit**

Run: `npm run typecheck && npm test`

```bash
git add src/youtube.ts test/youtube.test.ts
git commit -m "feat: YouTube Data API v3 playlist wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Playlist-Sink (`youtube-sync.ts`)

Reine, I/O-freie Sink-Logik: dedup gegen ein „bereits drin"-Set, Pause bei `pauseSync`-Fehlern, Retry bei transienten Fehlern.

**Files:**
- Create: `src/youtube-sync.ts`
- Test: `test/youtube-sync.test.ts`

**Interfaces:**
- Consumes: `Song` (types).
- Produces:
  - `interface PlaylistSink { push(songs: Song[]): Promise<void> }`
  - `interface PlaylistSinkOptions { known: Set<string>; insert: (videoId: string) => Promise<void>; log?: (msg: string) => void }`
  - `createPlaylistSink(opts: PlaylistSinkOptions): PlaylistSink`
- Verhalten: fügt nur Songs mit `provider === "youtube"` ein, deren `trackId` nicht in `known` ist. Nach erfolgreichem Insert `known.add(trackId)`. Wirft `insert` einen Fehler mit `pauseSync === true`, wird der Sink für den Rest des Laufs pausiert (keine weiteren Inserts) und `err.message` geloggt. Bei sonstigen Fehlern: loggen, `trackId` **nicht** merken (nächster Poll versucht es erneut).

- [ ] **Step 1: Failing test schreiben**

`test/youtube-sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createPlaylistSink } from "../src/youtube-sync.js";
import type { Song } from "../src/types.js";

function song(trackId: string, provider = "youtube"): Song {
  return { trackId, title: `t-${trackId}`, url: "u", requester: "r", durationSeconds: 1, provider, firstSeenAt: "" };
}

describe("createPlaylistSink", () => {
  it("inserts only unknown YouTube videos and skips other providers", async () => {
    const inserted: string[] = [];
    const sink = createPlaylistSink({
      known: new Set(["B"]),
      insert: async (id) => { inserted.push(id); },
    });
    await sink.push([song("A"), song("B"), song("C", "soundcloud"), song("D")]);
    expect(inserted).toEqual(["A", "D"]); // B known, C non-youtube
  });

  it("does not re-insert within the same run once added", async () => {
    const inserted: string[] = [];
    const sink = createPlaylistSink({ known: new Set(), insert: async (id) => { inserted.push(id); } });
    await sink.push([song("A")]);
    await sink.push([song("A")]);
    expect(inserted).toEqual(["A"]);
  });

  it("pauses after a pauseSync error and stops inserting", async () => {
    const inserted: string[] = [];
    const quota = Object.assign(new Error("quota"), { pauseSync: true });
    const sink = createPlaylistSink({
      known: new Set(),
      insert: async (id) => { if (id === "A") throw quota; inserted.push(id); },
    });
    await sink.push([song("A"), song("B")]); // A throws → pause before B
    await sink.push([song("C")]);            // still paused
    expect(inserted).toEqual([]);
  });

  it("retries a transient failure on the next push (id not remembered)", async () => {
    const calls: string[] = [];
    let fail = true;
    const sink = createPlaylistSink({
      known: new Set(),
      insert: async (id) => { calls.push(id); if (fail) { fail = false; throw new Error("network"); } },
    });
    await sink.push([song("A")]); // fails, not remembered
    await sink.push([song("A")]); // retried, succeeds
    expect(calls).toEqual(["A", "A"]);
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run test/youtube-sync.test.ts`
Expected: FAIL — Modul/Export fehlt.

- [ ] **Step 3: `src/youtube-sync.ts` implementieren**

```ts
import type { Song } from "./types.js";

export interface PlaylistSink {
  push(songs: Song[]): Promise<void>;
}

export interface PlaylistSinkOptions {
  known: Set<string>;
  insert: (videoId: string) => Promise<void>;
  log?: (msg: string) => void;
}

function isPauseSync(err: unknown): err is { pauseSync: true; message: string } {
  return typeof err === "object" && err !== null && (err as { pauseSync?: unknown }).pauseSync === true;
}

export function createPlaylistSink(opts: PlaylistSinkOptions): PlaylistSink {
  const log = opts.log ?? (() => {});
  let paused = false;

  return {
    async push(songs: Song[]): Promise<void> {
      if (paused) return;
      for (const song of songs) {
        if (paused) return;
        if (song.provider !== "youtube") continue;
        if (opts.known.has(song.trackId)) continue;
        try {
          await opts.insert(song.trackId);
          opts.known.add(song.trackId);
          log(`+ playlist: ${song.title} (${song.trackId})`);
        } catch (err) {
          if (isPauseSync(err)) {
            paused = true;
            log(`YouTube playlist sync paused for this run: ${err.message} CSV logging continues.`);
            return;
          }
          log(`Playlist insert failed for ${song.trackId} (will retry): ${(err as Error).message}`);
        }
      }
    },
  };
}
```

- [ ] **Step 4: Test läuft grün**

Run: `npx vitest run test/youtube-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + Commit**

Run: `npm run typecheck && npm test`

```bash
git add src/youtube-sync.ts test/youtube-sync.test.ts
git commit -m "feat: playlist sink with dedup, pause-on-quota, retry-on-transient

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Watch-Loop-Integration (Sink + Seeding)

Verdrahtet den optionalen Sink in `runWatchLoop` und baut/seedt ihn in `watch`/`scrape`. Der Loop ist die Polling-Schleife → manuell E2E verifiziert; keine neuen Unit-Tests, aber bestehende bleiben grün.

**Files:**
- Modify: `src/watch.ts`
- Test: keine neuen (Loop = manuell E2E). `test/watch.test.ts` (`collectNewSongs`) bleibt unverändert grün.

**Interfaces:**
- Consumes: `YouTubeConfig` (Task 1); `getValidYouTubeAccessToken` (Task 3); `listPlaylistVideoIds`, `insertPlaylistItem` (Task 4); `createPlaylistSink`, `PlaylistSink` (Task 5).
- Produces (geänderte Signaturen):
  - `runWatchLoop(config: WatchConfig, fetchOnce: () => Promise<RawQueue>, sink?: PlaylistSink): Promise<void>`
  - `watch(config: Config, yt: YouTubeConfig | null): Promise<void>`
  - `scrape(config: WatchConfig, provider: string, username: string, yt: YouTubeConfig | null): Promise<void>`

- [ ] **Step 1: Imports + Sink-Setup ergänzen**

In `src/watch.ts` die Imports erweitern:

```ts
import type { Config, Song, WatchConfig, YouTubeConfig } from "./types.js";
import { extractSongs, fetchQueue, type RawQueue } from "./nightbot.js";
import { getValidAccessToken, AuthError } from "./auth.js";
import { readKnownTrackIds, appendSong } from "./csv.js";
import { resolveChannelId, fetchPublicQueue } from "./public.js";
import { getValidYouTubeAccessToken } from "./youtube-auth.js";
import { listPlaylistVideoIds, insertPlaylistItem } from "./youtube.js";
import { createPlaylistSink, type PlaylistSink } from "./youtube-sync.js";
```

Neue Setup-Funktion (baut den Sink nur, wenn das Feature aktiv ist, und seedt ihn aus der bestehenden Playlist; jeder Fehlerpfad deaktiviert den Sink für den Lauf und lässt die CSV unberührt):

```ts
async function buildPlaylistSink(yt: YouTubeConfig | null): Promise<PlaylistSink | undefined> {
  if (!yt || !yt.playlistId) return undefined;

  let seedToken: string;
  try {
    seedToken = await getValidYouTubeAccessToken(yt);
  } catch (err) {
    console.warn(`YouTube playlist sync disabled: ${(err as Error).message}`);
    return undefined;
  }

  let existing: string[];
  try {
    existing = await listPlaylistVideoIds(seedToken, yt.playlistId);
  } catch (err) {
    console.warn(
      `YouTube playlist sync disabled — could not read playlist ${yt.playlistId}: ${(err as Error).message}`,
    );
    return undefined;
  }

  const known = new Set(existing);
  console.log(`YouTube playlist sync on. ${known.size} video(s) already in playlist ${yt.playlistId}.`);
  return createPlaylistSink({
    known,
    insert: async (videoId) => {
      const token = await getValidYouTubeAccessToken(yt); // refreshes as needed
      await insertPlaylistItem(token, yt.playlistId, videoId);
    },
    log: (msg) => console.log(msg),
  });
}
```

- [ ] **Step 2: `runWatchLoop` um den Sink erweitern**

Signatur ändern und im Poll-Erfolgszweig nach dem CSV-Append den Sink füttern (alle extrahierten Songs des Polls, nicht nur die Neuzugänge — so bleibt die Playlist-Dedup von der CSV entkoppelt):

```ts
export async function runWatchLoop(
  config: WatchConfig,
  fetchOnce: () => Promise<RawQueue>,
  sink?: PlaylistSink,
): Promise<void> {
```

Im `try`-Block, direkt nach der `for`-Schleife, die `appendSong` aufruft, und **vor** `backoffMs = BASE_BACKOFF_MS;` einfügen:

```ts
      if (sink) {
        try {
          await sink.push(extractSongs(response as RawQueue, new Date().toISOString()));
        } catch (err) {
          console.error(`Playlist sync error: ${(err as Error).message}`);
        }
      }
```

(`extractSongs` ist rein und günstig; die doppelte Extraktion hält `collectNewSongs` unverändert und damit die bestehenden Tests grün.)

- [ ] **Step 3: `watch` und `scrape` durchreichen**

```ts
export async function watch(config: Config, yt: YouTubeConfig | null): Promise<void> {
  const sink = await buildPlaylistSink(yt);
  await runWatchLoop(
    config,
    async () => {
      const accessToken = await getValidAccessToken(config);
      return fetchQueue(accessToken, config.apiBaseUrl);
    },
    sink,
  );
}

export async function scrape(
  config: WatchConfig,
  provider: string,
  username: string,
  yt: YouTubeConfig | null,
): Promise<void> {
  const channelId = await resolveChannelId(provider, username, config.apiBaseUrl);
  console.log(`Resolved ${provider}/${username} to channel ${channelId}.`);
  const sink = await buildPlaylistSink(yt);
  await runWatchLoop(config, () => fetchPublicQueue(channelId, config.apiBaseUrl), sink);
}
```

- [ ] **Step 4: Typecheck + bestehende Tests grün**

Run: `npm run typecheck && npm test`
Expected: PASS. (`index.ts` ruft `watch`/`scrape` noch mit alter Signatur auf → das wird in Task 7 angepasst; falls `typecheck` hier schon wegen der neuen Pflicht-Parameter meckert, ist das erwartet und wird in Task 7 aufgelöst. Um Task 6 eigenständig grün zu halten, in Task 7 sofort nachziehen — oder Task 6 und 7 als Paar committen.)

> Hinweis für den Executor: Wenn `npm run typecheck` in Step 4 wegen der geänderten `watch`/`scrape`-Signatur in `index.ts` fehlschlägt, führe **Task 7 Steps 1–2** aus, bevor du committest, und committe beide zusammen. Alternativ Task 6 in `index.ts` provisorisch mit `loadYouTubeConfig()` verdrahten (siehe Task 7).

- [ ] **Step 5: Commit (ggf. zusammen mit Task 7)**

```bash
git add src/watch.ts
git commit -m "feat: wire optional playlist sink into the watch loop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: CLI-Befehl, npm-Script und Doku

**Files:**
- Modify: `src/index.ts` (`login:youtube`-Dispatch; `watch`/`scrape` mit YouTube-Config)
- Modify: `package.json` (Script `login:youtube`)
- Modify: `README.md` (Abschnitt „Optional: YouTube playlist sync")
- Test: manuelle CLI-Verifikation + Typecheck.

**Interfaces:**
- Consumes: `loadYouTubeConfig` (Task 1); `loginYouTube` (Task 3); geänderte `watch`/`scrape` (Task 6).

- [ ] **Step 1: `src/index.ts` verdrahten**

Imports:

```ts
import { loadConfig, loadPublicConfig, loadYouTubeConfig } from "./config.js";
import { login } from "./auth.js";
import { loginYouTube } from "./youtube-auth.js";
import { watch, scrape } from "./watch.js";
import { parsePublicUrl } from "./public.js";
```

`switch` anpassen: `watch`/`scrape` bekommen die YouTube-Config, neuer Fall `login:youtube`, aktualisierte Default-Meldung:

```ts
    case "login":
      await login(loadConfig());
      break;
    case "login:youtube": {
      const yt = loadYouTubeConfig();
      if (!yt) {
        console.error(
          "YouTube is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first.",
        );
        process.exit(1);
      }
      await loginYouTube(yt);
      break;
    }
    case "watch":
      await watch(loadConfig(), loadYouTubeConfig());
      break;
    case "scrape": {
      const url = process.argv[3];
      if (!url) {
        console.error(
          "Usage: npm run scrape <public-queue-url>\n" +
            "Example: npm run scrape https://nightbot.tv/t/<username>/song_requests",
        );
        process.exit(1);
      }
      const { provider, username } = parsePublicUrl(url);
      await scrape(loadPublicConfig(username), provider, username, loadYouTubeConfig());
      break;
    }
    default:
      console.error(
        `Unknown command "${command}". Use "login", "login:youtube", "watch", or "scrape <url>".`,
      );
      process.exit(1);
```

- [ ] **Step 2: `package.json`-Script ergänzen**

In `scripts` (nach `"login"`) einfügen:

```json
    "login:youtube": "tsx src/index.ts login:youtube",
```

- [ ] **Step 3: Typecheck + Tests grün**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: CLI-Fehlerpfad manuell prüfen**

Run (ohne YouTube-Env): `npm run login:youtube`
Expected: `YouTube is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first.` und Exit-Code 1.

- [ ] **Step 5: README-Abschnitt ergänzen**

In `README.md` einen Abschnitt einfügen (englisch, public-facing; **keine harten Zeilenumbrüche** — jeder Absatz/Bullet als Einzelzeile):

```markdown
## Optional: YouTube playlist sync

Alongside the CSV, the tool can add every polled **YouTube** song to a playlist on your own YouTube account. It works in both `watch` and `scrape` mode. It is entirely optional: leave `YOUTUBE_PLAYLIST_ID` empty and nothing changes.

Setup (one-time):

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **YouTube Data API v3**.
2. Create an **OAuth client ID** (Desktop or Web) with the redirect URI `http://localhost:8080/callback`.
3. Put the client ID and secret into `.env` (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`).
4. Create a playlist in YouTube (public, unlisted, or private — your choice), copy its ID, and set `YOUTUBE_PLAYLIST_ID`.
5. Run `npm run login:youtube` once to authorize (writes `youtube-tokens.json`).

Then `npm run watch` or `npm run scrape <url>` will append new YouTube songs to that playlist in addition to the CSV.

Notes: the playlist keeps whatever visibility you set on it — the tool never changes it. Non-YouTube requests (e.g. SoundCloud) are skipped. The YouTube Data API has a default quota of 10,000 units/day and each added song costs 50 units (~200 songs/day); if the quota is exhausted the playlist sync pauses for the rest of the run and prints a notice, while CSV logging continues.
```

- [ ] **Step 6: Typecheck + Commit**

Run: `npm run typecheck && npm test`

```bash
git add src/index.ts package.json README.md
git commit -m "feat: login:youtube command + docs for playlist sync

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle E2E-Verifikation (nach allen Tasks, vor Merge/Release)

1. `.env` mit echten Google-OAuth-Credentials und `YOUTUBE_PLAYLIST_ID` füllen.
2. `npm run login:youtube` → Browser-Consent (offline/refresh) → „YouTube login complete." → `youtube-tokens.json` vorhanden.
3. `npm run watch` (oder `npm run scrape <url>`): Startzeile „YouTube playlist sync on. N video(s) already in playlist …" erscheint; ein neuer YouTube-Request landet in CSV **und** in der Playlist; ein bereits enthaltener Song wird nicht doppelt eingefügt; ein Nicht-YouTube-Request wird nur in die CSV geschrieben.
4. Ohne `YOUTUBE_PLAYLIST_ID`: Verhalten unverändert (nur CSV, keine YouTube-Ausgaben).
5. Mit gesetzter `YOUTUBE_PLAYLIST_ID`, aber ohne `youtube-tokens.json`: Warnung „YouTube playlist sync disabled: No YouTube tokens found…", CSV läuft weiter.

## Release (separat, nach Merge)

Gemäß `CLAUDE.md`: `version` in `package.json` anheben, `CHANGELOG.md` ergänzen, `npm run release`, Tag `vX.Y.Z`. Neu im Release enthalten sind die vier YouTube-Module — `package.json` `files` deckt `src` bereits ab, kein Zusatzeintrag nötig.
