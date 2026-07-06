# Nightbot Song Request Queue Saver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Node.js/TypeScript CLI that polls the Nightbot song-request queue every few seconds and appends every newly-seen song to a UTF-8 (BOM) CSV, so songs are preserved after they leave the queue.

**Architecture:** Two CLI commands. `login` runs a short-lived local HTTP server to complete the OAuth2 authorization-code flow and stores tokens in `tokens.json`. `watch` loads the tokens (auto-refreshing when near expiry), polls `GET /1/song_requests/queue`, captures both `_currentSong` and all `queue` items, and appends songs whose `track_id` is not already in the CSV. Pure logic (CSV, extraction, token-expiry, URL building) is unit-tested; the OAuth callback server and polling loop are verified manually end-to-end.

**Tech Stack:** Node.js v24 (global `fetch`), TypeScript, `tsx` (run TS directly), `vitest` (tests), `dotenv` (env loading). No `axios` — use built-in `fetch`. No CSV library — a small RFC-4180 helper is included and tested.

**Spec:** `docs/superpowers/specs/2026-07-06-nightbot-queue-save-design.md`

---

## File Structure

```
package.json            # scripts + deps
tsconfig.json
vitest.config.ts
.env.example            # template of required env vars
.gitignore              # already exists
README.md               # setup & usage (English)
CLAUDE.md               # context & conventions for Claude
src/
  types.ts              # Song, Tokens, Config interfaces
  config.ts             # loadConfig(): read/validate .env, apply defaults
  csv.ts                # parseCsv, escapeField, formatRow, readKnownTrackIds, appendSong
  nightbot.ts           # extractSongs(response), fetchQueue(accessToken, baseUrl)
  auth.ts               # buildAuthorizeUrl, needsRefresh, exchangeCode, refreshTokens,
                        #   readTokens, writeTokens, getValidAccessToken, login
  watch.ts              # collectNewSongs(response, knownIds), watch(config)
  index.ts              # CLI dispatch: `login` | `watch` (default)
test/
  csv.test.ts
  nightbot.test.ts
  auth.test.ts
  config.test.ts
  watch.test.ts
  fixtures/queue-response.json
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/types.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "nightbot-queue-save",
  "version": "0.1.0",
  "description": "Persist the Nightbot song-request queue to a CSV file.",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "login": "tsx src/index.ts login",
    "watch": "tsx src/index.ts watch",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"],
    "lib": ["ES2022"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `.env.example`**

```
# OAuth credentials from https://nightbot.tv/account/applications
NIGHTBOT_CLIENT_ID=
NIGHTBOT_CLIENT_SECRET=

# Must exactly match the Redirect URI configured on the Nightbot application
NIGHTBOT_REDIRECT_URI=http://localhost:8080/callback

# How often to poll the queue, in seconds
POLL_INTERVAL_SECONDS=5

# Where to write the CSV
CSV_PATH=./song-requests.csv
```

- [ ] **Step 5: Create `src/types.ts`**

```ts
export interface Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  pollIntervalSeconds: number;
  csvPath: string;
  tokensPath: string;
  apiBaseUrl: string;
  authBaseUrl: string;
}

export interface Song {
  trackId: string;
  title: string;
  url: string;
  requester: string;
  durationSeconds: number;
  provider: string;
  firstSeenAt: string; // ISO-8601
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms when the access token expires
}
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Verify typecheck passes on the empty scaffold**

