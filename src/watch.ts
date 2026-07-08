import type { Config, Song, WatchConfig, YouTubeConfig } from "./types.js";
import { extractSongs, fetchQueue, type RawQueue } from "./nightbot.js";
import { getValidAccessToken, AuthError } from "./auth.js";
import { readKnownTrackIds, appendSong } from "./csv.js";
import { resolveChannelId, fetchPublicQueue } from "./public.js";
import { getValidYouTubeAccessToken } from "./youtube-auth.js";
import { listPlaylistVideoIds, insertPlaylistItem } from "./youtube.js";
import { createPlaylistSink, type PlaylistSink } from "./youtube-sync.js";

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

export async function runWatchLoop(
  config: WatchConfig,
  fetchOnce: () => Promise<RawQueue>,
  sink?: PlaylistSink,
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
      if (sink) {
        try {
          await sink.push(extractSongs(response as RawQueue, new Date().toISOString()));
        } catch (err) {
          console.error(`Playlist sync error: ${(err as Error).message}`);
        }
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
