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
