import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { documentFromPdfPages, documentFromText } from "../lib/files";
import {
  closeDbForTests,
  getDocument,
  getSettings,
  saveDocument,
  saveSettings,
  updateDocumentContent,
  updateDocumentProgress
} from "./db";

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe("local library storage", () => {
  beforeEach(async () => {
    await closeDbForTests();
    await deleteDatabase("whispbook");
  });

  afterEach(async () => {
    await closeDbForTests();
  });

  it("persists document progress for resume", async () => {
    const document = documentFromText("First. Second. Third.", "sample.txt", "text");
    await saveDocument(document);

    await updateDocumentProgress(document.id, document.segments[1].id);
    const stored = await getDocument(document.id);

    expect(stored?.cursorSegmentId).toBe(document.segments[1].id);
  });

  it("persists normalized reader settings", async () => {
    await saveSettings({ voiceId: "en_US-lessac", quality: "low", speed: 1.5, volume: 1.2 });

    await closeDbForTests();
    const stored = await getSettings();

    expect(stored).toEqual({ voiceId: "en_US-lessac", quality: "low", speed: 1.5, volume: 1.2 });
  });

  it("preserves cursor while background PDF pages are appended", async () => {
    const initial = documentFromPdfPages("book.pdf", ["First page. Second page."], {
      pagesLoaded: 1,
      pageCount: 2,
      complete: false
    });
    await saveDocument(initial);
    await updateDocumentProgress(initial.id, initial.segments[1].id);

    const appended = documentFromPdfPages(
      "book.pdf",
      ["First page. Second page.", "Third page. Fourth page."],
      {
        pagesLoaded: 2,
        pageCount: 2,
        complete: true
      },
      initial
    );
    await updateDocumentContent(appended);

    const stored = await getDocument(initial.id);
    expect(stored?.cursorSegmentId).toBe(initial.segments[1].id);
    expect(stored?.segments.map((segment) => segment.text)).toEqual([
      "First page.",
      "Second page.",
      "Third page.",
      "Fourth page."
    ]);
    expect(stored?.extraction?.status).toBe("complete");
  });
});
