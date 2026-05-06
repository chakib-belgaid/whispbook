import type { SynthesisResult, TextSegment } from "../types";

export type SegmentSynthesizer = (segment: TextSegment) => Promise<SynthesisResult>;

export class PlaybackQueue {
  private readonly inFlight = new Map<number, Promise<SynthesisResult>>();

  constructor(
    private readonly segments: TextSegment[],
    private readonly synthesize: SegmentSynthesizer,
    private readonly windowSize = 3
  ) {}

  get hasSegments(): boolean {
    return this.segments.length > 0;
  }

  preload(index: number): void {
    if (!this.segments[index] || this.inFlight.has(index)) {
      return;
    }
    this.inFlight.set(index, this.synthesize(this.segments[index]));
  }

  preloadWindow(startIndex: number, size = this.windowSize): void {
    for (let index = startIndex; index < startIndex + size; index += 1) {
      this.preload(index);
    }
  }

  async take(index: number): Promise<SynthesisResult> {
    this.preload(index);
    const result = await this.inFlight.get(index);
    if (!result) {
      throw new Error("No segment available for playback.");
    }
    this.inFlight.delete(index);
    this.preloadWindow(index + 1);
    return result;
  }
}
