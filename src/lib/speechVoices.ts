import type { ReaderSettings } from "../types";

export const SYSTEM_VOICE_URI = "system-default";
export const ENGLISH_SPEECH_LANGUAGE = "en-US";

export interface SpeechVoiceOption {
  voiceURI: string;
  name: string;
  language: string;
  label: string;
  isDefault: boolean;
  isLocal: boolean;
}

export interface LanguageOption {
  language: string;
  label: string;
}

export function canUseSpeechSynthesis(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function voicesToOptions(voices: SpeechSynthesisVoice[]): SpeechVoiceOption[] {
  return voices
    .filter((voice) => isEnglishLanguage(voice.lang))
    .map((voice) => ({
      voiceURI: voice.voiceURI,
      name: voice.name,
      language: voice.lang || "und",
      label: voiceLabel(voice),
      isDefault: voice.default,
      isLocal: voice.localService
    }))
    .sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name));
}

export function languageOptionsFromVoices(voices: SpeechSynthesisVoice[], fallbackLanguage: string): LanguageOption[] {
  const languages = new Set<string>();
  if (fallbackLanguage) {
    languages.add(ENGLISH_SPEECH_LANGUAGE);
  }
  for (const voice of voices) {
    if (isEnglishLanguage(voice.lang)) {
      languages.add(voice.lang);
    }
  }

  return [...languages]
    .sort((a, b) => a.localeCompare(b))
    .map((language) => ({
      language,
      label: languageLabel(language)
    }));
}

export function groupVoiceOptionsByLanguage(options: SpeechVoiceOption[]): Map<string, SpeechVoiceOption[]> {
  const groups = new Map<string, SpeechVoiceOption[]>();
  for (const option of options) {
    const group = groups.get(option.language) ?? [];
    group.push(option);
    groups.set(option.language, group);
  }
  return groups;
}

export function selectSpeechVoice(
  voices: SpeechSynthesisVoice[],
  settings: Pick<ReaderSettings, "voiceURI" | "language">
): SpeechSynthesisVoice | null {
  if (settings.voiceURI && settings.voiceURI !== SYSTEM_VOICE_URI) {
    const exact = voices.find((voice) => voice.voiceURI === settings.voiceURI && isEnglishLanguage(voice.lang));
    if (exact) {
      return exact;
    }
  }

  const language = ENGLISH_SPEECH_LANGUAGE.toLowerCase();
  return (
    voices.find((voice) => voice.default && voice.lang.toLowerCase() === language) ??
    voices.find((voice) => voice.lang.toLowerCase() === language) ??
    voices.find((voice) => isEnglishLanguage(voice.lang)) ??
    null
  );
}

export function voiceLabel(voice: Pick<SpeechSynthesisVoice, "name" | "lang" | "default" | "localService">): string {
  const flags = [voice.default ? "default" : "", voice.localService ? "local" : ""].filter(Boolean);
  const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
  return `${voice.name} - ${voice.lang}${suffix}`;
}

export function languageLabel(language: string): string {
  if (typeof Intl !== "undefined" && "DisplayNames" in Intl) {
    try {
      const [base] = language.split("-");
      const names = new Intl.DisplayNames([language, "en"], { type: "language" });
      const label = names.of(base);
      if (label) {
        return `${titleCase(label)} (${language})`;
      }
    } catch {
      // Some Android browsers throw for private or malformed language tags.
    }
  }

  return language;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isEnglishLanguage(language: string): boolean {
  return language.toLowerCase().startsWith("en");
}
