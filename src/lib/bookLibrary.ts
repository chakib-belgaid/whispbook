import type { Book } from "../types";

export interface BookImportFailure {
  fileName: string;
  message: string;
}

export interface BookImportResult {
  imported: Book[];
  failures: BookImportFailure[];
}

export type ImportBookFn = (file: File, title: string) => Promise<Book>;
export type ImportProgressFn = (current: number, total: number, file: File) => void;

export const importedDocumentExtensionPattern =
  /\.(pdf|docx|pptx|xlsx|xls|epub|html?|txt|md|csv|json|xml)$/i;

export function importTitleFromFile(file: Pick<File, "name">): string {
  return file.name.replace(importedDocumentExtensionPattern, "");
}

export async function importBooksSequential(
  files: readonly File[],
  importBook: ImportBookFn,
  onProgress?: ImportProgressFn,
): Promise<BookImportResult> {
  const imported: Book[] = [];
  const failures: BookImportFailure[] = [];

  for (const [index, file] of files.entries()) {
    onProgress?.(index + 1, files.length, file);
    try {
      imported.push(await importBook(file, importTitleFromFile(file)));
    } catch (caught) {
      failures.push({
        fileName: file.name,
        message: messageFromUnknown(caught),
      });
    }
  }

  return { imported, failures };
}

export function mergeLibraryBooks(current: readonly Book[], incoming: readonly Book[]): Book[] {
  const incomingIds = new Set(incoming.map((book) => book.id));
  return [...incoming, ...current.filter((book) => !incomingIds.has(book.id))];
}

export function shouldGuardBookChange(
  dirty: boolean,
  currentBookId: string | null,
  nextBookId?: string | null,
): boolean {
  if (!dirty) {
    return false;
  }
  return nextBookId === undefined || currentBookId !== nextBookId;
}

function messageFromUnknown(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message;
  }
  return String(caught);
}
