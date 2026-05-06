import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfProgress {
  pageNumber: number;
  pageCount: number;
  percent: number;
}

export type PdfProgressCallback = (progress: PdfProgress) => void;

export async function extractPdfText(file: File, onProgress?: PdfProgressCallback): Promise<string> {
  const data = await file.arrayBuffer();
  const document = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  onProgress?.({ pageNumber: 0, pageCount: document.numPages, percent: 0 });

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (text) {
      pages.push(text);
    }
    onProgress?.({
      pageNumber,
      pageCount: document.numPages,
      percent: Math.round((pageNumber / document.numPages) * 100)
    });
  }

  const extracted = pages.join("\n\n").trim();
  if (!extracted) {
    throw new Error("No selectable text found. Scanned PDFs need OCR, which is not included in this version.");
  }

  return extracted;
}
