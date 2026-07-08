import { describe, it, expect } from "vitest";
import { createPlaylistSink } from "../src/youtube-sync.js";
import type { Song } from "../src/types.js";

function song(trackId: string, provider = "youtube"): Song {
  return { trackId, title: `t-${trackId}`, url: "u", requester: "r", durationSeconds: 1, provider, firstSeenAt: "" };
}

describe("createPlaylistSink", () => {
  it("inserts only unknown YouTube videos and skips other providers", async () => {
    const inserted: string[] = [];
    const sink = createPlaylistSink({
      known: new Set(["B"]),
      insert: async (id) => { inserted.push(id); },
    });
    await sink.push([song("A"), song("B"), song("C", "soundcloud"), song("D")]);
    expect(inserted).toEqual(["A", "D"]); // B known, C non-youtube
  });

  it("does not re-insert within the same run once added", async () => {
    const inserted: string[] = [];
    const sink = createPlaylistSink({ known: new Set(), insert: async (id) => { inserted.push(id); } });
    await sink.push([song("A")]);
    await sink.push([song("A")]);
    expect(inserted).toEqual(["A"]);
  });

  it("pauses after a pauseSync error and stops inserting", async () => {
    const inserted: string[] = [];
    const quota = Object.assign(new Error("quota"), { pauseSync: true });
    const sink = createPlaylistSink({
      known: new Set(),
      insert: async (id) => { if (id === "A") throw quota; inserted.push(id); },
    });
    await sink.push([song("A"), song("B")]); // A throws → pause before B
    await sink.push([song("C")]);            // still paused
    expect(inserted).toEqual([]);
  });

  it("retries a transient failure on the next push (id not remembered)", async () => {
    const calls: string[] = [];
    let fail = true;
    const sink = createPlaylistSink({
      known: new Set(),
      insert: async (id) => { calls.push(id); if (fail) { fail = false; throw new Error("network"); } },
    });
    await sink.push([song("A")]); // fails, not remembered
    await sink.push([song("A")]); // retried, succeeds
    expect(calls).toEqual(["A", "A"]);
  });
});
