import { describe, expect, it } from "vitest";
import { normalizeReadableText, segmentText } from "./segmentation";

describe("text segmentation", () => {
  it("normalizes text without destroying paragraph breaks", () => {
    expect(normalizeReadableText("One   sentence.\n\n\nTwo\t\twords.")).toBe("One sentence.\n\nTwo words.");
  });

  it("creates stable tappable segments", () => {
    const segments = segmentText("First sentence. Second sentence!\n\nA final paragraph.");

    expect(segments.map((segment) => segment.text)).toEqual([
      "First sentence.",
      "Second sentence!",
      "A final paragraph."
    ]);
    expect(segments[0].id).toBe("seg-0-0");
    expect(segments[1].index).toBe(1);
  });

  it("splits very long sentences into readable chunks", () => {
    const longText = `Intro ${"word ".repeat(140)}end.`;
    const segments = segmentText(longText);

    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.text.length <= 520)).toBe(true);
  });
});
