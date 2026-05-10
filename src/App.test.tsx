import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  Book,
  EngineCapabilities,
  HealthResponse,
  TTSCapabilities,
  VoiceStyle,
} from "./types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

describe("App review fixes", () => {
  let mountedRoots: Root[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    apiMock.getHealth.mockResolvedValue(sampleHealth());
    apiMock.getStyles.mockResolvedValue([sampleStyle()]);
    apiMock.getTtsCapabilities.mockResolvedValue(sampleCapabilities());
    apiMock.getBooks.mockResolvedValue([sampleBook("existing", "Existing", "existing.md")]);
    apiMock.saveBook.mockImplementation(async (book: Book) => book);
    apiMock.createPreview.mockResolvedValue(samplePreview());
    apiMock.createCustomStyle.mockResolvedValue(sampleStyle({ custom: true, id: "custom", name: "Custom" }));
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
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
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

  it("uses button semantics with Enter and Space keyboard selection for paragraphs", async () => {
    const { container } = await renderApp();

    expect(paragraphSelectors(container)).toHaveLength(2);
    expect(paragraphSelectors(container)[0].getAttribute("aria-current")).toBe("true");

    await act(async () => {
      paragraphSelectors(container)[1].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(paragraphSelectors(container)[1].getAttribute("aria-current")).toBe("true");
  });

  it("updates Chatterbox Turbo voice and prompt controls without reusing a stale event target", async () => {
    const { container } = await renderApp();

    const engineSelect = controlByLabel<HTMLSelectElement>(container, "Narration source");
    engineSelect.value = "chatterbox_turbo";
    await act(async () => {
      engineSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const voiceSelect = controlByLabel<HTMLSelectElement>(container, "Narrator");
    voiceSelect.value = "reference";
    await act(async () => {
      voiceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const promptPrefix = controlByLabel<HTMLTextAreaElement>(
      container,
      "Narration guidance",
    );
    promptPrefix.value = "[hushed] ";
    await act(async () => {
      promptPrefix.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(voiceSelect.value).toBe("reference");
    expect(promptPrefix.value).toBe("[hushed] ");
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

    expect(controlByLabel<HTMLSelectElement>(container, "Narration source").value).toBe(
      "chatterbox_turbo",
    );
    expect(controlByLabel<HTMLSelectElement>(container, "Narrator").value).toBe("reference");
    expect(controlByLabel<HTMLTextAreaElement>(container, "Narration guidance").value).toBe(
      "[calm] ",
    );
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
    expect(container.textContent).toContain("Voice presets");
    expect(container.textContent).toContain("Current settings");
    expect(container.textContent).toContain("Voice fine-tuning");
    expect(container.textContent).toContain("Output");
    expect(container.textContent).toContain("Create audiobook");

    expect(container.textContent).not.toContain("Spellbook");
    expect(container.textContent).not.toContain("Ritual Runes");
    expect(container.textContent).not.toContain("Opening incantation");
    expect(container.textContent).not.toContain("voice charm");
  });

  it("keeps built-in voice presets selectable and allows returning to current settings", async () => {
    apiMock.getStyles.mockResolvedValue([
      sampleStyle({ id: "fantasy", name: "Fantasy", custom: false }),
      sampleStyle({
        id: "sci-fi",
        name: "Sci-fi",
        custom: false,
        voice: "am_adam",
        language: "a",
        speed: 1.08,
      }),
    ]);
    const { container } = await renderApp();

    const presetSelect = controlByLabel<HTMLSelectElement>(
      container,
      "Saved voice preset",
    );

    expect(Array.from(presetSelect.options).map((option) => option.value)).toEqual([
      "",
      "fantasy",
      "sci-fi",
    ]);

    presetSelect.value = "fantasy";
    await act(async () => {
      presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(presetSelect.value).toBe("fantasy");

    presetSelect.value = "";
    await act(async () => {
      presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(presetSelect.value).toBe("");
  });

  it("keeps fine-tuning drawers collapsed by default", async () => {
    const { container } = await renderApp();

    const fineTuning = detailsBySummary(container, "Voice fine-tuning");
    expect(fineTuning.open).toBe(false);
    expect(fineTuning.textContent).toContain("Reading pace");
    expect(fineTuning.textContent).toContain("Pause between paragraphs");
  });

  it("renders sample playback with themed controls instead of native browser audio chrome", async () => {
    const { container } = await renderApp();

    await act(async () => {
      buttonByText(container, "Listen to sample").click();
    });

    const player = container.querySelector(".themed-audio-player");
    expect(player).not.toBeNull();
    expect(player?.querySelector('button[aria-label="Play sample"]')).not.toBeNull();
    expect(player?.querySelector('input[aria-label="Sample playback position"]')).not.toBeNull();

    const audio = player?.querySelector("audio");
    expect(audio?.hasAttribute("controls")).toBe(false);
    expect(audio?.getAttribute("src")).toBe("/media/sample.m4a");
  });

  it("passes the selected reference audio start point when saving a custom style", async () => {
    const { container } = await renderApp();
    const input = container.querySelector<HTMLInputElement>('input[accept*="audio"]');
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
    const input = container.querySelector<HTMLInputElement>('input[accept*="audio"]');
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
  return container.querySelector<HTMLTextAreaElement>(".markdown-paragraph-editor")?.value;
}

function paragraphSelectors(container: ParentNode): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="button"][aria-label^="Select paragraph"]'),
  );
}

function controlByLabel<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  container: ParentNode,
  labelText: string,
): T {
  const label = Array.from(container.querySelectorAll("label")).find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  const control = label?.querySelector("input, select, textarea");
  if (!control) {
    throw new Error(`Could not find control for label: ${labelText}`);
  }
  return control as T;
}

function buttonByText(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Could not find button: ${text}`);
  }
  return button;
}

function detailsBySummary(container: ParentNode, text: string): HTMLDetailsElement {
  const summary = Array.from(container.querySelectorAll("summary")).find((candidate) =>
    candidate.textContent?.includes(text),
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
          },
          {
            id: `${id}-paragraph-2`,
            index: 1,
            original_text: `${title} second paragraph`,
            text: `${title} second paragraph`,
            included: true,
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
  };
  const chatterbox: EngineCapabilities = {
    engine: "chatterbox",
    voices: [
      { value: "default", label: "Default model voice", language: "en" },
      { value: "reference", label: "Custom reference audio", language: "en" },
    ],
    languages: [{ value: "en", label: "English" }],
  };

  return {
    kokoro,
    chatterbox,
    chatterbox_turbo: { ...chatterbox, engine: "chatterbox_turbo" },
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
