import { describe, expect, it } from "vitest";
import { SYSTEM_VOICE_URI, languageOptionsFromVoices, selectSpeechVoice, voicesToOptions } from "./speechVoices";

function voice(partial: Partial<SpeechSynthesisVoice> & Pick<SpeechSynthesisVoice, "voiceURI" | "name" | "lang">): SpeechSynthesisVoice {
  return {
    default: false,
    localService: true,
    ...partial
  } as SpeechSynthesisVoice;
}

describe("speech voice helpers", () => {
  it("builds voice options with default and local labels", () => {
    const options = voicesToOptions([
      voice({ voiceURI: "b", name: "Beta", lang: "fr-FR" }),
      voice({ voiceURI: "a", name: "Alpha", lang: "en-US", default: true })
    ]);

    expect(options.map((option) => option.voiceURI)).toEqual(["a"]);
    expect(options[0].label).toContain("default");
    expect(options[0].label).toContain("local");
  });

  it("includes fallback language when browser voices are empty", () => {
    expect(languageOptionsFromVoices([], "en-US")).toEqual([
      {
        language: "en-US",
        label: expect.stringContaining("en-US")
      }
    ]);
  });

  it("keeps voice selection on English voices", () => {
    const voices = [
      voice({ voiceURI: "en-default", name: "English", lang: "en-US", default: true }),
      voice({ voiceURI: "en-gb", name: "British English", lang: "en-GB" }),
      voice({ voiceURI: "fr", name: "French", lang: "fr-FR" })
    ];

    expect(selectSpeechVoice(voices, { voiceURI: "en-gb", language: "en-US" })?.voiceURI).toBe("en-gb");
    expect(selectSpeechVoice(voices, { voiceURI: "fr", language: "fr-FR" })?.voiceURI).toBe("en-default");
    expect(selectSpeechVoice(voices, { voiceURI: SYSTEM_VOICE_URI, language: "en-US" })?.voiceURI).toBe("en-default");
  });
});
