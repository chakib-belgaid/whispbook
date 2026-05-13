import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  Book,
  EngineCapabilities,
  GenerateJob,
  HealthResponse,
  TTSCapabilities,
  VoiceStyle,
} from "./types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: createMemoryStorage(),
});

const apiMock = vi.hoisted(() => ({
  createCustomStyle: vi.fn(),
  createPreview: vi.fn(),
  getBook: vi.fn(),
  getBooks: vi.fn(),
  getHealth: vi.fn(),
  getJob: vi.fn(),
  getStyles: vi.fn(),
  getTtsCapabilities: vi.fn(),
  importBook: vi.fn(),
  mediaUrl: vi.fn((url: string | null) => url ?? ""),
  saveBook: vi.fn(),
  startGeneration: vi.fn(),
}));

vi.mock("./lib/api", () => apiMock);

function createMemoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear() {
      items.clear();
    },
    getItem(key: string) {
      return items.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(items.keys())[index] ?? null;
    },
    removeItem(key: string) {
      items.delete(String(key));
    },
    setItem(key: string, value: string) {
      items.set(String(key), String(value));
    },
  };
}

describe("App review fixes", () => {
  let mountedRoots: Root[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    apiMock.getHealth.mockResolvedValue(sampleHealth());
    apiMock.getStyles.mockResolvedValue([sampleStyle()]);
    apiMock.getTtsCapabilities.mockResolvedValue(sampleCapabilities());
    apiMock.getBooks.mockResolvedValue([
      sampleBook("existing", "Existing", "existing.md"),
    ]);
    apiMock.saveBook.mockImplementation(async (book: Book) => book);
    apiMock.createPreview.mockResolvedValue(samplePreview());
    apiMock.createCustomStyle.mockResolvedValue(
      sampleStyle({ custom: true, id: "custom", name: "Custom" }),
    );
  });

  afterEach(() => {
    for (const root of mountedRoots) {
      act(() => root.unmount());
    }
    mountedRoots = [];
    window.localStorage.clear();
  });

  it("activates a newly imported first selection before a later reused book", async () => {
    const imported = sampleBook("fresh", "Fresh", "fresh.md");
    apiMock.importBook.mockResolvedValue(imported);
    const { container } = await renderApp();
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File(["fresh"], "fresh.md", { type: "text/markdown" }),
        new File(["existing"], "existing.md", { type: "text/markdown" }),
      ],
    });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(activeParagraphText(container)).toBe("Fresh paragraph");
  });

  it("shows progress while loading imported books", async () => {
    const firstImport = deferred<Book>();
    apiMock.importBook.mockReturnValueOnce(firstImport.promise);
    const { container } = await renderApp();
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["fresh"], "fresh.md", { type: "text/markdown" })],
    });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const progress = container.querySelector<HTMLElement>(
      '[role="progressbar"][aria-label="Book loading progress"]',
    );
    expect(progress?.getAttribute("aria-valuenow")).toBe("100");
    expect(container.textContent).toContain("Loading fresh.md");

    await act(async () => {
      firstImport.resolve(sampleBook("fresh", "Fresh", "fresh.md"));
    });
  });

  it("uses button semantics with Enter and Space keyboard selection for paragraphs", async () => {
    const { container } = await renderApp();

    expect(paragraphSelectors(container)).toHaveLength(2);
    expect(paragraphSelectors(container)[0].getAttribute("aria-current")).toBe(
      "true",
    );

    await act(async () => {
      paragraphSelectors(container)[1].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(paragraphSelectors(container)[1].getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("updates Chatterbox Turbo voice controls without reusing a stale event target", async () => {
    const { container } = await renderApp();

    const engineSelect = controlByLabel<HTMLSelectElement>(
      container,
      "TTS model",
    );
    engineSelect.value = "chatterbox_turbo";
    await act(async () => {
      engineSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const voiceSelect = controlByLabel<HTMLSelectElement>(
      container,
      "Narrator",
    );
    voiceSelect.value = "reference";
    await act(async () => {
      voiceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(voiceSelect.value).toBe("reference");
    expect(container.textContent).not.toContain("Narration guidance");
  });

  it("defaults fresh audiobook settings to Chatterbox Turbo", async () => {
    const { container } = await renderApp();

    expect(
      controlByLabel<HTMLSelectElement>(container, "TTS model").value,
    ).toBe("chatterbox_turbo");
    expect(currentTtsModelLayout(container).dataset.engine).toBe(
      "chatterbox_turbo",
    );
  });

  it("restores the last used voice configuration instead of booting into a preset", async () => {
    window.localStorage.setItem(
      "whispbook.styleDraft",
      JSON.stringify({
        style_id: "neutral",
        engine: "chatterbox_turbo",
        voice: "reference",
        language: "en",
        temperature: 0.72,
        top_p: 0.93,
        paragraph_gap_ms: 300,
        comma_pause_ms: 80,
        prompt_prefix: "[calm] ",
      }),
    );

    const { container } = await renderApp();

    expect(
      controlByLabel<HTMLSelectElement>(container, "TTS model").value,
    ).toBe("chatterbox_turbo");
    expect(controlByLabel<HTMLSelectElement>(container, "Narrator").value).toBe(
      "reference",
    );
    expect(container.textContent).not.toContain("Narration guidance");
  });

  it("uses clear audiobook settings labels instead of fantasy config terms", async () => {
    apiMock.getStyles.mockResolvedValue([
      sampleStyle({ custom: true, id: "custom", name: "Custom" }),
    ]);
    const { container } = await renderApp();

    expect(
      container.querySelector('[aria-label="Open audiobook settings"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Audiobook");
    expect(container.textContent).toContain("TTS model");
    expect(container.textContent).toContain("Saved voices");
    expect(container.textContent).toContain("Current settings");
    expect(container.textContent).toContain("Voice fine-tuning");
    expect(container.textContent).toContain("Output");
    expect(container.textContent).toContain("Create audiobook");

    expect(container.textContent).not.toContain("Voice:");
    expect(container.textContent).not.toContain("Spellbook");
    expect(container.textContent).not.toContain("Ritual Runes");
    expect(container.textContent).not.toContain("Opening incantation");
    expect(container.textContent).not.toContain("voice charm");
  });

  it("renders a specific settings layout for each TTS model", async () => {
    const { container } = await renderApp();

    let layout = currentTtsModelLayout(container);
    expect(layout.dataset.engine).toBe("chatterbox_turbo");
    expect(layout.textContent).toContain("Turbo narrator");
    expect(layout.textContent).not.toContain("Narration guidance");
    expect(layout.textContent).toContain("Voice variation");
    expect(layout.textContent).toContain("Import character voices");
    expect(layout.textContent).not.toContain("Language");

    await act(async () => {
      selectNarrationEngine(container, "chatterbox");
    });
    layout = currentTtsModelLayout(container);
    expect(layout.dataset.engine).toBe("chatterbox");
    expect(layout.textContent).toContain("Chatterbox narrator");
    expect(layout.textContent).toContain("Language");
    expect(layout.textContent).toContain("Expressiveness");
    expect(layout.textContent).toContain("Voice consistency");
    expect(layout.textContent).not.toContain("Narration guidance");
    expect(layout.textContent).not.toContain("Import character voices");

    await act(async () => {
      selectNarrationEngine(container, "kokoro");
    });
    layout = currentTtsModelLayout(container);
    expect(layout.dataset.engine).toBe("kokoro");
    expect(layout.textContent).toContain("Kokoro narrator");
    expect(layout.textContent).toContain("Reading pace");
    expect(layout.textContent).toContain("Comma pause");
    expect(layout.textContent).not.toContain("Narration guidance");
  });

  it("lists saved storage voices without mixing in built-in presets", async () => {
    apiMock.getStyles.mockResolvedValue([
      sampleStyle({ id: "fantasy", name: "Fantasy", custom: false }),
      sampleStyle({
        id: "chatterbox-turbo-default",
        name: "Chatterbox Turbo default",
        custom: false,
        engine: "chatterbox_turbo",
        voice: "default",
        language: "en",
      }),
      sampleStyle({
        id: "tom-sawyer",
        name: "Tom Sawyer",
        custom: true,
        engine: "chatterbox_turbo",
        voice: "reference",
        language: "en",
      }),
    ]);
    const { container } = await renderApp();

    const savedVoiceSelect = controlByLabel<HTMLSelectElement>(
      container,
      "Saved voice",
    );

    expect(
      Array.from(savedVoiceSelect.options).map((option) => option.value),
    ).toEqual(["", "tom-sawyer"]);
    expect(savedVoiceSelect.textContent).not.toContain("Fantasy");

    savedVoiceSelect.value = "tom-sawyer";
    await act(async () => {
      savedVoiceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(savedVoiceSelect.value).toBe("tom-sawyer");

    savedVoiceSelect.value = "";
    await act(async () => {
      savedVoiceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(savedVoiceSelect.value).toBe("");
  });

  it("uses an available base style after switching saved voices back to current settings", async () => {
    apiMock.getStyles.mockResolvedValue([
      sampleStyle({ id: "neutral", name: "Neutral", custom: false }),
      sampleStyle({
        id: "chatterbox-turbo-default",
        name: "Chatterbox Turbo default",
        custom: false,
        engine: "chatterbox_turbo",
        voice: "default",
        language: "en",
      }),
      sampleStyle({
        id: "custom-turbo",
        name: "Custom Turbo",
        custom: true,
        engine: "chatterbox_turbo",
        voice: "reference",
        language: "en",
      }),
    ]);
    const { container } = await renderApp();
    const savedVoiceSelect = controlByLabel<HTMLSelectElement>(
      container,
      "Saved voice",
    );

    savedVoiceSelect.value = "custom-turbo";
    await act(async () => {
      savedVoiceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    savedVoiceSelect.value = "";
    await act(async () => {
      savedVoiceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      buttonByText(container, "Listen to sample").click();
    });

    expect(apiMock.createPreview).toHaveBeenCalledWith(
      "existing",
      "Existing paragraph",
      expect.objectContaining({ style_id: "chatterbox-turbo-default" }),
      "Existing paragraph",
      expect.any(Array),
      expect.any(Array),
    );
  });

  it("replaces a stale stored style id before creating a preview", async () => {
    window.localStorage.setItem(
      "whispbook.styleDraft",
      JSON.stringify({
        style_id: "missing-custom-style",
        engine: "chatterbox_turbo",
        voice: "reference",
        language: "en",
        temperature: 0.72,
        top_p: 0.93,
      }),
    );
    apiMock.getStyles.mockResolvedValue([
      sampleStyle({ id: "neutral", name: "Neutral", custom: false }),
      sampleStyle({
        id: "chatterbox-turbo-default",
        name: "Chatterbox Turbo default",
        custom: false,
        engine: "chatterbox_turbo",
        voice: "default",
        language: "en",
      }),
    ]);
    const { container } = await renderApp();

    await act(async () => {
      buttonByText(container, "Listen to sample").click();
    });

    expect(apiMock.createPreview).toHaveBeenCalledWith(
      "existing",
      "Existing paragraph",
      expect.objectContaining({ style_id: "chatterbox-turbo-default" }),
      "Existing paragraph",
      expect.any(Array),
      expect.any(Array),
    );
  });

  it("keeps fine-tuning drawers collapsed by default", async () => {
    const { container } = await renderApp();

    const fineTuning = detailsBySummary(container, "Voice fine-tuning");
    expect(fineTuning.open).toBe(false);
    expect(fineTuning.textContent).toContain("Voice variation");
    expect(fineTuning.textContent).toContain("Pause between paragraphs");
  });

  it("hides comma pause settings for Chatterbox engines", async () => {
    const { container } = await renderApp();

    await act(async () => {
      selectNarrationEngine(container, "kokoro");
    });
    expect(container.textContent).toContain("Comma pause");

    await act(async () => {
      selectNarrationEngine(container, "chatterbox");
    });
    expect(container.textContent).not.toContain("Comma pause");

    await act(async () => {
      selectNarrationEngine(container, "chatterbox_turbo");
    });
    expect(container.textContent).not.toContain("Comma pause");
  });

  it("renders sample playback with themed controls instead of native browser audio chrome", async () => {
    const { container } = await renderApp();

    await act(async () => {
      buttonByText(container, "Listen to sample").click();
    });

    const player = container.querySelector(".themed-audio-player");
    expect(player).not.toBeNull();
    expect(
      player?.querySelector('button[aria-label="Play sample"]'),
    ).not.toBeNull();
    expect(
      player?.querySelector('input[aria-label="Sample playback position"]'),
    ).not.toBeNull();

    const audio = player?.querySelector("audio");
    expect(audio?.hasAttribute("controls")).toBe(false);
    expect(audio?.getAttribute("src")).toBe("/media/sample.m4a");
  });

  it("shows progress while generating paragraph sample audio", async () => {
    const preview = deferred<ReturnType<typeof samplePreview>>();
    apiMock.createPreview.mockReturnValueOnce(preview.promise);
    const { container } = await renderApp();

    await act(async () => {
      buttonByText(container, "Listen to sample").click();
    });

    const progress = container.querySelector<HTMLElement>(
      '[role="progressbar"][aria-label="Paragraph audio generation progress"]',
    );
    expect(progress?.getAttribute("aria-valuetext")).toBe(
      "Creating paragraph audio",
    );
    expect(container.textContent).toContain("Creating paragraph audio");

    await act(async () => {
      preview.resolve(samplePreview());
    });
  });

  it("renders audiobook generation progress as an accessible themed meter", async () => {
    apiMock.startGeneration.mockResolvedValue(
      sampleJob({
        progress: 42,
        message: "Rendering speech (1/2 paragraphs)",
      }),
    );
    const { container } = await renderApp();

    await act(async () => {
      buttonByText(container, "Create audiobook").click();
    });

    const progress = container.querySelector<HTMLElement>(
      '[role="progressbar"][aria-label="Audiobook creation progress"]',
    );
    expect(progress?.getAttribute("aria-valuenow")).toBe("42");
    expect(progress?.textContent).toContain("42%");
    expect(container.textContent).toContain(
      "Rendering speech (1/2 paragraphs)",
    );
  });

  it("plays ready audiobook stream segments while polling for newly generated audio", async () => {
    const firstJob = sampleJob({
      stream_segments: [
        sampleStreamSegment({
          sequence: 0,
          audio_url: "/media/generated/job/ch-1/segments/0000.wav",
          text_preview: "First paragraph.",
        }),
      ],
    });
    const secondJob = sampleJob({
      stream_segments: [
        ...firstJob.stream_segments,
        sampleStreamSegment({
          sequence: 1,
          paragraph_id: "p-2",
          paragraph_index: 1,
          audio_url: "/media/generated/job/ch-1/segments/0001.wav",
          text_preview: "Second paragraph.",
        }),
      ],
    });
    apiMock.startGeneration.mockResolvedValue(firstJob);
    apiMock.getJob.mockResolvedValue(secondJob);
    vi.useFakeTimers();

    try {
      const { container } = await renderApp();

      await act(async () => {
        buttonByText(container, "Create audiobook").click();
      });

      expect(container.textContent).toContain("Listen while creating");
      expect(container.textContent).toContain("First paragraph.");
      let audio = container.querySelector<HTMLAudioElement>(
        '[aria-label="Streaming audiobook player"] audio',
      );
      expect(audio?.getAttribute("src")).toBe(
        "/media/generated/job/ch-1/segments/0000.wav",
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1800);
      });

      expect(container.textContent).toContain("Second paragraph.");
      audio = container.querySelector<HTMLAudioElement>(
        '[aria-label="Streaming audiobook player"] audio',
      );
      expect(audio?.getAttribute("src")).toBe(
        "/media/generated/job/ch-1/segments/0000.wav",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues playback when the next stream segment arrives after waiting", async () => {
    const firstJob = sampleJob({
      stream_segments: [
        sampleStreamSegment({
          sequence: 0,
          audio_url: "/media/generated/job/ch-1/segments/0000.wav",
          text_preview: "First paragraph.",
        }),
      ],
    });
    const secondJob = sampleJob({
      stream_segments: [
        ...firstJob.stream_segments,
        sampleStreamSegment({
          sequence: 1,
          paragraph_id: "p-2",
          paragraph_index: 1,
          audio_url: "/media/generated/job/ch-1/segments/0001.wav",
          text_preview: "Second paragraph.",
        }),
      ],
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    apiMock.startGeneration.mockResolvedValue(firstJob);
    apiMock.getJob.mockResolvedValue(secondJob);
    vi.useFakeTimers();

    try {
      const { container } = await renderApp();

      await act(async () => {
        buttonByText(container, "Create audiobook").click();
      });

      const firstAudio = container.querySelector<HTMLAudioElement>(
        '[aria-label="Streaming audiobook player"] audio',
      );
      expect(firstAudio?.getAttribute("src")).toBe(
        "/media/generated/job/ch-1/segments/0000.wav",
      );

      await act(async () => {
        firstAudio?.dispatchEvent(new Event("ended", { bubbles: true }));
      });

      expect(container.textContent).toContain(
        "Waiting for the next paragraph...",
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1800);
      });

      const nextAudio = container.querySelector<HTMLAudioElement>(
        '[aria-label="Streaming audiobook player"] audio',
      );
      expect(nextAudio?.getAttribute("src")).toBe(
        "/media/generated/job/ch-1/segments/0001.wav",
      );
      expect(play).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      play.mockRestore();
    }
  });

  it("passes the selected reference audio start point when saving a custom style", async () => {
    const { container } = await renderApp();
    const input = container.querySelector<HTMLInputElement>(
      'input[accept*="audio"]',
    );
    expect(input).not.toBeNull();

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["voice"], "voice.wav", { type: "audio/wav" })],
    });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const voiceDetails = detailsBySummary(container, "Custom voice details");
    voiceDetails.open = true;
    voiceDetails.dispatchEvent(new Event("toggle", { bubbles: true }));

    const startInput = controlByLabel<HTMLInputElement>(
      container,
      "Sample start (seconds)",
    );
    await act(async () => {
      changeInputValue(startInput, "15");
    });

    await act(async () => {
      buttonByText(container, "Save voice style").click();
    });

    expect(apiMock.createCustomStyle).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceStartSeconds: 15,
      }),
    );
  });

  it("clamps non-finite reference audio start points before saving", async () => {
    const { container } = await renderApp();
    const input = container.querySelector<HTMLInputElement>(
      'input[accept*="audio"]',
    );
    expect(input).not.toBeNull();

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["voice"], "voice.wav", { type: "audio/wav" })],
    });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const voiceDetails = detailsBySummary(container, "Custom voice details");
    voiceDetails.open = true;
    voiceDetails.dispatchEvent(new Event("toggle", { bubbles: true }));

    const startInput = controlByLabel<HTMLInputElement>(
      container,
      "Sample start (seconds)",
    );
    await act(async () => {
      changeInputValue(startInput, "1e999");
    });

    await act(async () => {
      buttonByText(container, "Save voice style").click();
    });

    expect(apiMock.createCustomStyle).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceStartSeconds: 0,
      }),
    );
  });

  it("imports multiple Chatterbox Turbo character voices into the active cast", async () => {
    apiMock.createCustomStyle.mockImplementation(async (input) =>
      sampleStyle({
        custom: true,
        id: `${input.name.toLowerCase().replace(/\s+/g, "-")}-style`,
        name: input.name,
        engine: "chatterbox_turbo",
        voice: "reference",
        language: "en",
      }),
    );
    const { container } = await renderApp();
    selectNarrationEngine(container, "chatterbox_turbo");
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Import character voice files"]',
    );
    expect(input).not.toBeNull();

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File(["alice"], "alice-wonder.wav", { type: "audio/wav" }),
        new File(["bob"], "bob-stone.wav", { type: "audio/wav" }),
      ],
    });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(apiMock.createCustomStyle).toHaveBeenCalledTimes(2);
    expect(apiMock.createCustomStyle).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "alice wonder",
        engine: "chatterbox_turbo",
        referenceAudio: expect.any(File),
      }),
    );
    expect(container.textContent).toContain("alice wonder");
    expect(container.textContent).toContain("bob stone");
  });

  it("inserts Turbo paralinguistic tags from a cursor autocomplete", async () => {
    const { container } = await renderApp();
    await act(async () => {
      selectNarrationEngine(container, "chatterbox_turbo");
    });
    const editor = activeParagraphEditor(container);
    await act(async () => {
      placeCursorInTextarea(editor, "Existing".length);
    });

    await act(async () => {
      buttonByText(container, "Insert tag").click();
    });
    const tagInput = controlByLabel<HTMLInputElement>(container, "Tag name");
    await act(async () => {
      changeInputValue(tagInput, "whi");
    });
    await act(async () => {
      buttonByText(container, "[whisper]").click();
    });

    expect(activeParagraphText(container)).toBe("Existing [whisper] paragraph");
  });

  it("inserts custom tags from the cursor autocomplete", async () => {
    const { container } = await renderApp();
    await act(async () => {
      selectNarrationEngine(container, "chatterbox_turbo");
    });
    const editor = activeParagraphEditor(container);
    await act(async () => {
      placeCursorInTextarea(editor, "Existing".length);
    });

    await act(async () => {
      buttonByText(container, "Insert tag").click();
    });
    const tagInput = controlByLabel<HTMLInputElement>(container, "Tag name");
    await act(async () => {
      changeInputValue(tagInput, "hushed aside");
    });
    await act(async () => {
      buttonByText(container, "Use custom [hushed aside]").click();
    });

    expect(activeParagraphText(container)).toBe(
      "Existing [hushed aside] paragraph",
    );
  });

  it("assigns selected original text to a cast voice from an available voice list", async () => {
    const { container } = await renderApp();
    await act(async () => {
      selectNarrationEngine(container, "chatterbox_turbo");
    });
    expect(
      container.querySelector('[data-testid="paragraph-annotation-preview"]'),
    ).toBeNull();

    await act(async () => {
      selectTextInTextarea(
        activeParagraphEditor(container),
        0,
        "Existing".length,
      );
    });
    const voiceList = container.querySelector<HTMLElement>(
      '[aria-label="Available character voices"]',
    );
    expect(voiceList).not.toBeNull();

    await act(async () => {
      voiceList
        ?.querySelector<HTMLButtonElement>('[data-cast-id="existing-alice"]')
        ?.click();
    });

    expect(
      container.querySelector('[aria-label="Available character voices"]'),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Assigned voice ranges"]'),
    ).toBeNull();
    const highlight = container.querySelector<HTMLElement>(
      '[data-testid="voice-range-highlight"]',
    );
    expect(highlight?.dataset.castName).toBe("Alice");
    expect(highlight?.textContent).toBe("Existing");
    expect(container.textContent).not.toContain("Alice: Existing");
    expect(container.textContent).toContain("Default narrator remains plain");
  });

  it("shows saved storage voices when assigning selected text", async () => {
    const book = sampleBook("storage-voices", "Storage Voices", "voices.md");
    book.cast = [];
    apiMock.getBooks.mockResolvedValue([book]);
    apiMock.getStyles.mockResolvedValue([
      sampleStyle({ id: "fantasy", name: "Fantasy", custom: false }),
      sampleStyle({
        id: "tom-sawyer",
        name: "Tom Sawyer",
        custom: true,
        engine: "chatterbox_turbo",
        voice: "reference",
        language: "en",
      }),
    ]);
    const { container } = await renderApp();

    await act(async () => {
      selectTextInTextarea(
        activeParagraphEditor(container),
        0,
        "Storage".length,
      );
    });
    const voiceList = container.querySelector<HTMLElement>(
      '[aria-label="Available character voices"]',
    );

    expect(voiceList?.textContent).toContain("Tom Sawyer");
    expect(voiceList?.textContent).not.toContain("Fantasy");

    await act(async () => {
      voiceList
        ?.querySelector<HTMLButtonElement>('[data-style-id="tom-sawyer"]')
        ?.click();
    });

    const highlight = container.querySelector<HTMLElement>(
      '[data-testid="voice-range-highlight"]',
    );
    expect(highlight?.dataset.castName).toBe("Tom Sawyer");
    expect(highlight?.textContent).toBe("Storage");
    expect(container.textContent).not.toContain("Tom Sawyer: Storage");
  });

  async function renderApp(): Promise<{ container: HTMLDivElement }> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(<App />);
    });

    return { container };
  }
});

