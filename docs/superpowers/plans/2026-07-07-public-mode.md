# Public Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second run mode `npm run scrape <url>` that watches any *publicly* viewable Nightbot song-request queue (by its public URL) and writes new songs to a per-channel CSV — no OAuth login required.

**Architecture:** The public Nightbot page is a React SPA, but it reads from two public, auth-free JSON endpoints. `GET /1/channels/{provider}/{username}` returns the channel `_id`; `GET /1/song_requests/queue` with header `Nightbot-Channel: <id>` returns the same `{ _currentSong, queue }` shape as the authenticated endpoint. So no scraping: we reuse `extractSongs`, the CSV/dedup layer, and the polling loop unchanged. The API-specific `watch` loop is refactored into a generic `runWatchLoop(config, fetchOnce)` that both modes share.

**Tech Stack:** TypeScript (strict, ES modules, NodeNext-style `.js` imports), Node built-in `fetch`, Vitest, tsx.

## Global Constraints

- ES modules, TypeScript strict. Local imports MUST use the `.js` extension.
- Use the Node built-in `fetch` only — no HTTP library.
- TDD for pure/logical code (URL parsing, config building). I/O functions (channel resolve, queue fetch, polling loop) are verified manually E2E, consistent with the existing repo convention (see `CLAUDE.md`).
- Tests live in `test/**/*.test.ts` and import from `../src/<mod>.js`.
- Never commit `.env`, `tokens.json`, or `*.csv`.
- The provider code from the URL (e.g. `t`) is NOT normalized — the API accepts it verbatim.

---

## File Structure

- **Modify** `src/types.ts` — extract a `WatchConfig` interface (the fields the polling loop needs); make `Config` extend it.
- **Modify** `src/nightbot.ts` — export the existing `RawQueue` interface so `public.ts` and `watch.ts` can type against it.
- **Create** `src/public.ts` — `parsePublicUrl` (pure), `resolveChannelId`, `fetchPublicQueue`.
- **Modify** `src/config.ts` — add `buildPublicConfig` (pure) and `loadPublicConfig`.
- **Modify** `src/watch.ts` — extract `runWatchLoop(config, fetchOnce)`; keep `watch`; add `scrape`.
- **Modify** `src/index.ts` — add the `scrape` CLI branch; move `loadConfig()` into the per-command cases.
- **Modify** `package.json` — add the `scrape` script.
- **Create** `test/public.test.ts` — `parsePublicUrl` cases.
- **Create/extend** `test/config.test.ts` — `buildPublicConfig` cases (new tests appended).
- **Modify** `.env.example`, `README.md`, `CLAUDE.md` — document the new mode.

---

## Task 1: `parsePublicUrl` (pure URL parsing)

**Files:**
- Create: `src/public.ts`
- Test: `test/public.test.ts`

**Interfaces:**
- Produces: `parsePublicUrl(input: string): { provider: string; username: string }` — accepts a full browser URL (`https://nightbot.tv/t/elricco1978/song_requests`) or the short form (`t/elricco1978`); throws on unusable input.

- [ ] **Step 1: Write the failing test**

Create `test/public.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parsePublicUrl } from "../src/public.js";

describe("parsePublicUrl", () => {
  it("parses a full public queue URL", () => {
    expect(parsePublicUrl("https://nightbot.tv/t/elricco1978/song_requests")).toEqual({
      provider: "t",
      username: "elricco1978",
    });
  });

  it("parses a URL without the /song_requests suffix", () => {
    expect(parsePublicUrl("https://nightbot.tv/t/elricco1978")).toEqual({
      provider: "t",
      username: "elricco1978",
    });
  });

  it("accepts the bare provider/username short form", () => {
    expect(parsePublicUrl("t/elricco1978")).toEqual({ provider: "t", username: "elricco1978" });
  });

  it("ignores extra path segments and a trailing slash", () => {
    expect(parsePublicUrl("https://nightbot.tv/t/elricco1978/song_requests/")).toEqual({
      provider: "t",
      username: "elricco1978",
    });
  });

  it("throws on empty input", () => {
    expect(() => parsePublicUrl("   ")).toThrow(/URL/i);
  });

  it("throws when a segment is missing", () => {
    expect(() => parsePublicUrl("https://nightbot.tv/t")).toThrow(/Invalid/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- public`
Expected: FAIL — cannot resolve `../src/public.js` / `parsePublicUrl is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/public.ts`:

```typescript
export function parsePublicUrl(input: string): { provider: string; username: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty URL");

  // Strip scheme + host if a full URL was given; otherwise treat input as a path.
  let path = trimmed;
  const withHost = trimmed.match(/^https?:\/\/[^/]+\/(.*)$/i);
  if (withHost) path = withHost[1];

  const segments = path.split("/").filter((s) => s.length > 0);
  const [provider, username] = segments;
  if (!provider || !username) {
    throw new Error(
      `Invalid Nightbot queue URL: "${input}". ` +
        `Expected e.g. https://nightbot.tv/t/<username>/song_requests`,
    );
  }
  return { provider, username };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- public`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/public.ts test/public.test.ts
git commit -m "feat: parsePublicUrl for public Nightbot queue URLs"
```

---

## Task 2: `buildPublicConfig` / `loadPublicConfig`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `test/config.test.ts` (append new tests)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `WatchConfig` interface in `types.ts`: `{ pollIntervalSeconds: number; csvPath: string; apiBaseUrl: string }`.
  - `buildPublicConfig(env: Record<string, string | undefined>, username: string): WatchConfig`.
  - `loadPublicConfig(username: string): WatchConfig`.

- [ ] **Step 1: Extract `WatchConfig` in `types.ts`**

Replace the `Config` interface (lines 1-10) in `src/types.ts` with:

```typescript
export interface WatchConfig {
  pollIntervalSeconds: number;
  csvPath: string;
  apiBaseUrl: string;
}

export interface Config extends WatchConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokensPath: string;
  authBaseUrl: string;
}
```

(`Config` keeps every field it had before — `buildConfig` in `config.ts` needs no change.)

- [ ] **Step 2: Write the failing test**

Append to `test/config.test.ts` (add the import at the top and a new `describe` block):

```typescript
import { buildConfig, buildPublicConfig } from "../src/config.js";
```

```typescript
describe("buildPublicConfig", () => {
  it("derives a per-channel CSV path and 10s default poll interval", () => {
    const cfg = buildPublicConfig({}, "elricco1978");
    expect(cfg.csvPath).toBe("./song-requests-elricco1978.csv");
    expect(cfg.pollIntervalSeconds).toBe(10);
    expect(cfg.apiBaseUrl).toBe("https://api.nightbot.tv");
  });

  it("lets CSV_PATH override the per-channel default", () => {
    const cfg = buildPublicConfig({ CSV_PATH: "/tmp/out.csv" }, "elricco1978");
    expect(cfg.csvPath).toBe("/tmp/out.csv");
  });

  it("reads PUBLIC_POLL_INTERVAL_SECONDS", () => {
    const cfg = buildPublicConfig({ PUBLIC_POLL_INTERVAL_SECONDS: "20" }, "x");
    expect(cfg.pollIntervalSeconds).toBe(20);
  });

  it("throws when PUBLIC_POLL_INTERVAL_SECONDS is not a positive number", () => {
    expect(() => buildPublicConfig({ PUBLIC_POLL_INTERVAL_SECONDS: "0" }, "x")).toThrow(
      /PUBLIC_POLL_INTERVAL_SECONDS/,
    );
    expect(() => buildPublicConfig({ PUBLIC_POLL_INTERVAL_SECONDS: "abc" }, "x")).toThrow(
      /PUBLIC_POLL_INTERVAL_SECONDS/,
    );
  });
});
```