Run: `npm run typecheck`
Expected: exits 0 (no errors).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example src/types.ts
git commit -m "chore: project scaffold and shared types"
```

---

## Task 2: Config loading

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildConfig } from "../src/config.js";

describe("buildConfig", () => {
  it("applies defaults when optional vars are missing", () => {
    const cfg = buildConfig({
      NIGHTBOT_CLIENT_ID: "id",
      NIGHTBOT_CLIENT_SECRET: "secret",
    });
    expect(cfg.clientId).toBe("id");
    expect(cfg.clientSecret).toBe("secret");
    expect(cfg.redirectUri).toBe("http://localhost:8080/callback");
    expect(cfg.pollIntervalSeconds).toBe(5);
    expect(cfg.csvPath).toBe("./song-requests.csv");
    expect(cfg.apiBaseUrl).toBe("https://api.nightbot.tv");
  });

  it("reads overrides from env", () => {
    const cfg = buildConfig({
      NIGHTBOT_CLIENT_ID: "id",
      NIGHTBOT_CLIENT_SECRET: "secret",
      POLL_INTERVAL_SECONDS: "10",
      CSV_PATH: "/tmp/out.csv",
    });
    expect(cfg.pollIntervalSeconds).toBe(10);
    expect(cfg.csvPath).toBe("/tmp/out.csv");
  });

  it("throws when required vars are missing", () => {
    expect(() => buildConfig({ NIGHTBOT_CLIENT_ID: "id" })).toThrow(
      /NIGHTBOT_CLIENT_SECRET/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { config as loadDotenv } from "dotenv";
import type { Config } from "./types.js";

export function buildConfig(env: Record<string, string | undefined>): Config {
  const clientId = env.NIGHTBOT_CLIENT_ID;
  const clientSecret = env.NIGHTBOT_CLIENT_SECRET;
  if (!clientId) throw new Error("Missing required env var NIGHTBOT_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing required env var NIGHTBOT_CLIENT_SECRET");

  return {
    clientId,
    clientSecret,
    redirectUri: env.NIGHTBOT_REDIRECT_URI ?? "http://localhost:8080/callback",
    pollIntervalSeconds: Number(env.POLL_INTERVAL_SECONDS ?? "5"),
    csvPath: env.CSV_PATH ?? "./song-requests.csv",
    tokensPath: env.TOKENS_PATH ?? "./tokens.json",
    apiBaseUrl: "https://api.nightbot.tv",
    authBaseUrl: "https://api.nightbot.tv",
  };
}

export function loadConfig(): Config {
  loadDotenv();
  return buildConfig(process.env);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: config loading with defaults and validation"
```

---

## Task 3: CSV helpers

**Files:**
- Create: `src/csv.ts`, `test/csv.test.ts`

- [ ] **Step 1: Write the failing test**

`test/csv.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { escapeField, formatRow, parseCsv, readKnownTrackIds, appendSong } from "../src/csv.js";
import type { Song } from "../src/types.js";

const TMP = "./test/tmp-songs.csv";
afterEach(() => { if (existsSync(TMP)) rmSync(TMP); });

const sampleSong: Song = {
  trackId: "abc123",
  title: 'Song, with "quotes"',
  url: "https://youtu.be/abc123",
  requester: "Möller",
  durationSeconds: 200,
  provider: "youtube",
  firstSeenAt: "2026-07-06T12:00:00.000Z",
};

describe("escapeField", () => {
  it("leaves plain fields untouched", () => {
    expect(escapeField("hello")).toBe("hello");
  });
  it("quotes and doubles quotes when field has comma or quote", () => {
    expect(escapeField('a,b')).toBe('"a,b"');
    expect(escapeField('say "hi"')).toBe('"say ""hi"""');
  });
  it("quotes fields containing newlines", () => {
    expect(escapeField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("parseCsv", () => {
  it("parses quoted fields with embedded commas, quotes and newlines", () => {
    const rows = parseCsv('a,"b,c","d""e"\n"multi\nline",x,y\n');
    expect(rows[0]).toEqual(["a", "b,c", 'd"e']);
    expect(rows[1]).toEqual(["multi\nline", "x", "y"]);
  });
});

describe("appendSong + readKnownTrackIds", () => {
  it("writes BOM + header on first write, appends rows after", () => {
    appendSong(TMP, sampleSong);
    const raw = readFileSync(TMP);
    expect(raw[0]).toBe(0xef); // BOM byte 1
    const text = raw.toString("utf8");
    expect(text).toContain("track_id,title,url,requester,duration_seconds,provider,first_seen_at");
    expect(text).toContain('"Song, with ""quotes"""');
    expect(text).toContain("Möller");

    appendSong(TMP, { ...sampleSong, trackId: "xyz789", title: "Second" });
    const ids = readKnownTrackIds(TMP);
    expect(ids.has("abc123")).toBe(true);
    expect(ids.has("xyz789")).toBe(true);
    expect(ids.size).toBe(2); // header row excluded
  });

  it("returns empty set when file does not exist", () => {
    expect(readKnownTrackIds("./test/does-not-exist.csv").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/csv.test.ts`
