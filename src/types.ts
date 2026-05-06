export type DocumentKind = "pdf" | "text" | "paste";

export type VoiceQuality = "low" | "medium" | "high";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type DocumentExtractionStatus = "extracting" | "complete" | "error";

export interface TextSegment {
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
}

export interface StoredDocument {
  id: string;
  title: string;
  kind: DocumentKind;
  importedAt: number;
  updatedAt: number;
  text: string;
  segments: TextSegment[];
  cursorSegmentId: string | null;
  extraction?: {
    status: DocumentExtractionStatus;
    pagesLoaded?: number;
    pageCount?: number;
    percent: number;
    message?: string;
  };
}

export interface ReaderSettings {
  voiceId: string;
  quality: VoiceQuality;
  speed: number;
  volume: number;
}

export interface VoiceDefinition {
  id: string;
  familyId: string;
  label: string;
  language: string;
  speaker: string;
  quality: VoiceQuality;
  modelUrl: string;
  configUrl: string;
  sizeLabel: string;
}

export interface VoiceRuntimeConfig {
  audio: {
    sample_rate: number;
    quality: VoiceQuality;
  };
  espeak: {
    voice: string;
  };
  inference: {
    noise_scale: number;
    length_scale: number;
    noise_w: number;
  };
  phoneme_id_map: Record<string, number[]>;
  num_speakers: number;
  speaker_id_map: Record<string, number>;
}

export interface SynthesisRequest {
  id: string;
  text: string;
  voice: VoiceDefinition;
  settings: ReaderSettings;
}

export interface SynthesisResult {
  id: string;
  audio: ArrayBuffer;
  sampleRate: number;
  durationSeconds: number;
}

export type PiperWorkerRequest =
  | { type: "warmVoice"; id: string; voice: VoiceDefinition }
  | { type: "synthesize"; payload: SynthesisRequest };

export type PiperWorkerResponse =
  | { type: "ready"; id: string; voiceId: string }
  | { type: "status"; id?: string; label: string; progress?: number }
  | { type: "downloadProgress"; id: string; voiceId: string; progress: number; label: string }
  | { type: "synthesized"; payload: SynthesisResult }
  | { type: "error"; id: string; message: string };