function activeParagraphText(container: ParentNode): string | undefined {
  return activeParagraphEditor(container).value;
}

function activeParagraphEditor(container: ParentNode): HTMLTextAreaElement {
  const editor = container.querySelector<HTMLTextAreaElement>(
    ".markdown-paragraph-editor",
  );
  if (!editor) {
    throw new Error("Could not find active paragraph editor");
  }
  return editor;
}

function paragraphSelectors(container: ParentNode): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[role="button"][aria-label^="Select paragraph"]',
    ),
  );
}

function controlByLabel<
  T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
>(container: ParentNode, labelText: string): T {
  const label = Array.from(container.querySelectorAll("label")).find(
    (candidate) => candidate.textContent?.includes(labelText),
  );
  const control = label?.querySelector("input, select, textarea");
  if (!control) {
    throw new Error(`Could not find control for label: ${labelText}`);
  }
  return control as T;
}

function buttonByText(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.includes(text));
  if (!button) {
    throw new Error(`Could not find button: ${text}`);
  }
  return button;
}

function detailsBySummary(
  container: ParentNode,
  text: string,
): HTMLDetailsElement {
  const summary = Array.from(container.querySelectorAll("summary")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  const details = summary?.closest("details");
  if (!details) {
    throw new Error(`Could not find details summary: ${text}`);
  }
  return details as HTMLDetailsElement;
}

function changeInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(input, "value")?.set;
  const prototypeSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )?.set;
  const setValue = prototypeSetter ?? valueSetter;
  if (!setValue) {
    throw new Error("Could not set input value");
  }
  setValue.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function placeCursorInTextarea(
  textarea: HTMLTextAreaElement,
  offset: number,
): void {
  selectTextInTextarea(textarea, offset, offset);
}

