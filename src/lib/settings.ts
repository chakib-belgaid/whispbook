import type { ReaderSettings, VoiceQuality } from "../types";

export const DEFAULT_SETTINGS: ReaderSettings = {
  voiceId: "en_US-lessac",
  quality: "medium",
  speed: 1,
  volume: 0.9
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function speedToLengthScale(speed: number): number {
  const safeSpeed = clamp(speed, 0.6, 2);
  return Number((1 / safeSpeed).toFixed(3));
}

export function normalizeSettings(value: Partial<ReaderSettings> | null | undefined): ReaderSettings {
  const quality = value?.quality && ["low", "medium", "high"].includes(value.quality)
    ? (value.quality as VoiceQuality)
    : DEFAULT_SETTINGS.quality;

  return {
    voiceId: value?.voiceId || DEFAULT_SETTINGS.voiceId,
    quality,
    speed: clamp(Number(value?.speed ?? DEFAULT_SETTINGS.speed), 0.6, 2),
    volume: clamp(Number(value?.volume ?? DEFAULT_SETTINGS.volume), 0, 1.5)
  };
}
