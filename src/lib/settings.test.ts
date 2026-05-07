import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";
import { SYSTEM_VOICE_URI } from "./speechVoices";

describe("reader settings", () => {
  it("migrates old model settings into browser speech settings", () => {
    expect(normalizeSettings({ voiceId: "legacy-voice", quality: "high", speed: 1.4, volume: 0.7 })).toEqual({
      ...DEFAULT_SETTINGS,
      voiceURI: SYSTEM_VOICE_URI,
      speed: 1.4,
      volume: 0.7
    });
  });

  it("clamps browser speech controls", () => {
    expect(
      normalizeSettings({
        voiceURI: "voice-a",
        language: "fr-FR",
        speed: 9,
        pitch: -2,
        volume: 4,
        paragraphGapMs: 9000,
        autoAdvance: false,
        keepAwake: false
      })
    ).toEqual({
      voiceURI: "voice-a",
      language: "en-US",
      speed: 2.5,
      pitch: 0,
      volume: 1,
      paragraphGapMs: 5000,
      autoAdvance: false,
      keepAwake: false
    });
  });
});
