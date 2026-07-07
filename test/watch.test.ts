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