Note: the existing `config.test.ts` imports only `buildConfig` on line 2 — replace that import line with the combined import above.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- config`
Expected: FAIL — `buildPublicConfig is not a function`.

- [ ] **Step 4: Implement in `config.ts`**

In `src/config.ts`, update the type import and add the two functions. Change line 2:

```typescript
import type { Config, WatchConfig } from "./types.js";
```

Append after `buildConfig` (before `loadConfig`):

```typescript
export function buildPublicConfig(
  env: Record<string, string | undefined>,
  username: string,
): WatchConfig {
  const pollIntervalSeconds = Number(env.PUBLIC_POLL_INTERVAL_SECONDS ?? "10");
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds <= 0) {
    throw new Error(
      `Invalid PUBLIC_POLL_INTERVAL_SECONDS: must be a positive number, got "${env.PUBLIC_POLL_INTERVAL_SECONDS}"`,
    );
  }

  return {
    pollIntervalSeconds,
    csvPath: env.CSV_PATH ?? `./song-requests-${username}.csv`,
    apiBaseUrl: "https://api.nightbot.tv",
  };
}
```

Append after `loadConfig`:

```typescript
export function loadPublicConfig(username: string): WatchConfig {
  loadDotenv();
  return buildPublicConfig(process.env, username);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- config`
Expected: PASS (existing `buildConfig` tests + 4 new `buildPublicConfig` tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat: loadPublicConfig with per-channel CSV and PUBLIC_POLL_INTERVAL_SECONDS"
```

---

## Task 3: Refactor `watch.ts` into a shared `runWatchLoop`

Pure refactor — no behavior change. The gate is: existing tests stay green and `typecheck` passes.

**Files:**
- Modify: `src/nightbot.ts` (export `RawQueue`)
- Modify: `src/watch.ts`

**Interfaces:**
- Consumes: `WatchConfig` (Task 2), `RawQueue` (exported here).
- Produces: `runWatchLoop(config: WatchConfig, fetchOnce: () => Promise<RawQueue>): Promise<void>`. Also keeps `watch(config: Config): Promise<void>` and `collectNewSongs(...)` unchanged.

- [ ] **Step 1: Export `RawQueue` from `nightbot.ts`**

In `src/nightbot.ts`, change line 15 from `interface RawQueue {` to:

```typescript
export interface RawQueue {
```

- [ ] **Step 2: Refactor `watch.ts`**

Replace the entire body of `src/watch.ts` with (note: `collectNewSongs` is byte-for-byte identical to today; the loop body is moved into `runWatchLoop`, and `watch` now delegates):

```typescript
import type { Config, Song, WatchConfig } from "./types.js";
import { extractSongs, fetchQueue, type RawQueue } from "./nightbot.js";
import { getValidAccessToken, AuthError } from "./auth.js";
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

export async function runWatchLoop(
  config: WatchConfig,
  fetchOnce: () => Promise<RawQueue>,
): Promise<void> {
  const known = readKnownTrackIds(config.csvPath);
  console.log(`Loaded ${known.size} known track(s) from ${config.csvPath}.`);
  console.log(`Polling every ${config.pollIntervalSeconds}s. Press Ctrl-C to stop.`);

  let stop = false;
  let wake: (() => void) | null = null;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => { wake = null; resolve(); }, ms);
      wake = () => { clearTimeout(timer); wake = null; resolve(); };
    });

  process.on("SIGINT", () => {
    stop = true;
    console.log("\nStopping...");
    wake?.();
  });

  const BASE_BACKOFF_MS = 30_000;
  const MAX_BACKOFF_MS = 300_000;
  let backoffMs = BASE_BACKOFF_MS;

  while (!stop) {
    try {
      const response = await fetchOnce();
      const fresh = collectNewSongs(response, known, new Date().toISOString());
      for (const song of fresh) {
        appendSong(config.csvPath, song);
        console.log(`+ ${song.title} — ${song.requester} (${song.url})`);
      }
      backoffMs = BASE_BACKOFF_MS; // reset after a successful poll
    } catch (err) {
      if (err instanceof AuthError) {
        console.error(err.message);
        process.exitCode = 1;
        break;
      }
      const status = (err as { status?: number }).status;
      if (status === 429) {
        console.warn(`Rate limited (429). Backing off ${backoffMs / 1000}s.`);
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        continue;
      }
      console.error(`Poll error: ${(err as Error).message}`);
    }
    if (stop) break;
    await sleep(config.pollIntervalSeconds * 1000);
  }
}

export async function watch(config: Config): Promise<void> {
  await runWatchLoop(config, async () => {
    const accessToken = await getValidAccessToken(config);
    return fetchQueue(accessToken, config.apiBaseUrl);
  });
}
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests, including `test/watch.test.ts` (`collectNewSongs`), still green.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/nightbot.ts src/watch.ts
git commit -m "refactor: extract runWatchLoop shared by watch and (upcoming) scrape"
```

---

## Task 4: `resolveChannelId` and `fetchPublicQueue`

I/O functions — verified manually E2E against the live public endpoint (no unit test, matching how `fetchQueue` is treated).

**Files:**
- Modify: `src/public.ts`

**Interfaces:**
- Consumes: `RawQueue` from `nightbot.ts` (exported in Task 3).
- Produces:
  - `resolveChannelId(provider: string, username: string, apiBaseUrl: string): Promise<string>`
  - `fetchPublicQueue(channelId: string, apiBaseUrl: string): Promise<RawQueue>`

- [ ] **Step 1: Add the two functions to `public.ts`**

Add to the top of `src/public.ts`:

```typescript
import type { RawQueue } from "./nightbot.js";
```

Append at the end of `src/public.ts`:

```typescript
export async function resolveChannelId(
  provider: string,
  username: string,
  apiBaseUrl: string,
): Promise<string> {
  const url = `${apiBaseUrl}/1/channels/${encodeURIComponent(provider)}/${encodeURIComponent(username)}`;
  const res = await fetch(url);
  if (res.status === 404) {
    throw new Error(`Channel not found: ${provider}/${username}`);
  }
  if (!res.ok) {
    throw new Error(`Channel lookup failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { channel?: { _id?: string } };
  const id = data.channel?._id;
  if (!id) throw new Error(`Channel lookup returned no id for ${provider}/${username}`);
  return id;
}

