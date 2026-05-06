import type { DocumentKind, StoredDocument } from "../types";
import { segmentText } from "./segmentation";

export type ImportPhase = "reading" | "extracting" | "segmenting" | "saving" | "done";
const initialPdfPageWindow = 6;
const backgroundPdfPageChunk = 6;

export interface ImportProgress {
  phase: ImportPhase;
  percent: number;
  message: string;
  pageNumber?: number;
  pageCount?: number;
}

export type ImportProgressCallback = (progress: ImportProgress) => void;

export interface StreamingPdfImport {
  document: StoredDocument;
  isComplete: boolean;
  continueExtraction: (
    onDocument: (document: StoredDocument, progress: ImportProgress) => Promise<boolean | void> | boolean | void,
    onProgress?: ImportProgressCallback
  ) => Promise<void>;
}

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

export async function createStreamingPdfImport(file: File, onProgress?: ImportProgressCallback): Promise<StreamingPdfImport> {
  const { openPdfExtraction } = await import("./pdf");
  onProgress?.({ phase: "reading", percent: 4, message: "Opening book" });
  const session = await openPdfExtraction(file);
  let firstPageEnd = Math.min(initialPdfPageWindow, session.pageCount);
  const pages = await session.extractPages(1, firstPageEnd, (progress) =>
    onProgress?.({
      phase: "extracting",
      percent: 10 + Math.round(Math.min(progress.percent, firstPageEndPercent(session.pageCount)) * 0.76),
      message:
        progress.pageNumber > 0 ? `Reading page ${progress.pageNumber} of ${progress.pageCount}` : "Counting pages",
      pageNumber: progress.pageNumber,
      pageCount: progress.pageCount
    })
  );

  while (pages.length === 0 && firstPageEnd < session.pageCount) {
    const startPage = firstPageEnd + 1;
    firstPageEnd = Math.min(firstPageEnd + initialPdfPageWindow, session.pageCount);
    pages.push(
      ...(await session.extractPages(startPage, firstPageEnd, (progress) =>
        onProgress?.({
          phase: "extracting",
          percent: 10 + Math.round(Math.min(progress.percent, firstPageEndPercent(session.pageCount)) * 0.76),
          message: `Searching page ${progress.pageNumber} of ${progress.pageCount}`,
          pageNumber: progress.pageNumber,
          pageCount: progress.pageCount
        })
      ))
    );
  }

  if (pages.length === 0) {
    throw new Error("No selectable text found. Scanned PDFs need OCR, which is not included in this version.");
  }

  onProgress?.({ phase: "segmenting", percent: 90, message: "Opening first pages" });
  const document = documentFromPdfPages(file.name, pages, {
    pagesLoaded: firstPageEnd,
    pageCount: session.pageCount,
    complete: firstPageEnd >= session.pageCount
  });

  return {
    document,
    isComplete: firstPageEnd >= session.pageCount,
    async continueExtraction(onDocument, onBackgroundProgress) {
      if (firstPageEnd >= session.pageCount) {
        return;
      }

      let pagesLoaded = firstPageEnd;
      for (let startPage = firstPageEnd + 1; startPage <= session.pageCount; startPage += backgroundPdfPageChunk) {
        const endPage = Math.min(startPage + backgroundPdfPageChunk - 1, session.pageCount);
        const nextPages = await session.extractPages(startPage, endPage, (progress) =>
          onBackgroundProgress?.({
            phase: "extracting",
            percent: progress.percent,
            message: `Loading page ${progress.pageNumber} of ${progress.pageCount}`,
            pageNumber: progress.pageNumber,
            pageCount: progress.pageCount
          })
        );
        pages.push(...nextPages);
        pagesLoaded = endPage;

        const updated = documentFromPdfPages(
          file.name,
          pages,
          {
            pagesLoaded,
            pageCount: session.pageCount,
            complete: pagesLoaded >= session.pageCount
          },
          document
        );
        const shouldContinue = await onDocument(updated, {
          phase: pagesLoaded >= session.pageCount ? "done" : "extracting",
          percent: Math.round((pagesLoaded / session.pageCount) * 100),
          message:
            pagesLoaded >= session.pageCount
              ? "Book fully loaded"
              : `Loaded ${pagesLoaded} of ${session.pageCount} pages`,
          pageNumber: pagesLoaded,
          pageCount: session.pageCount
        });
        if (shouldContinue === false) {
          return;
        }
      }
    }
  };
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

export function documentFromPdfPages(
  title: string,
  pages: string[],
  state: { pagesLoaded: number; pageCount: number; complete: boolean },
  base?: StoredDocument
): StoredDocument {
  const text = pages.join("\n\n");
  const segments = segmentText(text);
  const now = Date.now();
  const cursorSegmentId =
    base?.cursorSegmentId && segments.some((segment) => segment.id === base.cursorSegmentId)
      ? base.cursorSegmentId
      : segments[0]?.id ?? null;

  return {
    id: base?.id ?? createDocumentId(title, now),
    title: title.trim() || "Untitled PDF",
    kind: "pdf",
    importedAt: base?.importedAt ?? now,
    updatedAt: now,
    text,
    segments,
    cursorSegmentId,
    extraction: {
      status: state.complete ? "complete" : "extracting",
      pagesLoaded: state.pagesLoaded,
      pageCount: state.pageCount,
      percent: Math.round((state.pagesLoaded / state.pageCount) * 100),
      message: state.complete ? "Book fully loaded" : `Loaded ${state.pagesLoaded} of ${state.pageCount} pages`
    }
  };
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

function firstPageEndPercent(pageCount: number): number {
  return Math.round((Math.min(initialPdfPageWindow, pageCount) / pageCount) * 100);
}
