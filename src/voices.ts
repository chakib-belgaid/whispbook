import type { VoiceDefinition, VoiceQuality } from "./types";

const voiceBaseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac";

const sizeLabels: Record<VoiceQuality, string> = {
  low: "63 MB",
  medium: "63 MB",
  high: "114 MB"
};

export const voiceCatalog: VoiceDefinition[] = (["low", "medium", "high"] as VoiceQuality[]).map((quality) => ({
  id: `en_US-lessac-${quality}`,
  familyId: "en_US-lessac",
  label: `Lessac ${quality}`,
  language: "English (US)",
  speaker: "Lessac",
  quality,
  modelUrl: `${voiceBaseUrl}/${quality}/en_US-lessac-${quality}.onnx`,
  configUrl: `${voiceBaseUrl}/${quality}/en_US-lessac-${quality}.onnx.json`,
  sizeLabel: sizeLabels[quality]
}));

export function voiceForQuality(quality: VoiceQuality): VoiceDefinition {
  return voiceCatalog.find((voice) => voice.quality === quality) ?? voiceCatalog[1];
}
