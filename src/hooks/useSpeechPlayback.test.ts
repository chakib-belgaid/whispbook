import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentFromPdfPages, documentFromText } from "../lib/files";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { useSpeechPlayback } from "./useSpeechPlayback";

class MockUtterance {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
  onboundary: ((event: SpeechSynthesisEvent) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

class MockAudio {
  src: string;
  loop = false;
  preload = "";
  volume = 1;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  setAttribute = vi.fn();
  removeAttribute = vi.fn();

  constructor(src: string) {
    this.src = src;
  }
}

function voice(partial: Partial<SpeechSynthesisVoice> & Pick<SpeechSynthesisVoice, "voiceURI" | "name" | "lang">): SpeechSynthesisVoice {
  return {
    default: false,
    localService: true,
    ...partial
  } as SpeechSynthesisVoice;
}

describe("useSpeechPlayback", () => {
  let spoken: MockUtterance[];
  let currentUtterance: MockUtterance | null;
  let speechSynthesisMock: SpeechSynthesis;

  beforeEach(() => {
    spoken = [];
    currentUtterance = null;
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    vi.stubGlobal("Audio", MockAudio);
    speechSynthesisMock = {
      paused: false,
      pending: false,
      speaking: false,
      getVoices: vi.fn(() => [voice({ voiceURI: "en", name: "English", lang: "en-US", default: true })]),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
        currentUtterance = utterance as unknown as MockUtterance;
        spoken.push(currentUtterance);
      }),
      cancel: vi.fn(() => {
        const utterance = currentUtterance;
        currentUtterance = null;
        utterance?.onerror?.({ error: "canceled" } as SpeechSynthesisErrorEvent);
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    } as unknown as SpeechSynthesis;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: speechSynthesisMock
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("speaks auto-advanced paragraphs in a single speech window", async () => {
    const document = documentFromText("First. Second.", "sample.txt", "text");
    const onProgress = vi.fn(() => Promise.resolve());
    const settings = { ...DEFAULT_SETTINGS, paragraphGapMs: 0 };
    const { result } = renderHook(() => useSpeechPlayback({ document, settings, onProgress }));

    let playPromise: Promise<void>;
    await act(async () => {
      playPromise = result.current.playFrom(document.segments[0].id);
      await Promise.resolve();
    });

    expect(spoken[0].text).toBe("First.\n\nSecond.");
    expect(result.current.activeSegmentIds).toEqual(document.segments.map((segment) => segment.id));
    await act(async () => {
      spoken[0].onboundary?.({ charIndex: "First.\n\n".length } as SpeechSynthesisEvent);
      await Promise.resolve();
    });

    expect(result.current.activeSegmentId).toBe(document.segments[1].id);
    expect(result.current.activeSegmentIds).toEqual(document.segments.map((segment) => segment.id));

    await act(async () => {
      spoken[0].onend?.({} as SpeechSynthesisEvent);
      await playPromise!;
    });

    expect(onProgress).toHaveBeenCalledWith(document.id, document.segments[1].id);
    expect(result.current.activeSegmentIds).toEqual([]);
    expect(result.current.status).toBe("idle");
  });

  it("stops after one paragraph when auto-advance is disabled", async () => {
    const document = documentFromText("First. Second.", "sample.txt", "text");
    const onProgress = vi.fn(() => Promise.resolve());
    const settings = { ...DEFAULT_SETTINGS, autoAdvance: false, paragraphGapMs: 0 };
    const { result } = renderHook(() => useSpeechPlayback({ document, settings, onProgress }));

    let playPromise: Promise<void>;
    await act(async () => {
      playPromise = result.current.playFrom(document.segments[0].id);
      await Promise.resolve();
    });
    await act(async () => {
      spoken[0].onend?.({} as SpeechSynthesisEvent);
      await playPromise!;
    });

    expect(spoken).toHaveLength(1);
    expect(result.current.status).toBe("paused");
    expect(onProgress).toHaveBeenCalledWith(document.id, document.segments[1].id);
  });

  it("cancels speech on pause without advancing to the next paragraph", async () => {
    const document = documentFromText("First. Second.", "sample.txt", "text");
    const onProgress = vi.fn(() => Promise.resolve());
    const settings = { ...DEFAULT_SETTINGS, paragraphGapMs: 0 };
    const { result } = renderHook(() => useSpeechPlayback({ document, settings, onProgress }));

    let playPromise: Promise<void>;
    await act(async () => {
      playPromise = result.current.playFrom(document.segments[0].id);
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.pause();
      await playPromise!;
    });

    expect(speechSynthesisMock.cancel).toHaveBeenCalled();
    expect(spoken).toHaveLength(1);
    expect(onProgress).toHaveBeenCalledWith(document.id, document.segments[0].id);
    expect(result.current.status).toBe("paused");
  });

  it("keeps speaking when the app is hidden", async () => {
    const document = documentFromText("First. Second.", "sample.txt", "text");
    const onProgress = vi.fn(() => Promise.resolve());
    const settings = { ...DEFAULT_SETTINGS, paragraphGapMs: 0 };
    const { result } = renderHook(() => useSpeechPlayback({ document, settings, onProgress }));

    let playPromise: Promise<void>;
    await act(async () => {
      playPromise = result.current.playFrom(document.segments[0].id);
      await Promise.resolve();
    });

    const cancelCallsBeforeHidden = vi.mocked(speechSynthesisMock.cancel).mock.calls.length;

    await act(async () => {
      Object.defineProperty(window.document, "visibilityState", {
        configurable: true,
        value: "hidden"
      });
      window.document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      value: "visible"
    });

    expect(result.current.status).toBe("playing");
    expect(speechSynthesisMock.cancel).toHaveBeenCalledTimes(cancelCallsBeforeHidden);
    expect(onProgress).toHaveBeenCalledWith(document.id, document.segments[0].id);

    await act(async () => {
      spoken[0].onend?.({} as SpeechSynthesisEvent);
      await playPromise!;
    });
  });

  it("speaks streamed PDFs in ten paragraph windows", async () => {
    vi.useFakeTimers();
    const initial = documentFromPdfPages("book.pdf", [paragraphs(1, 9)], {
      pagesLoaded: 1,
      pageCount: 4,
      complete: false
    });
    const onProgress = vi.fn(() => Promise.resolve());
    const settings = { ...DEFAULT_SETTINGS, paragraphGapMs: 0 };
    const { result, rerender } = renderHook(
      ({ currentDocument }) => useSpeechPlayback({ document: currentDocument, settings, onProgress }),
      { initialProps: { currentDocument: initial } }
    );

    let playPromise: Promise<void> | undefined;
    await act(async () => {
      playPromise = result.current.playFrom(initial.segments[0].id);
      await Promise.resolve();
    });

    expect(spoken).toHaveLength(0);
    expect(result.current.message).toBe("Buffering speech window");

    const firstBufferedAppend = documentFromPdfPages(
      "book.pdf",
      [paragraphs(1, 10)],
      {
        pagesLoaded: 2,
        pageCount: 4,
        complete: false
      },
      initial
    );
    await act(async () => {
      rerender({ currentDocument: firstBufferedAppend });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(spoken[0].text).toBe(spokenParagraphs(1, 10));

    await act(async () => {
      spoken[0].onend?.({} as SpeechSynthesisEvent);
      await Promise.resolve();
      await Promise.resolve();
    });

    const undersizedAppend = documentFromPdfPages(
      "book.pdf",
      [paragraphs(1, 10), paragraphs(11, 19)],
      {
        pagesLoaded: 3,
        pageCount: 4,
        complete: false
      },
      initial
    );
    await act(async () => {
      rerender({ currentDocument: undersizedAppend });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(spoken).toHaveLength(1);

    const secondBufferedAppend = documentFromPdfPages(
      "book.pdf",
      [paragraphs(1, 10), paragraphs(11, 20)],
      {
        pagesLoaded: 4,
        pageCount: 5,
        complete: false
      },
      initial
    );
    await act(async () => {
      rerender({ currentDocument: secondBufferedAppend });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(spoken[1].text).toBe(spokenParagraphs(11, 20));

    await act(async () => {
      await result.current.pause();
      await playPromise;
    });
  });
});

function paragraphs(first: number, last: number): string {
  return Array.from({ length: last - first + 1 }, (_, index) => `Paragraph ${first + index}.`).join(" ");
}

function spokenParagraphs(first: number, last: number): string {
  return Array.from({ length: last - first + 1 }, (_, index) => `Paragraph ${first + index}.`).join("\n\n");
}