Expected: FAIL — cannot find module `../src/csv.js`.

- [ ] **Step 3: Implement `src/csv.ts`**

```ts
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import type { Song } from "./types.js";

const BOM = "﻿";
const HEADER = ["track_id", "title", "url", "requester", "duration_seconds", "provider", "first_seen_at"];

export function escapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function formatRow(fields: string[]): string {
  return fields.map(escapeField).join(",");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  // strip a leading BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function songToFields(song: Song): string[] {
  return [
    song.trackId,
    song.title,
    song.url,
    song.requester,
    String(song.durationSeconds),
    song.provider,
    song.firstSeenAt,
  ];
}

export function appendSong(path: string, song: Song): void {
  if (!existsSync(path)) {
    writeFileSync(path, BOM + formatRow(HEADER) + "\n", "utf8");
  }
  appendFileSync(path, formatRow(songToFields(song)) + "\n", "utf8");
}

export function readKnownTrackIds(path: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(path)) return ids;
  const rows = parseCsv(readFileSync(path, "utf8"));
  for (let r = 1; r < rows.length; r++) { // skip header row
    const id = rows[r][0];
    if (id) ids.add(id);
  }
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/csv.ts test/csv.test.ts
git commit -m "feat: RFC-4180 CSV helpers with UTF-8 BOM and track-id dedup"
```

---

## Task 4: Song extraction + queue fetch

**Files:**
- Create: `src/nightbot.ts`, `test/nightbot.test.ts`, `test/fixtures/queue-response.json`

- [ ] **Step 1: Create the fixture `test/fixtures/queue-response.json`**

```json
{
  "_currentSong": {
    "_id": "req_current",
    "track": {
      "providerId": "VID_CURRENT",
      "provider": "youtube",
      "title": "Now Playing, Live",
      "url": "https://youtu.be/VID_CURRENT",
      "duration": 210
    },
    "user": { "displayName": "AliceStreamer", "name": "alice" }
  },
  "queue": [
    {
      "_id": "req_1",
      "track": {
        "providerId": "VID_ONE",
        "provider": "youtube",
        "title": "Queued One",
        "url": "https://youtu.be/VID_ONE",
        "duration": 180
      },
      "user": { "displayName": "Bob", "name": "bob" }
    },
    {
      "_id": "req_2",
      "track": {
        "providerId": "SC_TWO",
        "provider": "soundcloud",
        "title": "Queued Two",
        "url": "https://soundcloud.com/x/two",
        "duration": 240
      },
      "user": { "name": "carol" }
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`test/nightbot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { extractSongs } from "../src/nightbot.js";

const fixture = JSON.parse(readFileSync("./test/fixtures/queue-response.json", "utf8"));
const NOW = "2026-07-06T12:00:00.000Z";

