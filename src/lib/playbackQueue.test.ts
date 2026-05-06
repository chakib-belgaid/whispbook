import { describe, expect, it } from "vitest";
import type { SynthesisResult, TextSegment } from "../types";
import { PlaybackQueue } from "./playbackQueue";

const segments: TextSegment[] = [
  { id: "a", index: 0, text: "First.", start: 0, end: 6 },
  { id: "b", index: 1, text: "Second.", start: 7, end: 14 },
  { id: "c", index: 2, text: "Third.", start: 15, end: 21 },
  { id: "d", index: 3, text: "Fourth.", start: 22, end: 29 }
];

function result(id: string): SynthesisResult {
  return {
    id,
    audio: new ArrayBuffer(48),
    sampleRate: 16000,
    durationSeconds: 0.1
  };
}

describe("playback queue", () => {
  it("preloads the next segment after taking the current one", async () => {
    const calls: string[] = [];
    const queue = new PlaybackQueue(segments, async (segment) => {
      calls.push(segment.id);
      return result(segment.id);
    });

    const first = await queue.take(0);

    expect(first.id).toBe("a");
    expect(calls).toEqual(["a", "b", "c", "d"]);
  });

  it("can fill an ahead-of-time synthesis window", () => {
    const calls: string[] = [];
    const queue = new PlaybackQueue(
      segments,
      async (segment) => {
        calls.push(segment.id);
        return result(segment.id);
      },
      3
    );

    queue.preloadWindow(1);

    expect(calls).toEqual(["b", "c", "d"]);
  });
});
