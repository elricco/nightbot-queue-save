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