describe("extractSongs", () => {
  it("captures the current song and every queue item", () => {
    const songs = extractSongs(fixture, NOW);
    expect(songs.map((s) => s.trackId)).toEqual(["VID_CURRENT", "VID_ONE", "SC_TWO"]);
  });

  it("maps track and user fields correctly", () => {
    const songs = extractSongs(fixture, NOW);
    expect(songs[0]).toEqual({
      trackId: "VID_CURRENT",
      title: "Now Playing, Live",
      url: "https://youtu.be/VID_CURRENT",
      requester: "AliceStreamer",
      durationSeconds: 210,
      provider: "youtube",
      firstSeenAt: NOW,
    });
  });

  it("falls back to user.name when displayName is absent", () => {
    const songs = extractSongs(fixture, NOW);
    expect(songs[2].requester).toBe("carol");
  });

  it("handles an empty/missing queue and missing current song", () => {
    expect(extractSongs({}, NOW)).toEqual([]);
    expect(extractSongs({ queue: [] }, NOW)).toEqual([]);
  });

  it("skips items without a track providerId", () => {
    const songs = extractSongs({ queue: [{ _id: "x", track: {} }] }, NOW);
    expect(songs).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/nightbot.test.ts`
Expected: FAIL — cannot find module `../src/nightbot.js`.

- [ ] **Step 4: Implement `src/nightbot.ts`**

```ts
import type { Song } from "./types.js";

interface RawTrack {
  providerId?: string;
  provider?: string;
  title?: string;
  url?: string;
  duration?: number;
}
interface RawItem {
  track?: RawTrack;
  user?: { displayName?: string; name?: string };
}
interface RawQueue {
  _currentSong?: RawItem;
  queue?: RawItem[];
}

function mapItem(item: RawItem | undefined, nowIso: string): Song | null {
  const track = item?.track;
  if (!track || !track.providerId) return null;
  return {
    trackId: track.providerId,
    title: track.title ?? "",
    url: track.url ?? "",
    requester: item?.user?.displayName ?? item?.user?.name ?? "",
    durationSeconds: track.duration ?? 0,
    provider: track.provider ?? "",
    firstSeenAt: nowIso,
  };
}

export function extractSongs(response: RawQueue, nowIso: string): Song[] {
  const items: (RawItem | undefined)[] = [response._currentSong, ...(response.queue ?? [])];
  const songs: Song[] = [];
  for (const item of items) {
    const song = mapItem(item, nowIso);
    if (song) songs.push(song);
  }
  return songs;
}

export async function fetchQueue(accessToken: string, apiBaseUrl: string): Promise<RawQueue> {
  const res = await fetch(`${apiBaseUrl}/1/song_requests/queue`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 429) {
    const err = new Error("Rate limited") as Error & { status?: number };
    err.status = 429;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Queue request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as RawQueue;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/nightbot.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/nightbot.ts test/nightbot.test.ts test/fixtures/queue-response.json
git commit -m "feat: extract songs from queue response (current + queue items)"
```

---

## Task 5: Auth — pure helpers (URL building, token expiry, storage)

**Files:**
- Create: `src/auth.ts`, `test/auth.test.ts`

- [ ] **Step 1: Write the failing test**

`test/auth.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { buildAuthorizeUrl, needsRefresh, writeTokens, readTokens } from "../src/auth.js";
import type { Config, Tokens } from "../src/types.js";

const cfg: Config = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "http://localhost:8080/callback",
  pollIntervalSeconds: 5,
  csvPath: "./song-requests.csv",
  tokensPath: "./test/tmp-tokens.json",
  apiBaseUrl: "https://api.nightbot.tv",
  authBaseUrl: "https://api.nightbot.tv",
};

afterEach(() => { if (existsSync(cfg.tokensPath)) rmSync(cfg.tokensPath); });

describe("buildAuthorizeUrl", () => {
  it("includes client_id, redirect_uri, response_type, scope and state", () => {
    const url = new URL(buildAuthorizeUrl(cfg, "STATE123"));
    expect(url.origin + url.pathname).toBe("https://api.nightbot.tv/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8080/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("song_requests_queue");
    expect(url.searchParams.get("state")).toBe("STATE123");
  });
});

describe("needsRefresh", () => {
  it("is true when the token is expired or within the skew window", () => {
    const now = 1_000_000;
    expect(needsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: now - 1 }, now)).toBe(true);
    expect(needsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: now + 30_000 }, now)).toBe(true);
  });
  it("is false when the token is comfortably valid", () => {
    const now = 1_000_000;
    expect(needsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: now + 3_600_000 }, now)).toBe(false);
  });
});

