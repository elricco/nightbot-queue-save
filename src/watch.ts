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
