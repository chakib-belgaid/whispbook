import {
  BookOpen,
  ClipboardPaste,
  FileUp,
  Gauge,
  Pause,
  Play,
  Settings,
  SlidersHorizontal,
  Trash2,
  Volume2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSpeechPlayback } from "./hooks/useSpeechPlayback";
import { useSpeechVoices } from "./hooks/useSpeechVoices";
import { createStreamingPdfImport, documentFromFile, documentFromText, type ImportProgress } from "./lib/files";
import { DEFAULT_SETTINGS } from "./lib/settings";
import {
  ENGLISH_SPEECH_LANGUAGE,
  SYSTEM_VOICE_URI,
  groupVoiceOptionsByLanguage,
  languageLabel,
  voicesToOptions
} from "./lib/speechVoices";
import { useLibrary } from "./state/useLibrary";
import type { ReaderSettings, StoredDocument, TextSegment } from "./types";

function App() {
  const {
    documents,
    activeDocument,
    settings,
    loading,
    importDocument,
    removeDocument,
    setActiveDocument,
    updateDocument,
    persistProgress,
    persistSettings
  } = useLibrary();
  const readerSettings = settings ?? DEFAULT_SETTINGS;
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [backgroundProgress, setBackgroundProgress] = useState<ImportProgress | null>(null);
  const [backgroundTitle, setBackgroundTitle] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pasteTextRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSegmentTapRef = useRef<{ segmentId: string; time: number } | null>(null);
  const speechVoices = useSpeechVoices();
  const wakeLockSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  const playback = useSpeechPlayback({
    document: activeDocument,
    settings: readerSettings,
    onProgress: persistProgress
  });

  const displayedSegmentId =
    playback.status === "playing" || playback.status === "loading"
      ? playback.activeSegmentId ?? selectedSegmentId
      : selectedSegmentId ?? playback.activeSegmentId;
  const activeIndex = useMemo(() => {
    if (!activeDocument || !displayedSegmentId) {
      return 0;
    }
    return Math.max(
      0,
      activeDocument.segments.findIndex((segment) => segment.id === displayedSegmentId)
    );
  }, [activeDocument, displayedSegmentId]);

  useEffect(() => {
    setSelectedSegmentId(activeDocument?.cursorSegmentId ?? activeDocument?.segments[0]?.id ?? null);
  }, [activeDocument?.id]);

  useEffect(() => {
    if ((playback.status === "paused" || playback.status === "idle") && playback.activeSegmentId) {
      setSelectedSegmentId(playback.activeSegmentId);
    }
  }, [playback.activeSegmentId, playback.status]);

  async function handleFiles(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) {
      return;
    }

    setImporting(true);
    setImportError(null);
    setBackgroundProgress(null);
    setBackgroundTitle(null);
    setImportProgress({ phase: "reading", percent: 1, message: "Opening book" });
    try {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const streamingImport = isPdf
        ? await createStreamingPdfImport(file, (progress) => {
            setImportProgress((current) => mergeImportProgress(current, progress));
          })
        : null;
      const document =
        streamingImport?.document ??
        (await documentFromFile(file, (progress) => {
          setImportProgress((current) => mergeImportProgress(current, progress));
        }));
      if (document.segments.length === 0) {
        throw new Error("No readable text found.");
      }
      setImportProgress((current) =>
        mergeImportProgress(current, { phase: "saving", percent: 98, message: "Saving to device" })
      );
      await importDocument(document);
      setImportProgress((current) =>
        mergeImportProgress(current, { phase: "done", percent: 100, message: "Book ready" })
      );
      await delay(260);

      if (streamingImport && !streamingImport.isComplete) {
        setBackgroundTitle(document.title);
        setBackgroundProgress({
          phase: "extracting",
          percent: document.extraction?.percent ?? 0,
          message: document.extraction?.message ?? "Loading remaining pages",
          pageNumber: document.extraction?.pagesLoaded,
          pageCount: document.extraction?.pageCount
        });
        void streamingImport
          .continueExtraction(async (updatedDocument, progress) => {
            const saved = await updateDocument(updatedDocument);
            if (!saved) {
              setBackgroundProgress(null);
              setBackgroundTitle(null);
              return false;
            }
            setBackgroundProgress(progress);
            if (progress.phase === "done") {
              await delay(700);
              setBackgroundProgress(null);
              setBackgroundTitle(null);
            }
            return true;
          }, (progress) => setBackgroundProgress(progress))
          .catch((error: unknown) => {
            setBackgroundProgress({
              phase: "extracting",
              percent: document.extraction?.percent ?? 0,
              message: error instanceof Error ? error.message : String(error),
              pageNumber: document.extraction?.pagesLoaded,
              pageCount: document.extraction?.pageCount
            });
          });
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
      setImportProgress(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handlePasteImport(): Promise<void> {
    setImporting(true);
    setImportError(null);
    try {
      const sourceText = pasteText || pasteTextRef.current?.value || "";
      const document = documentFromText(sourceText, "Pasted text", "paste");
      if (document.segments.length === 0) {
        throw new Error("No readable text found.");
      }
      await importDocument(document);
      setPasteText("");
      setPasteOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  async function updateSettings(next: Partial<ReaderSettings>): Promise<void> {
    await persistSettings({ ...readerSettings, ...next });
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand-lockup">
          <BookOpen aria-hidden="true" size={22} />
          <div>
            <h1>Whispbook</h1>
            <p>{activeDocument ? activeDocument.title : "Android speech reader"}</p>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <Settings size={21} />
        </button>
      </header>

      <section className="import-band" aria-label="Import document">
        <input
          id="document-file"
          name="document-file"
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".pdf,.txt,text/plain,application/pdf"
          onChange={(event) => void handleFiles(event.currentTarget.files)}
        />
        <button className="primary-action" type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          <FileUp size={18} />
          <span>{importing ? "Importing" : "Import"}</span>
        </button>
        <button className="secondary-action" type="button" onClick={() => setPasteOpen(true)} disabled={importing}>
          <ClipboardPaste size={18} />
          <span>Paste</span>
        </button>
      </section>

      {pasteOpen && (
        <section className="paste-band" aria-label="Pasted text">
          <textarea
            id="paste-text"
            name="paste-text"
            ref={pasteTextRef}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder="Paste text"
            rows={5}
          />
          <div className="paste-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setPasteText("");
                setPasteOpen(false);
              }}
            >
              <X size={18} />
              <span>Clear</span>
            </button>
            <button className="primary-action" type="button" onClick={() => void handlePasteImport()} disabled={importing}>
              <ClipboardPaste size={18} />
              <span>Add</span>
            </button>
          </div>
        </section>
      )}

      {importError && <p className="error-banner">{importError}</p>}

      {backgroundProgress && (
        <BackgroundImportBanner title={backgroundTitle ?? "PDF"} progress={backgroundProgress} />
      )}

      {documents.length > 0 && (
        <nav className="document-strip" aria-label="Library">
          {documents.map((document) => (
            <button
              key={document.id}
              type="button"
              className={document.id === activeDocument?.id ? "document-tab is-selected" : "document-tab"}
              onClick={() => setActiveDocument(document)}
            >
              <span>{document.title}</span>
              <small>{documentSubtitle(document)}</small>
            </button>
          ))}
        </nav>
      )}

      <ReaderView
        loading={loading}
        document={activeDocument}
        readingSegmentIds={playback.status === "playing" ? playback.activeSegmentIds : []}
        currentReadingSegmentId={playback.status === "playing" ? playback.activeSegmentId : null}
        selectedSegmentId={selectedSegmentId}
        onSegmentTap={(segment) => {
          const now = Date.now();
          const isDoubleTap =
            lastSegmentTapRef.current?.segmentId === segment.id && now - lastSegmentTapRef.current.time < 330;
          lastSegmentTapRef.current = { segmentId: segment.id, time: now };
          setSelectedSegmentId(segment.id);

          if (isDoubleTap) {
            void playback.playFrom(segment.id);
            return;
          }

          if (playback.status === "playing" || playback.status === "loading") {
            void playback.pause();
          }
        }}
      />

      <PlaybackBar
        document={activeDocument}
        status={playback.status}
        activeIndex={activeIndex}
        error={playback.error}
        message={playback.message}
        onToggle={() => void playback.toggle(selectedSegmentId)}
        onSettings={() => setSettingsOpen(true)}
        onDelete={async () => {
          if (!activeDocument) {
            return;
          }
          await playback.pause();
          await removeDocument(activeDocument.id);
        }}
      />

      {settingsOpen && (
        <SettingsSheet
          settings={readerSettings}
          voices={speechVoices.voices}
          speechSupported={speechVoices.supported}
          voicesLoaded={speechVoices.loaded}
          wakeLockSupported={wakeLockSupported}
          onClose={() => setSettingsOpen(false)}
          onChange={(next) => void updateSettings(next)}
        />
      )}

      {importProgress && <BookImportOverlay progress={importProgress} />}
    </main>
  );
}

interface ReaderViewProps {
  loading: boolean;
  document: StoredDocument | null;
  readingSegmentIds: string[];
  currentReadingSegmentId: string | null;
  selectedSegmentId: string | null;
  onSegmentTap: (segment: TextSegment) => void;
}

function ReaderView({
  loading,
  document,
  readingSegmentIds,
  currentReadingSegmentId,
  selectedSegmentId,
  onSegmentTap
}: ReaderViewProps) {
  const readingSegmentIdSet = useMemo(() => new Set(readingSegmentIds), [readingSegmentIds]);
  const segmentElementsRef = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!currentReadingSegmentId || window.document.visibilityState === "hidden") {
      return;
    }

    const element = segmentElementsRef.current.get(currentReadingSegmentId);
    if (!element || isElementVisibleInReaderViewport(element)) {
      return;
    }

    element.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "smooth"
    });
  }, [currentReadingSegmentId]);

  if (loading) {
    return <section className="empty-state">Loading</section>;
  }

  if (!document) {
    return (
      <section className="empty-state">
        <BookOpen size={36} />
        <h2>No document</h2>
        <p>Import a PDF, text file, or pasted text.</p>
      </section>
    );
  }

  return (
    <article className="reader-surface" aria-label={document.title}>
      {document.segments.map((segment) => (
        <button
          key={segment.id}
          ref={(element) => {
            if (element) {
              segmentElementsRef.current.set(segment.id, element);
              return;
            }
            segmentElementsRef.current.delete(segment.id);
          }}
          type="button"
          className={segmentClassName(segment.id, readingSegmentIdSet, currentReadingSegmentId, selectedSegmentId)}
          onClick={() => onSegmentTap(segment)}
        >
          {segment.text}
        </button>
      ))}
    </article>
  );
}

