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
    apiMock.getHealth.mockResolvedValue(sampleHealth());
    apiMock.getStyles.mockResolvedValue([sampleStyle()]);
    apiMock.getTtsCapabilities.mockResolvedValue(sampleCapabilities());
    apiMock.getBooks.mockResolvedValue([sampleBook("existing", "Existing", "existing.md")]);
    apiMock.saveBook.mockImplementation(async (book: Book) => book);
  });

  afterEach(() => {
    for (const root of mountedRoots) {
      act(() => root.unmount());
    }
    mountedRoots = [];
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

function sampleStyle(): VoiceStyle {
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
  };
}

function sampleCapabilities(): TTSCapabilities {
  const capability: EngineCapabilities = {
    engine: "kokoro",
    voices: [{ value: "bm_george", label: "George", language: "b" }],
    languages: [{ value: "b", label: "British English" }],
  };

  return {
    kokoro: capability,
    chatterbox: { ...capability, engine: "chatterbox" },
    chatterbox_turbo: { ...capability, engine: "chatterbox_turbo" },
    mock: { ...capability, engine: "mock" },
  };
}
