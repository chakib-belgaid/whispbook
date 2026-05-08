import { describe, expect, it } from "vitest";
import {
  buildBookPatchSnapshot,
  buildGenerationRequestSnapshot,
  buildGenerationScript,
  defaultBackendUrlFromLocation,
  generationScriptFilename,
  selectedGenerationChapterIds
} from "./generationScript";
import type { Book, StyleOverride } from "../types";

describe("generation script export", () => {
  it("captures selected chapters and edited book state", () => {
    const book = sampleBook();
    const style: StyleOverride = {
      style_id: "fantasy",
      engine: "chatterbox",
      voice: "reference",
      language: "en",
      speed: 0.92,
      exaggeration: 0.7,
      cfg_weight: 0.35,
      temperature: 0.84,
      top_p: 0.95,
      paragraph_gap_ms: 650,
      prompt_prefix: "[aside] "
    };

    expect(selectedGenerationChapterIds(book)).toEqual(["ch-0001"]);

    const patch = buildBookPatchSnapshot(book);
    expect(patch.chapters[0].paragraphs[0]).toEqual({
      id: "ch-0001-p-0001",
      text: "Edited opening line.",
      included: true
    });
    expect(patch.chapters[1].selected).toBe(false);

    const request = buildGenerationRequestSnapshot(book, style);
    expect(request).toMatchObject({
      chapter_ids: ["ch-0001"],
      subtitle_source: "edited",
      style
    });
  });

  it("embeds portable backend payloads in the generated script", () => {
    const book = sampleBook();
    const style: StyleOverride = {
      style_id: "neutral",
      engine: "kokoro",
      voice: "af_heart",
      language: "a",
      speed: 1,
      paragraph_gap_ms: 450
    };

    const script = buildGenerationScript(book, style, {
      defaultApiUrl: "http://localhost:8000",
      exportedAt: "2026-05-08T09:00:00.000Z"
    });
    const generationRequest = decodedConstant(script, "GENERATE_REQUEST_B64");
    const metadata = decodedConstant(script, "EXPORT_METADATA_B64");

    expect(script).toContain('DEFAULT_API_URL = "http://localhost:8000"');
    expect(script).toContain("request_json(\"POST\", api_url");
    expect(generationRequest.chapter_ids).toEqual(["ch-0001"]);
    expect(generationRequest.style.engine).toBe("kokoro");
    expect(metadata.selected_chapters).toEqual([
      {
        id: "ch-0001",
        index: 0,
        title: "One",
        included_paragraphs: 1
      }
    ]);
  });

  it("uses the dev-server host when inferring the backend URL", () => {
    expect(
      defaultBackendUrlFromLocation({
        protocol: "http:",
        hostname: "192.168.1.20",
        port: "5173",
        origin: "http://192.168.1.20:5173"
      })
    ).toBe("http://192.168.1.20:8000");
    expect(
      defaultBackendUrlFromLocation({
        protocol: "https:",
        hostname: "books.example.test",
        port: "",
        origin: "https://books.example.test"
      })
    ).toBe("https://books.example.test");
  });

  it("creates stable script filenames", () => {
    expect(generationScriptFilename(sampleBook(), new Date("2026-05-08T09:00:00.000Z"))).toBe(
      "whispbook-sample-book-2026-05-08T09-00-00-000Z.py"
    );
  });

  it("rejects exports with no selected chapters", () => {
    const book = {
      ...sampleBook(),
      chapters: sampleBook().chapters.map((chapter) => ({ ...chapter, selected: false }))
    };

    expect(() => buildGenerationRequestSnapshot(book, { style_id: "neutral" })).toThrow("Select at least one chapter.");
  });
});

function decodedConstant(script: string, name: string) {
  const match = script.match(new RegExp(`${name} = "([^"]+)"`));
  if (!match) {
    throw new Error(`Missing ${name}`);
  }
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf-8"));
}

function sampleBook(): Book {
  return {
    id: "book-1",
    title: "Sample Book",
    filename: "sample.pdf",
    created_at: 1,
    updated_at: 2,
    final_audio_url: null,
    final_vtt_url: null,
    final_srt_url: null,
    final_package_url: null,
    chapters: [
      {
        id: "ch-0001",
        index: 0,
        title: "One",
        selected: true,
        status: "draft",
        status_message: null,
        audio_url: null,
        vtt_url: null,
        srt_url: null,
        generated_at: null,
        paragraphs: [
          {
            id: "ch-0001-p-0001",
            index: 0,
            original_text: "Original opening line.",
            text: "Edited opening line.",
            included: true
          },
          {
            id: "ch-0001-p-0002",
            index: 1,
            original_text: "Cut this.",
            text: "Cut this.",
            included: false
          }
        ]
      },
      {
        id: "ch-0002",
        index: 1,
        title: "Two",
        selected: false,
        status: "draft",
        status_message: null,
        audio_url: null,
        vtt_url: null,
        srt_url: null,
        generated_at: null,
        paragraphs: [
          {
            id: "ch-0002-p-0001",
            index: 0,
            original_text: "Second chapter.",
            text: "Second chapter.",
            included: true
          }
        ]
      }
    ]
  };
}
