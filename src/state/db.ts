import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ReaderSettings, StoredDocument } from "../types";
import { DEFAULT_SETTINGS, normalizeSettings } from "../lib/settings";

const dbName = "whispbook";
const dbVersion = 1;
const settingsKey = "reader";

interface WhispbookDB extends DBSchema {
  documents: {
    key: string;
    value: StoredDocument;
    indexes: {
      "by-updated": number;
    };
  };
  settings: {
    key: string;
    value: ReaderSettings;
  };
}

let dbPromise: Promise<IDBPDatabase<WhispbookDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<WhispbookDB>> {
  dbPromise ??= openDB<WhispbookDB>(dbName, dbVersion, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("documents")) {
        const documents = db.createObjectStore("documents", { keyPath: "id" });
        documents.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings");
      }
    },
    blocking() {
      void closeCachedDb();
    },
    terminated() {
      dbPromise = null;
    }
  });
  return dbPromise;
}

export function resetDbConnectionForTests(): void {
  dbPromise = null;
}

export async function closeDbForTests(): Promise<void> {
  await closeCachedDb();
}

async function closeCachedDb(): Promise<void> {
  if (!dbPromise) {
    return;
  }

  try {
    const db = await dbPromise;
    db.close();
  } finally {
    dbPromise = null;
  }
}

async function withDb<T>(operation: (db: IDBPDatabase<WhispbookDB>) => Promise<T>): Promise<T> {
  try {
    return await operation(await getDb());
  } catch (error) {
    if (!isRecoverableDbConnectionError(error)) {
      throw error;
    }

    await closeCachedDb();
    return operation(await getDb());
  }
}

function isRecoverableDbConnectionError(error: unknown): boolean {
  if (!(error instanceof DOMException || error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    error.name === "InvalidStateError" ||
    error.name === "TransactionInactiveError" ||
    message.includes("connection is closing") ||
    message.includes("database connection is closing") ||
    message.includes("connection is closed")
  );
}

export async function getAllDocuments(): Promise<StoredDocument[]> {
  const documents = await withDb((db) => db.getAllFromIndex("documents", "by-updated"));
  return documents.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDocument(id: string): Promise<StoredDocument | undefined> {
  return withDb((db) => db.get("documents", id));
}

export async function saveDocument(document: StoredDocument): Promise<void> {
  await withDb((db) =>
    db.put("documents", {
      ...document,
      updatedAt: Date.now()
    })
  );
}

export async function deleteDocument(id: string): Promise<void> {
  await withDb((db) => db.delete("documents", id));
}

export async function updateDocumentProgress(id: string, cursorSegmentId: string | null): Promise<void> {
  await withDb(async (db) => {
    const document = await db.get("documents", id);
    if (!document) {
      return;
    }

    await db.put("documents", {
      ...document,
      cursorSegmentId,
      updatedAt: Date.now()
    });
  });
}

export async function updateDocumentContent(document: StoredDocument): Promise<StoredDocument | undefined> {
  return withDb(async (db) => {
    const current = await db.get("documents", document.id);
    if (!current) {
      return undefined;
    }

    const cursorSegmentId =
      current.cursorSegmentId && document.segments.some((segment) => segment.id === current.cursorSegmentId)
        ? current.cursorSegmentId
        : document.cursorSegmentId;
    const updated = {
      ...document,
      cursorSegmentId,
      updatedAt: Date.now()
    };

    await db.put("documents", updated);
    return updated;
  });
}

export async function getSettings(): Promise<ReaderSettings> {
  const stored = await withDb((db) => db.get("settings", settingsKey));
  return normalizeSettings(stored ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings: ReaderSettings): Promise<void> {
  await withDb((db) => db.put("settings", normalizeSettings(settings), settingsKey));
}
