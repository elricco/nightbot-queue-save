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
