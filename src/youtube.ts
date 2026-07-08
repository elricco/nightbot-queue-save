const API_BASE = "https://www.googleapis.com/youtube/v3";

export class QuotaExceededError extends Error {
  readonly pauseSync = true as const;
  constructor(message?: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
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