function segmentClassName(
  segmentId: string,
  readingSegmentIds: Set<string>,
  currentReadingSegmentId: string | null,
  selectedSegmentId: string | null
): string {
  const classes = ["text-segment"];
  if (segmentId === selectedSegmentId) {
    classes.push("is-selected");
  }
  if (readingSegmentIds.has(segmentId)) {
    classes.push("is-reading");
  }
  if (segmentId === currentReadingSegmentId) {
    classes.push("is-current-reading");
  }
  return classes.join(" ");
}

function isElementVisibleInReaderViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const topInset = 12;
  const bottomInset = 104;
  return rect.top >= topInset && rect.bottom <= window.innerHeight - bottomInset;
}

interface PlaybackBarProps {
  document: StoredDocument | null;
  status: string;
  activeIndex: number;
  error: string | null;
  message: string | null;
  onToggle: () => void;
  onSettings: () => void;
  onDelete: () => void;
}

function PlaybackBar({
  document,
  status,
  activeIndex,
  error,
  message,
  onToggle,
  onSettings,
  onDelete
}: PlaybackBarProps) {
  const disabled = !document || document.segments.length === 0;
  const isBusy = status === "loading";
  const isPlaying = status === "playing";
  const isActive = isPlaying || isBusy;
  const isDocumentExtracting = Boolean(document && isExtractingPdf(document));

  return (
    <footer className="playback-bar">
      <div className={isDocumentExtracting ? "playback-progress is-indeterminate" : "playback-progress"} aria-hidden="true">
        <span
          style={{
            width: document && !isDocumentExtracting ? `${Math.max(1, ((activeIndex + 1) / document.segments.length) * 100)}%` : "0%"
          }}
        />
      </div>
      <button className="round-control" type="button" disabled={disabled} onClick={onToggle} aria-label={isActive ? "Pause" : "Play"}>
        {isActive ? <Pause size={25} /> : <Play size={25} />}
      </button>
      <div className="playback-meta">
        <strong>{document ? playbackPrimaryLabel(document, activeIndex) : "Ready"}</strong>
        <span>{error ?? playbackStatusLabel(message, status, document)}</span>
      </div>
      <button className="icon-button" type="button" onClick={onSettings} aria-label="Playback settings">
        <SlidersHorizontal size={21} />
      </button>
      <button className="icon-button danger" type="button" disabled={!document} onClick={onDelete} aria-label="Delete document">
        <Trash2 size={20} />
      </button>
    </footer>
  );
}

