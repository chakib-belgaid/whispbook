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
    }
  });
  return dbPromise;
}

export function resetDbConnectionForTests(): void {
  dbPromise = null;
}

export async function closeDbForTests(): Promise<void> {
  if (!dbPromise) {
    return;
  }
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

export async function getAllDocuments(): Promise<StoredDocument[]> {
  const db = await getDb();
  const documents = await db.getAllFromIndex("documents", "by-updated");
  return documents.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDocument(id: string): Promise<StoredDocument | undefined> {
  return (await getDb()).get("documents", id);
}

export async function saveDocument(document: StoredDocument): Promise<void> {
  await (await getDb()).put("documents", {
    ...document,
    updatedAt: Date.now()
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await (await getDb()).delete("documents", id);
}

export async function updateDocumentProgress(id: string, cursorSegmentId: string | null): Promise<void> {
  const db = await getDb();
  const document = await db.get("documents", id);
  if (!document) {
    return;
  }

  await db.put("documents", {
    ...document,
    cursorSegmentId,
    updatedAt: Date.now()
  });
}

export async function getSettings(): Promise<ReaderSettings> {
  const stored = await (await getDb()).get("settings", settingsKey);
  return normalizeSettings(stored ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings: ReaderSettings): Promise<void> {
  await (await getDb()).put("settings", normalizeSettings(settings), settingsKey);
}
