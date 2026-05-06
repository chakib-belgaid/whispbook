import type { SynthesisResult, TextSegment } from "../types";

export type SegmentSynthesizer = (segment: TextSegment) => Promise<SynthesisResult>;
export type ItemSynthesizer<TItem, TResult> = (item: TItem) => Promise<TResult>;

export class PlaybackQueue<TItem = TextSegment, TResult = SynthesisResult> {
  private readonly inFlight = new Map<number, Promise<TResult>>();

  constructor(
    private readonly segments: TItem[],
    private readonly synthesize: ItemSynthesizer<TItem, TResult>,
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

  async take(index: number): Promise<TResult> {
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
