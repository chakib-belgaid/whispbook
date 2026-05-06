import { describe, expect, it } from "vitest";
import type { ReaderSettings, VoiceDefinition, VoiceRuntimeConfig } from "../types";
import { DEFAULT_SETTINGS } from "./settings";
import { PiperEngine, phonemesToPiperIds } from "./piperEngine";

const voice: VoiceDefinition = {
  id: "test-low",
  familyId: "test",
  label: "Test",
  language: "English",
  speaker: "Test",
  quality: "low",
  modelUrl: "model.onnx",
  configUrl: "config.json",
  sizeLabel: "1 KB"
};

const config: VoiceRuntimeConfig = {
  audio: { sample_rate: 16000, quality: "low" },
  espeak: { voice: "en-us" },
  inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
  phoneme_id_map: {
    _: [0],
    "^": [1],
    $: [2],
    " ": [3],
    h: [4],
    i: [5]
  },
  num_speakers: 1,
  speaker_id_map: {}
};

describe("Piper browser engine", () => {
  it("maps phonemes to Piper ids with boundaries and padding", () => {
    expect(phonemesToPiperIds("hi", config.phoneme_id_map)).toEqual([1, 4, 0, 5, 0, 2]);
  });

  it("synthesizes WAV audio with mocked ONNX runtime", async () => {
    let scales: Float32Array | null = null;
    const settings: ReaderSettings = { ...DEFAULT_SETTINGS, speed: 2 };
    const engine = new PiperEngine({
      fetchAsset: async (url) =>
        new TextEncoder().encode(url.endsWith(".json") ? JSON.stringify(config) : "model").buffer,
      createTensor: (_type, data, dims) => ({ data, dims }),
      createSession: async () => ({
        run: async (feeds) => {
          scales = (feeds.scales as { data: Float32Array }).data;
          return {
            output: {
              data: new Float32Array([0, 0.25, -0.25, 0])
            }
          };
        }
      }),
      phonemize: async () => "hi"
    });

    const result = await engine.synthesize({
      id: "s1",
      text: "Hi.",
      voice,
      settings
    });

    expect(result.sampleRate).toBe(16000);
    expect(result.durationSeconds).toBe(4 / 16000);
    expect(new TextDecoder().decode(result.audio.slice(0, 4))).toBe("RIFF");
    expect(scales?.[1]).toBe(0.5);
  });
});
