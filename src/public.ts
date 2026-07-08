import type { RawQueue } from "./nightbot.js";

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