describe("token storage round-trip", () => {
  it("writes and reads tokens", () => {
    const tokens: Tokens = { accessToken: "a", refreshToken: "r", expiresAt: 42 };
    writeTokens(cfg.tokensPath, tokens);
    expect(readTokens(cfg.tokensPath)).toEqual(tokens);
  });
  it("readTokens returns null when the file is missing", () => {
    expect(readTokens("./test/no-such-tokens.json")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — cannot find module `../src/auth.js`.

- [ ] **Step 3: Implement `src/auth.ts`**

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { Config, Tokens } from "./types.js";

const SCOPE = "song_requests_queue";
const REFRESH_SKEW_MS = 60_000;

export function buildAuthorizeUrl(config: Config, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${config.authBaseUrl}/oauth2/authorize?${params.toString()}`;
}

export function needsRefresh(tokens: Tokens, now: number, skewMs: number = REFRESH_SKEW_MS): boolean {
  return now >= tokens.expiresAt - skewMs;
}

export function readTokens(path: string): Tokens | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Tokens;
}

export function writeTokens(path: string, tokens: Tokens): void {
  writeFileSync(path, JSON.stringify(tokens, null, 2), "utf8");
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function postToken(config: Config, body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${config.authBaseUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function exchangeCode(config: Config, code: string): Promise<Tokens> {
  return postToken(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });
}

export async function refreshTokens(config: Config, refreshToken: string): Promise<Tokens> {
  return postToken(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function getValidAccessToken(config: Config): Promise<string> {
  const tokens = readTokens(config.tokensPath);
  if (!tokens) {
    throw new Error('No tokens found. Run "npm run login" first.');
  }
  if (needsRefresh(tokens, Date.now())) {
    const refreshed = await refreshTokens(config, tokens.refreshToken);
    writeTokens(config.tokensPath, refreshed);
    return refreshed.accessToken;
  }
  return tokens.accessToken;
}

function openBrowser(url: string): void {
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

export async function login(config: Config): Promise<void> {
  const state = randomUUID();
  const redirect = new URL(config.redirectUri);
  const port = Number(redirect.port || "80");

  const authUrl = buildAuthorizeUrl(config, state);

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (reqUrl.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = reqUrl.searchParams.get("code");
      const returnedState = reqUrl.searchParams.get("state");
      if (returnedState !== state || !code) {
        res.writeHead(400).end("Invalid state or missing code. Close this tab and retry.");
        server.close();
        reject(new Error("OAuth callback failed: state mismatch or missing code."));
        return;
      }
      try {
        const tokens = await exchangeCode(config, code);
        writeTokens(config.tokensPath, tokens);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end("<h1>Nightbot login complete.</h1><p>You can close this tab and return to the terminal.</p>");
        server.close();
        console.log(`Tokens saved to ${config.tokensPath}.`);
        resolve();
      } catch (err) {
        res.writeHead(500).end("Token exchange failed. Check the terminal.");
        server.close();
        reject(err);
      }
    });
    server.listen(port, () => {
      console.log(`Waiting for Nightbot authorization on ${config.redirectUri} ...`);
      console.log(`If your browser did not open, visit:\n${authUrl}\n`);
      openBrowser(authUrl);
    });
    server.on("error", reject);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS (the `login`/`fetch` code paths are not exercised by these unit tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "feat: OAuth2 auth — authorize URL, token exchange/refresh, local callback login"
```

---

## Task 6: Watch — new-song collection + polling loop

**Files:**
- Create: `src/watch.ts`, `test/watch.test.ts`

- [ ] **Step 1: Write the failing test**

`test/watch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectNewSongs } from "../src/watch.js";

const NOW = "2026-07-06T12:00:00.000Z";
const response = {
  _currentSong: { track: { providerId: "A", provider: "youtube", title: "Cur", url: "u", duration: 1 }, user: { name: "x" } },
  queue: [
    { track: { providerId: "B", provider: "youtube", title: "One", url: "u", duration: 1 }, user: { name: "y" } },
    { track: { providerId: "A", provider: "youtube", title: "Dup", url: "u", duration: 1 }, user: { name: "z" } },
  ],
};

describe("collectNewSongs", () => {
  it("returns only songs whose trackId is not already known, deduped within the batch", () => {
    const known = new Set<string>(["B"]);
    const fresh = collectNewSongs(response, known, NOW);
    expect(fresh.map((s) => s.trackId)).toEqual(["A"]); // B known, second A is a batch duplicate
  });

  it("returns nothing when everything is already known", () => {
    const known = new Set<string>(["A", "B"]);
    expect(collectNewSongs(response, known, NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/watch.test.ts`
Expected: FAIL — cannot find module `../src/watch.js`.

- [ ] **Step 3: Implement `src/watch.ts`**

```ts
import type { Config, Song } from "./types.js";
import { extractSongs, fetchQueue } from "./nightbot.js";
import { getValidAccessToken } from "./auth.js";
import { readKnownTrackIds, appendSong } from "./csv.js";

export function collectNewSongs(response: unknown, known: Set<string>, nowIso: string): Song[] {
  const songs = extractSongs(response as never, nowIso);
  const fresh: Song[] = [];
  for (const song of songs) {
    if (!known.has(song.trackId)) {
      known.add(song.trackId);
      fresh.push(song);
    }
  }
  return fresh;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function watch(config: Config): Promise<void> {
  const known = readKnownTrackIds(config.csvPath);
  console.log(`Loaded ${known.size} known track(s) from ${config.csvPath}.`);
  console.log(`Polling every ${config.pollIntervalSeconds}s. Press Ctrl-C to stop.`);

  let stop = false;
  process.on("SIGINT", () => { stop = true; console.log("\nStopping..."); });

  while (!stop) {
    try {
      const accessToken = await getValidAccessToken(config);
      const response = await fetchQueue(accessToken, config.apiBaseUrl);
      const fresh = collectNewSongs(response, known, new Date().toISOString());
      for (const song of fresh) {
        appendSong(config.csvPath, song);
        console.log(`+ ${song.title} — ${song.requester} (${song.url})`);
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429) {
        console.warn("Rate limited (429). Backing off 30s.");
        await sleep(30_000);
        continue;
      }
      console.error(`Poll error: ${(err as Error).message}`);
    }
    await sleep(config.pollIntervalSeconds * 1000);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/watch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watch.ts test/watch.test.ts
git commit -m "feat: watch loop — collect new songs, append to CSV, backoff on 429"
```

---

## Task 7: CLI entrypoint

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement `src/index.ts`**

```ts
import { loadConfig } from "./config.js";
import { login } from "./auth.js";
import { watch } from "./watch.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "watch";
  const config = loadConfig();

  switch (command) {
    case "login":
      await login(config);
      break;
    case "watch":
      await watch(config);
      break;
    default:
      console.error(`Unknown command "${command}". Use "login" or "watch".`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify typecheck and full test suite pass**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; all vitest suites PASS.

- [ ] **Step 3: Verify the CLI rejects an unknown command**

Run: `NIGHTBOT_CLIENT_ID=x NIGHTBOT_CLIENT_SECRET=y npx tsx src/index.ts bogus`
Expected: prints `Unknown command "bogus"...` and exits non-zero.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: CLI entrypoint dispatching login and watch"
```

---

## Task 8: Documentation (README in English, CLAUDE.md)

**Files:**
- Create: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Create `README.md` (English)**

````markdown
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
````

- [ ] **Step 2: Create `CLAUDE.md`**

````markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: README (English) and CLAUDE.md"
```

---

## Task 9: End-to-end verification (manual)

This task has no automated tests — it verifies the OAuth flow and polling against
the real Nightbot API, which cannot be unit-tested.

- [ ] **Step 1: Confirm the full automated suite is green**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; all suites PASS.

- [ ] **Step 2: Register the app and fill in `.env`**

Create the Nightbot application (Redirect URI `http://localhost:8080/callback`),
`cp .env.example .env`, and paste the real client ID/secret.

- [ ] **Step 3: Run login and authorize**

Run: `npm run login`
Expected: browser opens, you approve, the page shows "Nightbot login complete",
and `tokens.json` appears with `accessToken`, `refreshToken`, `expiresAt`.

- [ ] **Step 4: Run watch and confirm CSV growth**

Run: `npm run watch`
Add a song request in your Nightbot dashboard.
Expected: a `+ <title> — <requester>` line prints and `song-requests.csv` gains a
row. Verify the file opens with correct umlauts in a text editor / spreadsheet.

- [ ] **Step 5: Confirm dedup across restarts**

Stop (`Ctrl-C`) and re-run `npm run watch`.
Expected: it logs `Loaded N known track(s)` and does not re-append songs already
in the CSV.

---

## Self-Review Notes

- **Spec coverage:** OAuth2 via `.env` (Task 2, 5), local callback login (Task 5),
  polling every N seconds (Task 6), UTF-8 BOM CSV (Task 3), skip existing / append
  new via `track_id` dedup (Task 3, 6), capture `_currentSong` + `queue` (Task 4),
  token auto-refresh (Task 5), 429 backoff & resilient loop (Task 6),
  `.gitignore`/README/CLAUDE.md (already done / Task 8). All covered.
- **Type consistency:** `Song`, `Tokens`, `Config` defined once in `src/types.ts`;
  `extractSongs(response, nowIso)`, `collectNewSongs(response, known, nowIso)`,
  `appendSong(path, song)`, `readKnownTrackIds(path)`, `getValidAccessToken(config)`,
  `fetchQueue(accessToken, apiBaseUrl)` used consistently across tasks.
- **No placeholders:** every code step contains complete code.
