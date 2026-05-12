export type ChapterStatus =
  | "draft"
  | "queued"
  | "generating"
  | "done"
  | "error";
export type EngineName = "kokoro" | "chatterbox" | "chatterbox_turbo" | "mock";
export type JobStatus = "queued" | "running" | "done" | "error";

export interface Paragraph {
  id: string;
  index: number;
  original_text: string;
  text: string;
  included: boolean;
  voice_ranges: VoiceRange[];
}

export interface VoiceRange {
  id: string;
  start: number;
  end: number;
  cast_id: string;
}

export interface CastMember {
  id: string;
  name: string;
  style_id: string;
  color: string;
}

export interface Chapter {
  id: string;
  index: number;
  title: string;
  selected: boolean;
  status: ChapterStatus;
  status_message: string | null;
  paragraphs: Paragraph[];
  audio_url: string | null;
  vtt_url: string | null;
  srt_url: string | null;
  generated_at: number | null;
}

export interface Book {
  id: string;
  title: string;
  filename: string;
  created_at: number;
  updated_at: number;
  cast: CastMember[];
  chapters: Chapter[];
  final_audio_url: string | null;
  final_vtt_url: string | null;
  final_srt_url: string | null;
  final_package_url: string | null;
}

export interface VoiceStyle {
  id: string;
  name: string;
  engine: EngineName;
  description: string;
  voice: string;
  language: string;
  speed: number;
  exaggeration: number;
  cfg_weight: number;
  temperature: number;
  top_p: number;
  paragraph_gap_ms: number;
  comma_pause_ms: number;
  prompt_prefix: string;
  reference_audio_url: string | null;
  custom: boolean;
}

export interface TTSOption {
  value: string;
  label: string;
}

export interface TTSVoiceOption extends TTSOption {
  language: string;
}

export interface EngineCapabilities {
  engine: EngineName;
  voices: TTSVoiceOption[];
  languages: TTSOption[];
  paralinguistic_tags: string[];
}

export type TTSCapabilities = Record<EngineName, EngineCapabilities>;

export interface StyleOverride {
  style_id: string;
  engine?: EngineName;
  voice?: string;
  language?: string;
  speed?: number;
  exaggeration?: number;
  cfg_weight?: number;
  temperature?: number;
  top_p?: number;
  paragraph_gap_ms?: number;
  comma_pause_ms?: number;
  prompt_prefix?: string;
}

export interface PreviewResponse {
  id: string;
  audio_url: string;
  vtt_url: string;
  duration_seconds: number;
}

export interface ChapterJobState {
  chapter_id: string;
  title: string;
  status: ChapterStatus;
  message: string | null;
  audio_url: string | null;
  vtt_url: string | null;
  srt_url: string | null;
}

export interface StreamSegment {
  sequence: number;
  chapter_id: string;
  paragraph_id: string;
  chapter_title: string;
  paragraph_index: number;
  audio_url: string;
  duration_seconds: number;
  text_preview: string;
}

export interface GenerateJob {
  id: string;
  book_id: string;
  status: JobStatus;
  created_at: number;
  updated_at: number;
  message: string;
  progress: number;
  chapters: ChapterJobState[];
  stream_segments: StreamSegment[];
  final_audio_url: string | null;
  final_vtt_url: string | null;
  final_srt_url: string | null;
  final_package_url: string | null;
  error: string | null;
}

export interface HealthResponse {
  ok: boolean;
  ffmpeg: boolean;
  engines: Record<string, boolean>;
  storage_path: string;
}