function selectTextInTextarea(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
): void {
  textarea.focus();
  textarea.setSelectionRange(start, end);
  textarea.dispatchEvent(new Event("select", { bubbles: true }));
}

function selectNarrationEngine(container: ParentNode, engine: string): void {
  const engineSelect = controlByLabel<HTMLSelectElement>(
    container,
    "TTS model",
  );
  engineSelect.value = engine;
  engineSelect.dispatchEvent(new Event("change", { bubbles: true }));
}

function currentTtsModelLayout(container: ParentNode): HTMLElement {
  const layout = container.querySelector<HTMLElement>(
    '[data-testid="tts-model-layout"]',
  );
  if (!layout) {
    throw new Error("Could not find TTS model layout");
  }
  return layout;
}

function sampleBook(id: string, title: string, filename: string): Book {
  return {
    id,
    title,
    filename,
    created_at: 1,
    updated_at: 2,
    final_audio_url: null,
    final_vtt_url: null,
    final_srt_url: null,
    final_package_url: null,
    cast: [
      {
        id: `${id}-alice`,
        name: "Alice",
        style_id: "alice-style",
        color: "#5f9ed1",
      },
    ],
    chapters: [
      {
        id: `${id}-chapter-1`,
        index: 0,
        title: `${title} Chapter`,
        selected: true,
        status: "draft",
        status_message: null,
        audio_url: null,
        vtt_url: null,
        srt_url: null,
        generated_at: null,
        paragraphs: [
          {
            id: `${id}-paragraph-1`,
            index: 0,
            original_text: `${title} paragraph`,
            text: `${title} paragraph`,
            included: true,
            voice_ranges: [],
          },
          {
            id: `${id}-paragraph-2`,
            index: 1,
            original_text: `${title} second paragraph`,
            text: `${title} second paragraph`,
            included: true,
            voice_ranges: [],
          },
        ],
      },
    ],
  };
}

