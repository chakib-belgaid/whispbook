import type { ReaderSettings } from "../types";
import { ENGLISH_SPEECH_LANGUAGE, SYSTEM_VOICE_URI } from "./speechVoices";

export const DEFAULT_SETTINGS: ReaderSettings = {
  voiceURI: SYSTEM_VOICE_URI,
  language: ENGLISH_SPEECH_LANGUAGE,
  speed: 1,
  pitch: 1,
  volume: 0.9,
  paragraphGapMs: 0,
  autoAdvance: true,
  keepAwake: true
};

export function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function defaultSpeechLanguage(): string {
  return ENGLISH_SPEECH_LANGUAGE;
}

export function normalizeSettings(value: Partial<ReaderSettings> | Record<string, unknown> | null | undefined): ReaderSettings {
  const raw = (value ?? {}) as Record<string, unknown>;

  return {
    voiceURI: stringOrDefault(raw.voiceURI, DEFAULT_SETTINGS.voiceURI),
    language: normalizeLanguage(raw.language),
    speed: round(clamp(numberOrDefault(raw.speed, DEFAULT_SETTINGS.speed), 0.5, 2.5), 2),
    pitch: round(clamp(numberOrDefault(raw.pitch, DEFAULT_SETTINGS.pitch), 0, 2), 2),
    volume: round(clamp(numberOrDefault(raw.volume, DEFAULT_SETTINGS.volume), 0, 1), 2),
    paragraphGapMs: Math.round(clamp(numberOrDefault(raw.paragraphGapMs, DEFAULT_SETTINGS.paragraphGapMs), 0, 5000)),
    autoAdvance: booleanOrDefault(raw.autoAdvance, DEFAULT_SETTINGS.autoAdvance),
    keepAwake: booleanOrDefault(raw.keepAwake, DEFAULT_SETTINGS.keepAwake)
  };
}

function normalizeLanguage(value: unknown): string {
  const language = stringOrDefault(value, DEFAULT_SETTINGS.language).trim();
  return language.toLowerCase().startsWith("en") ? language : DEFAULT_SETTINGS.language;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
