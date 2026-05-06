import { beforeEach, describe, expect, it, vi } from "vitest";

const getDocument = vi.fn();

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({
  default: "pdf.worker.js"
}));

describe("PDF text extraction", () => {
  beforeEach(() => {
    getDocument.mockReset();
  });

  it("extracts selectable text from PDF pages", async () => {
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber: number) => ({
          getTextContent: async () => ({
            items:
              pageNumber === 1
                ? [{ str: "First" }, { str: "page" }]
                : [{ str: "Second" }, { str: "page" }]
          })
        })
      })
    });
    const { extractPdfText } = await import("./pdf");
    const progress: Array<{ pageNumber: number; pageCount: number; percent: number }> = [];

    const text = await extractPdfText(pdfFile("book.pdf"), (next) => progress.push(next));

    expect(text).toBe("First page\n\nSecond page");
    expect(progress).toEqual([
      { pageNumber: 0, pageCount: 2, percent: 0 },
      { pageNumber: 1, pageCount: 2, percent: 50 },
      { pageNumber: 2, pageCount: 2, percent: 100 }
    ]);
  });

  it("rejects PDFs without selectable text", async () => {
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [] })
        })
      })
    });
    const { extractPdfText } = await import("./pdf");

    await expect(extractPdfText(pdfFile("scan.pdf"))).rejects.toThrow("No selectable text");
  });
});

function pdfFile(name: string): File {
  return {
    name,
    arrayBuffer: async () => new ArrayBuffer(8)
  } as File;
}
