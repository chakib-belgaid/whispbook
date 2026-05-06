import type { DocumentKind, StoredDocument } from "../types";
import { segmentText } from "./segmentation";

export async function documentFromFile(file: File): Promise<StoredDocument> {
  const extension = file.name.toLowerCase().split(".").pop();
  const kind: DocumentKind = extension === "pdf" ? "pdf" : "text";
  const text = kind === "pdf" ? await extractPdf(file) : await file.text();
  return documentFromText(text, file.name, kind);
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

async function extractPdf(file: File): Promise<string> {
  const { extractPdfText } = await import("./pdf");
  return extractPdfText(file);
}
