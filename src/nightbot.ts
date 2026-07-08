import type { Song } from "./types.js";

interface RawTrack {
  providerId?: string;
  provider?: string;
  title?: string;
  url?: string;
  duration?: number;
}
interface RawItem {
  _id?: string;
  track?: RawTrack;
  user?: { displayName?: string; name?: string };
}
export interface RawQueue {
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

// Shared response check for both the authenticated and the public queue fetch:
// a 429 is re-thrown with a `status` field so the watch loop's backoff branch
// can recognize it (see runWatchLoop).
export function checkQueueResponse(res: Response): void {
  if (res.status === 429) {
    const err = new Error("Rate limited") as Error & { status?: number };
    err.status = 429;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Queue request failed: ${res.status} ${res.statusText}`);
  }
}

export async function fetchQueue(accessToken: string, apiBaseUrl: string): Promise<RawQueue> {
  const res = await fetch(`${apiBaseUrl}/1/song_requests/queue`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  checkQueueResponse(res);
  return (await res.json()) as RawQueue;
}
