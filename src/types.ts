export type DocumentKind = "pdf" | "text" | "paste";

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
  voiceURI: string;
  language: string;
  speed: number;
  pitch: number;
  volume: number;
  paragraphGapMs: number;
  autoAdvance: boolean;
  keepAwake: boolean;
}