function sampleHealth(): HealthResponse {
  return {
    ok: true,
    ffmpeg: true,
    engines: { kokoro: true },
    storage_path: "/tmp/whispbook-test",
  };
}

function sampleStyle(overrides: Partial<VoiceStyle> = {}): VoiceStyle {
  return {
    id: "fantasy",
    name: "Fantasy",
    engine: "kokoro",
    description: "Fantasy narrator",
    voice: "bm_george",
    language: "b",
    speed: 0.91,
    exaggeration: 0.5,
    cfg_weight: 0.5,
    temperature: 0.8,
    top_p: 1,
    paragraph_gap_ms: 620,
    comma_pause_ms: 190,
    prompt_prefix: "",
    reference_audio_url: null,
    custom: false,
    ...overrides,
  };
}

function sampleCapabilities(): TTSCapabilities {
  const kokoro: EngineCapabilities = {
    engine: "kokoro",
    voices: [{ value: "bm_george", label: "George", language: "b" }],
    languages: [{ value: "b", label: "British English" }],
    paralinguistic_tags: [],
  };
  const chatterbox: EngineCapabilities = {
    engine: "chatterbox",
    voices: [
      { value: "default", label: "Default model voice", language: "en" },
      { value: "reference", label: "Custom reference audio", language: "en" },
    ],
    languages: [{ value: "en", label: "English" }],
    paralinguistic_tags: [],
  };

  return {
    kokoro,
    chatterbox,
    chatterbox_turbo: {
      ...chatterbox,
      engine: "chatterbox_turbo",
      paralinguistic_tags: [
        "[laugh]",
        "[chuckle]",
        "[cough]",
        "[sigh]",
        "[gasp]",
        "[whisper]",
        "[breath]",
      ],
    },
    mock: { ...chatterbox, engine: "mock" },
  };
}