export async function fetchPublicQueue(channelId: string, apiBaseUrl: string): Promise<RawQueue> {
  const res = await fetch(`${apiBaseUrl}/1/song_requests/queue`, {
    headers: { "Nightbot-Channel": channelId },
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

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual E2E verification against the live public API**

Run (uses a known public channel):

```bash
npx tsx -e "import { resolveChannelId, fetchPublicQueue } from './src/public.js'; const id = await resolveChannelId('t','elricco1978','https://api.nightbot.tv'); console.log('channelId', id); const q = await fetchPublicQueue(id,'https://api.nightbot.tv'); console.log('items', (q.queue?.length ?? 0) + (q._currentSong ? 1 : 0));"
```

Expected: prints a `channelId` (24-hex string) and a non-negative item count without throwing. Also confirm the not-found path:

```bash
npx tsx -e "import { resolveChannelId } from './src/public.js'; try { await resolveChannelId('t','definitely-not-a-real-channel-xyz','https://api.nightbot.tv'); console.log('NO ERROR (unexpected)'); } catch (e) { console.log('threw:', e.message); }"
```

Expected: prints `threw: Channel not found: t/definitely-not-a-real-channel-xyz`.

- [ ] **Step 4: Commit**

```bash
git add src/public.ts
git commit -m "feat: resolveChannelId and fetchPublicQueue via public Nightbot endpoints"
```

---

## Task 5: `scrape` wiring + CLI dispatch

**Files:**
- Modify: `src/watch.ts` (add `scrape`)
- Modify: `src/index.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runWatchLoop` (Task 3), `resolveChannelId` + `fetchPublicQueue` (Task 4), `parsePublicUrl` (Task 1), `loadPublicConfig` (Task 2).
- Produces: `scrape(config: WatchConfig, provider: string, username: string): Promise<void>`.

- [ ] **Step 1: Add `scrape` to `watch.ts`**

In `src/watch.ts`, add to the imports:

```typescript
import { resolveChannelId, fetchPublicQueue } from "./public.js";
```

Append at the end of the file:

```typescript
export async function scrape(
  config: WatchConfig,
  provider: string,
  username: string,
): Promise<void> {
  const channelId = await resolveChannelId(provider, username, config.apiBaseUrl);
  console.log(`Resolved ${provider}/${username} to channel ${channelId}.`);
  await runWatchLoop(config, () => fetchPublicQueue(channelId, config.apiBaseUrl));
}
```

- [ ] **Step 2: Rewrite `index.ts` dispatch**

Replace the entire `src/index.ts` with:

```typescript
import { loadConfig, loadPublicConfig } from "./config.js";
import { login } from "./auth.js";
import { watch, scrape } from "./watch.js";
import { parsePublicUrl } from "./public.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "watch";

  switch (command) {
    case "login":
      await login(loadConfig());
      break;
    case "watch":
      await watch(loadConfig());
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
      await scrape(loadPublicConfig(username), provider, username);
      break;
    }
    default:
      console.error(`Unknown command "${command}". Use "login", "watch", or "scrape <url>".`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add to `"scripts"` after the `"watch"` line:

```json
    "scrape": "tsx src/index.ts scrape",
```

- [ ] **Step 4: Typecheck and run tests**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Manual E2E — usage error path**

Run: `npm run scrape`
Expected: prints the `Usage: npm run scrape <public-queue-url>` message and exits non-zero.

- [ ] **Step 6: Manual E2E — full run against a public queue**

Run (Ctrl-C after you see it load and start polling):

```bash
npm run scrape https://nightbot.tv/t/elricco1978/song_requests
```

Expected: logs `Resolved t/elricco1978 to channel <id>.`, then `Loaded N known track(s) from ./song-requests-elricco1978.csv.` and `Polling every 10s...`. Any current/queued songs get appended. Confirm the file:

```bash
head -3 ./song-requests-elricco1978.csv
```

Expected: a BOM + header row `track_id,title,url,requester,duration_seconds,provider,first_seen_at` followed by song rows. Then delete the throwaway CSV (it is git-ignored, but keep the tree clean): `rm -f ./song-requests-elricco1978.csv`.

- [ ] **Step 7: Commit**

```bash
git add src/watch.ts src/index.ts package.json
git commit -m "feat: scrape command watches a public Nightbot queue by URL"
```

---

## Task 6: Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `.env.example`**

Append to `.env.example`:

```dotenv

# --- Public mode (npm run scrape <url>) ---
# How often to poll a public queue, in seconds (higher default than the API mode
# out of politeness to the unauthenticated public endpoint).
PUBLIC_POLL_INTERVAL_SECONDS=10
# CSV_PATH above (if set) overrides the per-channel default
# ./song-requests-<username>.csv used by scrape mode.
```

- [ ] **Step 2: Update `README.md`**

In the **How it works** list, add a bullet after the `watch` bullet:

```markdown
- `scrape <url>` watches any *publicly viewable* queue by its public URL (e.g.
  `https://nightbot.tv/t/<username>/song_requests`) — no login required. It reads
  the same public JSON the Nightbot website uses.
```

In the `.env` variable table, add two rows after `CSV_PATH`:

```markdown
   | `PUBLIC_POLL_INTERVAL_SECONDS` | `10`              | Poll interval for `scrape` mode. |
```

Add a subsection at the end of **Usage**:

```markdown
### Watch a public queue (no login)

To follow someone else's publicly viewable queue, skip `login` and pass the
public URL:

```bash
npm run scrape https://nightbot.tv/t/<username>/song_requests
```

Each channel is written to its own CSV (`./song-requests-<username>.csv` by
default; `CSV_PATH` overrides). Press `Ctrl-C` to stop.
```
```

- [ ] **Step 3: Update `CLAUDE.md`**

Under **Befehle**, add after the `watch` line:

```markdown
- `npm run scrape <url>` — Public-Mode: pollt eine öffentlich einsehbare Queue
  über ihre URL, ohne OAuth. Schreibt pro Channel eine eigene CSV.
```

Under **Architektur**, add:

```markdown
- `src/public.ts` — `parsePublicUrl`, `resolveChannelId`, `fetchPublicQueue`
  (öffentliche Endpunkte, Header `Nightbot-Channel`).
```

And update the `src/watch.ts` line to mention the shared loop:

```markdown
- `src/watch.ts` — `collectNewSongs` (rein, testbar), `runWatchLoop` (geteilte
  Schleife) + `watch` (API) / `scrape` (Public).
```

- [ ] **Step 4: Verify nothing broke and commit**

Run: `npm run typecheck && npm test`
Expected: green.

```bash
git add .env.example README.md CLAUDE.md
git commit -m "docs: document public mode (npm run scrape <url>)"
```

---

## Self-Review

**Spec coverage:**
- Public endpoints & no-scraping approach → Tasks 1, 4 (parse + resolve + fetch).
- Shared `runWatchLoop` refactor → Task 3.
- Public config without OAuth, `PUBLIC_POLL_INTERVAL_SECONDS` default 10 → Task 2.
- Per-channel CSV default, `CSV_PATH` override → Task 2 (`buildPublicConfig`).
- `scrape` CLI command + `package.json` script → Task 5.
- Error handling (invalid URL, channel-not-found, 429, SIGINT) → Task 1 (parse throw), Task 4 (404 throw), Task 3 (429 backoff + SIGINT reused).
- Tests: `parsePublicUrl`, `buildPublicConfig` unit-tested; I/O manual E2E → Tasks 1, 2, 4, 5.
- Docs → Task 6.

All spec sections map to a task. No gaps.

**Type consistency:** `WatchConfig` (Task 2) is consumed by `runWatchLoop`/`scrape` (Tasks 3, 5). `RawQueue` exported in Task 3 and imported in Task 4 (`public.ts`) and Task 3 (`watch.ts`). `resolveChannelId`/`fetchPublicQueue` signatures defined in Task 4 match their calls in Task 5's `scrape`. `parsePublicUrl` return shape `{ provider, username }` (Task 1) matches destructuring in Task 5's `index.ts`. `loadPublicConfig(username)` (Task 2) matches the call in Task 5. Consistent.

**Placeholder scan:** No TBD/TODO; every code step contains full code; every command has expected output.
