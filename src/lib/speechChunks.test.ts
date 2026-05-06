import { describe, expect, it } from "vitest";
import { splitSpeechText } from "./speechChunks";

describe("speech chunks", () => {
  it("keeps short text as a single synthesis chunk", () => {
    expect(splitSpeechText("A short sentence.")).toEqual(["A short sentence."]);
  });

  it("splits long text at readable boundaries for mobile Piper inference", () => {
    const chunks = splitSpeechText(
      "This is a long opening sentence with enough words to cross the limit. This second sentence should become another chunk for ahead of time generation.",
      80
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 80)).toBe(true);
    expect(chunks.join(" ")).toContain("ahead of time generation");
  });
});