function samplePreview() {
  return {
    id: "sample-preview",
    audio_url: "/media/sample.m4a",
    vtt_url: "/media/sample.vtt",
    duration_seconds: 12,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function sampleJob(overrides: Partial<GenerateJob> = {}): GenerateJob {
  return {
    id: "job-1",
    book_id: "existing",
    status: "running",
    created_at: 1,
    updated_at: 1,
    message: "Rendering speech",
    progress: 0,
    chapters: [
      {
        chapter_id: "existing-chapter-1",
        title: "Existing Chapter",
        status: "generating",
        message: "Rendering speech",
        audio_url: null,
        vtt_url: null,
        srt_url: null,
      },
    ],
    stream_segments: [],
    final_audio_url: null,
    final_vtt_url: null,
    final_srt_url: null,
    final_package_url: null,
    error: null,
    ...overrides,
  };
}

function sampleStreamSegment(
  overrides: Partial<GenerateJob["stream_segments"][number]> = {},
): GenerateJob["stream_segments"][number] {
  return {
    sequence: 0,
    chapter_id: "existing-chapter-1",
    paragraph_id: "p-1",
    chapter_title: "Existing Chapter",
    paragraph_index: 0,
    audio_url: "/media/generated/job/ch-1/segments/0000.wav",
    duration_seconds: 1.25,
    text_preview: "First paragraph.",
    ...overrides,
  };
}
