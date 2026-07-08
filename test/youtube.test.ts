import { describe, it, expect } from "vitest";
import { aggregateVideoIds, isQuotaError } from "../src/youtube.js";

describe("aggregateVideoIds", () => {
  it("flattens video ids across pages and skips missing ones", () => {
    const ids = aggregateVideoIds([
      { items: [{ contentDetails: { videoId: "a" } }, { contentDetails: { videoId: "b" } }] },
      { items: [{ contentDetails: {} }, { contentDetails: { videoId: "c" } }] },
    ]);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("handles empty/absent items", () => {
    expect(aggregateVideoIds([{}, { items: [] }])).toEqual([]);
  });
});

describe("isQuotaError", () => {
  it("is true for a 403 with a quotaExceeded reason", () => {
    expect(isQuotaError(403, '{"error":{"errors":[{"reason":"quotaExceeded"}]}}')).toBe(true);
    expect(isQuotaError(403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}')).toBe(true);
  });

  it("is false for other 403s and non-403 statuses", () => {
    expect(isQuotaError(403, '{"error":{"errors":[{"reason":"forbidden"}]}}')).toBe(false);
    expect(isQuotaError(404, "quotaExceeded")).toBe(false);
  });
});
