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

    const text = await extractPdfText(pdfFile("book.pdf"));

    expect(text).toBe("First page\n\nSecond page");
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
