import { describe, expect, it, vi } from "vitest";
import {
  importBooksSequential,
  importTitleFromFile,
  mergeLibraryBooks,
  orderBooksBySelectedFiles,
  planLibraryImports,
  shouldGuardBookChange,
} from "./bookLibrary";
import type { Book } from "../types";

describe("book library helpers", () => {
  it("imports multiple files sequentially with derived titles", async () => {
    const files = [
      new File(["one"], "first-book.md", { type: "text/markdown" }),
      new File(["two"], "second.pdf", { type: "application/pdf" }),
    ];
    const calls: string[] = [];
    const progress: string[] = [];

    const result = await importBooksSequential(
      files,
      async (file, title) => {
        calls.push(`${file.name}:${title}`);
        return sampleBook(title.toLowerCase(), title);
      },
      (current, total, file) => {
        progress.push(`${current}/${total}:${file.name}`);
      },
    );

    expect(calls).toEqual(["first-book.md:first-book", "second.pdf:second"]);
    expect(progress).toEqual(["1/2:first-book.md", "2/2:second.pdf"]);
    expect(result.imported.map((book) => book.title)).toEqual([
      "first-book",
      "second",
    ]);
    expect(result.failures).toEqual([]);
  });

  it("keeps successful imports when another file fails", async () => {
    const files = [
      new File(["ok"], "good.txt", { type: "text/plain" }),
      new File(["bad"], "broken.txt", { type: "text/plain" }),
    ];

    const result = await importBooksSequential(files, async (file, title) => {
      if (file.name === "broken.txt") {
        throw new Error("conversion failed");
      }
      return sampleBook("good", title);
    });

    expect(result.imported).toHaveLength(1);
    expect(result.failures).toEqual([
      { fileName: "broken.txt", message: "conversion failed" },
    ]);
  });

  it("merges new library books without duplicating existing ids", () => {
    const existing = [
      sampleBook("old", "Old"),
      sampleBook("duplicate", "Old duplicate"),
    ];
    const incoming = [
      sampleBook("new", "New"),
      sampleBook("duplicate", "Updated duplicate"),
    ];

    expect(
      mergeLibraryBooks(existing, incoming).map((book) => book.title),
    ).toEqual(["New", "Updated duplicate", "Old"]);
  });

  it("reuses already parsed books by filename", () => {
    const existing = [
      { ...sampleBook("book-1", "Novel"), filename: "Novel.md" },
      { ...sampleBook("book-2", "Other"), filename: "other.pdf" },
    ];
    const duplicate = new File(["same"], "novel.MD", { type: "text/markdown" });
    const fresh = new File(["new"], "new-book.md", { type: "text/markdown" });

    const plan = planLibraryImports([duplicate, fresh, duplicate], existing);

    expect(plan.reused.map((book) => book.id)).toEqual(["book-1"]);
    expect(plan.filesToImport.map((file) => file.name)).toEqual([
      "new-book.md",
    ]);
  });

  it("normalizes filenames without locale-sensitive lowercasing", () => {
    const localeLowerCase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(() => {
        throw new Error("locale-sensitive lowercase should not be used");
      });
    const existing = [
      { ...sampleBook("book-1", "Index"), filename: "Index.md" },
    ];

    try {
      const plan = planLibraryImports(
        [new File(["same"], "index.MD", { type: "text/markdown" })],
        existing,
      );

      expect(plan.reused.map((book) => book.id)).toEqual(["book-1"]);
      expect(plan.filesToImport).toEqual([]);
    } finally {
      localeLowerCase.mockRestore();
    }
  });

  it("orders available books by the original selected file order", () => {
    const existing = {
      ...sampleBook("book-1", "Existing"),
      filename: "existing.md",
    };
    const imported = { ...sampleBook("book-2", "Fresh"), filename: "fresh.md" };
    const selectedFiles = [
      new File(["fresh"], "fresh.md", { type: "text/markdown" }),
      new File(["existing"], "existing.md", { type: "text/markdown" }),
    ];

    expect(
      orderBooksBySelectedFiles(selectedFiles, [existing, imported]).map(
        (book) => book.id,
      ),
    ).toEqual(["book-2", "book-1"]);
  });

  it("detects when unsaved edits need a guard", () => {
    expect(shouldGuardBookChange(false, "book-1", "book-2")).toBe(false);
    expect(shouldGuardBookChange(true, "book-1", "book-1")).toBe(false);
    expect(shouldGuardBookChange(true, "book-1", "book-2")).toBe(true);
    expect(shouldGuardBookChange(true, "book-1")).toBe(true);
  });

  it("derives import titles from supported document filenames", () => {
    expect(importTitleFromFile({ name: "Novel.DOCX" })).toBe("Novel");
    expect(importTitleFromFile({ name: "archive.zip" })).toBe("archive.zip");
  });
});

function sampleBook(id: string, title: string): Book {
  return {
    id,
    title,
    filename: `${title}.md`,
    created_at: 1,
    updated_at: 2,
    final_audio_url: null,
    final_vtt_url: null,
    final_srt_url: null,
    final_package_url: null,
    cast: [],
    chapters: [],
  };
}