function SettingsSheet({
  settings,
  voices,
  speechSupported,
  voicesLoaded,
  wakeLockSupported,
  onClose,
  onChange
}: {
  settings: ReaderSettings;
  voices: SpeechSynthesisVoice[];
  speechSupported: boolean;
  voicesLoaded: boolean;
  wakeLockSupported: boolean;
  onClose: () => void;
  onChange: (settings: Partial<ReaderSettings>) => void;
}) {
  const voiceOptions = voicesToOptions(voices);
  const voiceGroups = groupVoiceOptionsByLanguage(voiceOptions);
  const selectedVoiceURI = voiceOptions.some((voice) => voice.voiceURI === settings.voiceURI)
    ? settings.voiceURI
    : SYSTEM_VOICE_URI;
  const capabilityNotes = [
    !speechSupported ? "Android speech is not available in this browser." : "",
    speechSupported && voicesLoaded && voiceOptions.length === 0 ? "No English device voices reported yet." : "",
    !wakeLockSupported ? "Keep awake is not supported in this browser." : ""
  ].filter(Boolean);

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="settings-sheet" role="dialog" aria-modal="true" aria-label="Reader settings" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>Settings</h2>
            <p>{speechSupported ? languageLabel(ENGLISH_SPEECH_LANGUAGE) : "Speech unavailable"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings">
            <X size={21} />
          </button>
        </header>

        <label className="field">
          <span>Voice</span>
          <select
            id="voice"
            name="voice"
            value={selectedVoiceURI}
            onChange={(event) => onChange({ voiceURI: event.currentTarget.value })}
            disabled={!speechSupported}
          >
            <option value={SYSTEM_VOICE_URI}>System default</option>
            {[...voiceGroups.entries()].map(([language, options]) => (
              <optgroup key={language} label={languageLabel(language)}>
                {options.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="range-field">
          <span>
            <Gauge size={18} />
            Speed
            <strong>{settings.speed.toFixed(1)}x</strong>
          </span>
          <input
            id="speed"
            name="speed"
            type="range"
            min="0.6"
            max="2.5"
            step="0.1"
            value={settings.speed}
            onChange={(event) => onChange({ speed: Number(event.currentTarget.value) })}
          />
        </label>

        <label className="range-field">
          <span>
            <SlidersHorizontal size={18} />
            Tone
            <strong>{settings.pitch.toFixed(1)}</strong>
          </span>
          <input
            id="pitch"
            name="pitch"
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={settings.pitch}
            onChange={(event) => onChange({ pitch: Number(event.currentTarget.value) })}
          />
        </label>

        <label className="range-field">
          <span>
            <Volume2 size={18} />
            Volume
            <strong>{Math.round(settings.volume * 100)}%</strong>
          </span>
          <input
            id="volume"
            name="volume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.volume}
            onChange={(event) => onChange({ volume: Number(event.currentTarget.value) })}
          />
        </label>

        <label className="range-field">
          <span>
            <Pause size={18} />
            Window pause
            <strong>{formatParagraphGap(settings.paragraphGapMs)}</strong>
          </span>
          <input
            id="paragraph-gap"
            name="paragraph-gap"
            type="range"
            min="0"
            max="3000"
            step="100"
            value={settings.paragraphGapMs}
            onChange={(event) => onChange({ paragraphGapMs: Number(event.currentTarget.value) })}
          />
        </label>

        <label className="toggle-field">
          <input
            id="auto-advance"
            name="auto-advance"
            type="checkbox"
            checked={settings.autoAdvance}
            onChange={(event) => onChange({ autoAdvance: event.currentTarget.checked })}
          />
          <span>Auto-advance</span>
        </label>

        <label className="toggle-field">
          <input
            id="keep-awake"
            name="keep-awake"
            type="checkbox"
            checked={settings.keepAwake && wakeLockSupported}
            disabled={!wakeLockSupported}
            onChange={(event) => onChange({ keepAwake: event.currentTarget.checked })}
          />
          <span>Keep screen awake</span>
        </label>

        {capabilityNotes.length > 0 && <p className="capability-note">{capabilityNotes.join(" ")}</p>}
      </section>
    </div>
  );
}

function playbackPrimaryLabel(document: StoredDocument, activeIndex: number): string {
  if (isExtractingPdf(document)) {
    return `Paragraph ${activeIndex + 1}`;
  }

  return `${activeIndex + 1} / ${document.segments.length}`;
}

function playbackStatusLabel(message: string | null, status: string, document: StoredDocument | null): string {
  if (message) {
    return message;
  }
  if (status === "loading") {
    return "Preparing speech";
  }
  if (status === "paused") {
    return "Paused";
  }
  if (status === "playing") {
    return "Reading";
  }
  if (document && isExtractingPdf(document)) {
    return documentSubtitle(document);
  }
  return "Tap a paragraph";
}

function formatParagraphGap(milliseconds: number): string {
  return milliseconds === 0 ? "Off" : `${(milliseconds / 1000).toFixed(1)}s`;
}

function BookImportOverlay({ progress }: { progress: ImportProgress }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const pageLabel =
    progress.pageCount && progress.pageNumber
      ? `Page ${progress.pageNumber} of ${progress.pageCount}`
      : progress.phase === "extracting"
        ? "Scanning pages"
        : "Preparing text";

  return (
    <div className="book-loader-backdrop" role="status" aria-live="polite" aria-label={`Importing book ${percent}%`}>
      <section className="book-loader">
        <div className="book-stage" aria-hidden="true">
          <div className="book-cover" />
          <div className="book-page left-page">
            <span>{pageLabel}</span>
            <strong>{percent}%</strong>
          </div>
          <div className="book-page right-page">
            <span>{progress.message}</span>
            <strong>{percent}%</strong>
          </div>
          <div className="turning-page" />
        </div>
        <div className="loader-copy">
          <strong>{progress.message}</strong>
          <span>{pageLabel}</span>
        </div>
        <div className="loader-progress" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
      </section>
    </div>
  );
}

function BackgroundImportBanner({ title, progress }: { title: string; progress: ImportProgress }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const pageLabel =
    progress.pageCount && progress.pageNumber
      ? `${progress.pageNumber} / ${progress.pageCount} pages`
      : "Loading pages";

  return (
    <section className="background-import" aria-live="polite">
      <div>
        <strong>{title}</strong>
        <span>{progress.message}</span>
      </div>
      <em>{pageLabel}</em>
      <div className="background-import-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

function mergeImportProgress(current: ImportProgress | null, next: ImportProgress): ImportProgress {
  return {
    ...next,
    pageNumber: next.pageNumber ?? current?.pageNumber,
    pageCount: next.pageCount ?? current?.pageCount
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function documentSubtitle(document: StoredDocument): string {
  if (isExtractingPdf(document)) {
    const pagesLoaded = document.extraction?.pagesLoaded ?? 0;
    const pageCount = document.extraction?.pageCount ?? 0;
    return pageCount > 0 ? `${pagesLoaded} / ${pageCount} pages loaded` : "Loading pages";
  }

  if (document.kind === "pdf" && document.extraction?.pageCount) {
    return `${document.extraction.pageCount} pages`;
  }

  return `${document.segments.length} paragraphs`;
}

function isExtractingPdf(document: StoredDocument): boolean {
  return document.kind === "pdf" && document.extraction?.status === "extracting";
}

export default App;
