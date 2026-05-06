import type { DocumentKind, StoredDocument } from "../types";
import { segmentText } from "./segmentation";

export type ImportPhase = "reading" | "extracting" | "segmenting" | "saving" | "done";

export interface ImportProgress {
  phase: ImportPhase;
  percent: number;
  message: string;
  pageNumber?: number;
  pageCount?: number;
}

export type ImportProgressCallback = (progress: ImportProgress) => void;

export async function documentFromFile(file: File, onProgress?: ImportProgressCallback): Promise<StoredDocument> {
  const extension = file.name.toLowerCase().split(".").pop();
  const kind: DocumentKind = extension === "pdf" ? "pdf" : "text";
  onProgress?.({ phase: "reading", percent: 4, message: "Opening book" });

  const text =
    kind === "pdf"
      ? await extractPdf(file, (progress) =>
          onProgress?.({
            phase: "extracting",
            percent: 10 + Math.round(progress.percent * 0.76),
            message:
              progress.pageNumber > 0
                ? `Reading page ${progress.pageNumber} of ${progress.pageCount}`
                : "Counting pages",
            pageNumber: progress.pageNumber,
            pageCount: progress.pageCount
          })
        )
      : await readTextFile(file, onProgress);

  onProgress?.({ phase: "segmenting", percent: 90, message: "Preparing pages" });
  const document = documentFromText(text, file.name, kind);
  onProgress?.({ phase: "done", percent: 96, message: "Book ready" });
  return document;
}

export function documentFromText(text: string, title = "Pasted text", kind: DocumentKind = "paste"): StoredDocument {
  const segments = segmentText(text);
  const now = Date.now();

  return {
    id: createDocumentId(title, now),
    title: title.trim() || "Untitled",
    kind,
    importedAt: now,
    updatedAt: now,
    text,
    segments,
    cursorSegmentId: segments[0]?.id ?? null
  };
}

export function createDocumentId(title: string, timestamp = Date.now()): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `${slug || "doc"}-${timestamp.toString(36)}-${random}`;
}

async function extractPdf(file: File, onProgress?: (progress: { pageNumber: number; pageCount: number; percent: number }) => void): Promise<string> {
  const { extractPdfText } = await import("./pdf");
  return extractPdfText(file, onProgress);
}

async function readTextFile(file: File, onProgress?: ImportProgressCallback): Promise<string> {
  onProgress?.({ phase: "reading", percent: 18, message: "Reading text" });
  const text = await file.text();
  onProgress?.({ phase: "reading", percent: 84, message: "Text loaded" });
  return text;
}
