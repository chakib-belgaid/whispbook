import { useCallback, useEffect, useState } from "react";
import type { ReaderSettings, StoredDocument } from "../types";
import {
  deleteDocument,
  getAllDocuments,
  getSettings,
  saveDocument,
  saveSettings,
  updateDocumentProgress
} from "./db";

interface LibraryState {
  documents: StoredDocument[];
  activeDocument: StoredDocument | null;
  settings: ReaderSettings | null;
  loading: boolean;
  refresh: () => Promise<void>;
  importDocument: (document: StoredDocument) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  setActiveDocument: (document: StoredDocument | null) => void;
  persistProgress: (documentId: string, cursorSegmentId: string | null) => Promise<void>;
  persistSettings: (settings: ReaderSettings) => Promise<void>;
}

export function useLibrary(): LibraryState {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<StoredDocument | null>(null);
  const [settings, setSettings] = useState<ReaderSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [nextDocuments, nextSettings] = await Promise.all([getAllDocuments(), getSettings()]);
    setDocuments(nextDocuments);
    setSettings(nextSettings);
    setActiveDocument((current) => {
      if (!current) {
        return nextDocuments[0] ?? null;
      }
      return nextDocuments.find((document) => document.id === current.id) ?? nextDocuments[0] ?? null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importDocument = useCallback(
    async (document: StoredDocument) => {
      await saveDocument(document);
      setActiveDocument(document);
      await refresh();
    },
    [refresh]
  );

  const removeDocument = useCallback(
    async (id: string) => {
      await deleteDocument(id);
      await refresh();
    },
    [refresh]
  );

  const persistProgress = useCallback(
    async (documentId: string, cursorSegmentId: string | null) => {
      await updateDocumentProgress(documentId, cursorSegmentId);
      setDocuments((current) =>
        current.map((document) =>
          document.id === documentId ? { ...document, cursorSegmentId, updatedAt: Date.now() } : document
        )
      );
      setActiveDocument((current) =>
        current?.id === documentId ? { ...current, cursorSegmentId, updatedAt: Date.now() } : current
      );
    },
    []
  );

  const persistSettings = useCallback(async (nextSettings: ReaderSettings) => {
    await saveSettings(nextSettings);
    setSettings(nextSettings);
  }, []);

  return {
    documents,
    activeDocument,
    settings,
    loading,
    refresh,
    importDocument,
    removeDocument,
    setActiveDocument,
    persistProgress,
    persistSettings
  };
}
