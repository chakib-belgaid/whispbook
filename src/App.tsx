import {
  BookOpen,
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Feather,
  FileAudio,
  FileText,
  FileUp,
  Loader2,
  Mic2,
  Play,
  Redo2,
  Save,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCustomStyle,
  createPreview,
  getBook,
  getBooks,
  getHealth,
  getJob,
  getStyles,
  getTtsCapabilities,
  importBook,
  mediaUrl,
  saveBook,
  startGeneration,
} from "./lib/api";
import {
  importBooksSequential,
  mergeLibraryBooks,
  planLibraryImports,
  shouldGuardBookChange,
  type BookImportFailure,
} from "./lib/bookLibrary";
import {
  buildGenerationScript,
  defaultBackendUrlFromLocation,
  downloadTextFile,
  generationScriptFilename,
} from "./lib/generationScript";
import type {
  Book,
  Chapter,
  EngineCapabilities,
  EngineName,
  GenerateJob,
  HealthResponse,
  Paragraph,
  StyleOverride,
  TTSCapabilities,
  VoiceStyle,
} from "./types";

const defaultStyleDraft: StyleOverride = {
  style_id: "fantasy",
  engine: "kokoro",
  voice: "bm_george",
  language: "b",
  speed: 0.91,
  exaggeration: 0.5,
  cfg_weight: 0.5,
  temperature: 0.8,
  top_p: 1,
  paragraph_gap_ms: 620,
  comma_pause_ms: 190,
  prompt_prefix: "",
};

const documentImportAccept = [
  "application/pdf",
  ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsx",
  "application/vnd.ms-excel",
  ".xls",
  "application/epub+zip",
  ".epub",
  "text/html",
  ".html",
  ".htm",
  "text/plain",
  ".txt",
  "text/markdown",
  ".md",
  "text/csv",
  ".csv",
  "application/json",
  ".json",
  "application/xml",
  "text/xml",
  ".xml",
].join(",");

type NumericStyleKey = Extract<
  keyof StyleOverride,
  | "speed"
  | "exaggeration"
  | "cfg_weight"
  | "temperature"
  | "top_p"
  | "paragraph_gap_ms"
  | "comma_pause_ms"
>;

type WorkbenchPane = "book" | "manuscript" | "render";
type PendingBookChange =
  | { type: "switch"; bookId: string }
  | { type: "import"; files: File[] };

interface ChapterEditSnapshot {
  title: string;
  selected: boolean;
  paragraphs: Array<{
    id: string;
    text: string;
    included: boolean;
  }>;
}

interface ChapterEditHistory {
  past: ChapterEditSnapshot[];
  future: ChapterEditSnapshot[];
}

interface RangeSettingConfig {
  key: NumericStyleKey;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  suffix?: string;
}

interface EngineSettingsConfig {
  language: boolean;
  promptPrefix: boolean;
  ranges: RangeSettingConfig[];
}

const engineSettingsByModel: Partial<Record<EngineName, EngineSettingsConfig>> =
  {
    kokoro: {
      language: true,
      promptPrefix: false,
      ranges: [
        {
          key: "speed",
          label: "Speed",
          min: 0.7,
          max: 1.4,
          step: 0.01,
          defaultValue: 1,
          suffix: "x",
        },
        {
          key: "paragraph_gap_ms",
          label: "Paragraph Pause",
          min: 0,
          max: 1500,
          step: 25,
          defaultValue: 450,
          suffix: "ms",
        },
        {
          key: "comma_pause_ms",
          label: "Comma Pause",
          min: 0,
          max: 600,
          step: 20,
          defaultValue: 160,
          suffix: "ms",
        },
      ],
    },
    chatterbox: {
      language: true,
      promptPrefix: true,
      ranges: [
        {
          key: "exaggeration",
          label: "Expression",
          min: 0,
          max: 1.2,
          step: 0.01,
          defaultValue: 0.5,
        },
        {
          key: "cfg_weight",
          label: "CFG",
          min: 0,
          max: 1,
          step: 0.01,
          defaultValue: 0.5,
        },
        {
          key: "temperature",
          label: "Temperature",
          min: 0.2,
          max: 1.2,
          step: 0.01,
          defaultValue: 0.8,
        },
        {
          key: "top_p",
          label: "Top P",
          min: 0.1,
          max: 1,
          step: 0.01,
          defaultValue: 1,
        },
        {
          key: "paragraph_gap_ms",
          label: "Paragraph Pause",
          min: 0,
          max: 1500,
          step: 25,
          defaultValue: 450,
          suffix: "ms",
        },
        {
          key: "comma_pause_ms",
          label: "Comma Pause",
          min: 0,
          max: 600,
          step: 20,
          defaultValue: 160,
          suffix: "ms",
        },
      ],
    },
    chatterbox_turbo: {
      language: false,
      promptPrefix: true,
      ranges: [
        {
          key: "temperature",
          label: "Temperature",
          min: 0.2,
          max: 1.2,
          step: 0.01,
          defaultValue: 0.8,
        },
        {
          key: "top_p",
          label: "Top P",
          min: 0.1,
          max: 1,
          step: 0.01,
          defaultValue: 1,
        },
        {
          key: "paragraph_gap_ms",
          label: "Paragraph Pause",
          min: 0,
          max: 1500,
          step: 25,
          defaultValue: 450,
          suffix: "ms",
        },
        {
          key: "comma_pause_ms",
          label: "Comma Pause",
          min: 0,
          max: 600,
          step: 20,
          defaultValue: 160,
          suffix: "ms",
        },
      ],
    },
    mock: {
      language: false,
      promptPrefix: false,
      ranges: [
        {
          key: "paragraph_gap_ms",
          label: "Paragraph Pause",
          min: 0,
          max: 1500,
          step: 25,
          defaultValue: 450,
          suffix: "ms",
        },
        {
          key: "comma_pause_ms",
          label: "Comma Pause",
          min: 0,
          max: 600,
          step: 20,
          defaultValue: 160,
          suffix: "ms",
        },
      ],
    },
  };

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const styleReferenceRef = useRef<HTMLInputElement | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [styles, setStyles] = useState<VoiceStyle[]>([]);
  const [capabilities, setCapabilities] = useState<TTSCapabilities | null>(
    null,
  );
  const [books, setBooks] = useState<Book[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(
    null,
  );
  const [styleDraft, setStyleDraft] =
    useState<StyleOverride>(defaultStyleDraft);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [job, setJob] = useState<GenerateJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBookChange, setPendingBookChange] =
    useState<PendingBookChange | null>(null);
  const [chapterHistory, setChapterHistory] = useState<
    Record<string, ChapterEditHistory>
  >({});
  const [customName, setCustomName] = useState("");
  const [customEngine, setCustomEngine] = useState<EngineName>("chatterbox");
  const [customParams, setCustomParams] = useState(
    '{"speed": 0.95, "exaggeration": 0.65, "cfg_weight": 0.35}',
  );
  const [customReference, setCustomReference] = useState<File | null>(null);
  const [activePane, setActivePane] = useState<WorkbenchPane>("manuscript");

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") {
      return;
    }

    const timer = window.setInterval(() => {
      void pollJob(job.id);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const activeChapter = useMemo(() => {
    if (!book) {
      return null;
    }
    return (
      book.chapters.find((chapter) => chapter.id === activeChapterId) ??
      book.chapters[0] ??
      null
    );
  }, [activeChapterId, book]);

  const includedChapters = useMemo(
    () => book?.chapters.filter((chapter) => chapter.selected) ?? [],
    [book],
  );
  const allChaptersSelected = Boolean(
    book &&
    book.chapters.length > 0 &&
    includedChapters.length === book.chapters.length,
  );
  const noChaptersSelected = includedChapters.length === 0;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = Boolean(
        book && !allChaptersSelected && !noChaptersSelected,
      );
    }
  }, [allChaptersSelected, book, noChaptersSelected]);

  const selectedParagraph = useMemo(() => {
    if (!activeChapter) {
      return null;
    }
    return (
      activeChapter.paragraphs.find(
        (paragraph) => paragraph.id === selectedParagraphId,
      ) ??
      activeChapter.paragraphs.find((paragraph) => paragraph.included) ??
      activeChapter.paragraphs[0] ??
      null
    );
  }, [activeChapter, selectedParagraphId]);

  const activeHistory = activeChapter ? chapterHistory[activeChapter.id] : null;
  const canUndoChapter = Boolean(activeHistory?.past.length);
  const canRedoChapter = Boolean(activeHistory?.future.length);

  function activateBook(next: Book | null): void {
    setBook(next);
    setActiveChapterId(next?.chapters[0]?.id ?? null);
    setSelectedParagraphId(next?.chapters[0]?.paragraphs[0]?.id ?? null);
    setDirty(false);
    setChapterHistory({});
  }

  async function boot(): Promise<void> {
    setBusy("Loading");
    try {
      const [nextHealth, nextStyles, nextCapabilities, nextBooks] =
        await Promise.all([
          getHealth(),
          getStyles(),
          getTtsCapabilities(),
          getBooks(),
        ]);
      setHealth(nextHealth);
      setStyles(nextStyles);
      setCapabilities(nextCapabilities);
      setBooks(nextBooks);
      const firstBook = nextBooks[0] ?? null;
      activateBook(firstBook);
      const preferredStyle =
        nextStyles.find((style) => style.id === "fantasy") ??
        nextStyles.find((style) => style.id === "neutral") ??
        nextStyles[0];
      if (preferredStyle) {
        setStyleDraft(
          normalizeStyleDraft(styleToDraft(preferredStyle), nextCapabilities),
        );
      }
      setError(null);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleImportSelection(fileList: FileList | null): void {
    const files = Array.from(fileList ?? []);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (files.length === 0) {
      return;
    }

    const action: PendingBookChange = { type: "import", files };
    if (shouldGuardBookChange(dirty, book?.id ?? null)) {
      setPendingBookChange(action);
      return;
    }

    void runBookChange(action);
  }

  async function importSelectedBooks(files: File[]): Promise<void> {
    setError(null);
    try {
      const importPlan = planLibraryImports(files, books);
      const result = await importBooksSequential(
        importPlan.filesToImport,
        importBook,
        (current, total) => setBusy(`Importing ${current} of ${total}`),
      );
      const availableBooks = [...importPlan.reused, ...result.imported];
      if (availableBooks.length > 0) {
        setBooks((current) => mergeLibraryBooks(current, availableBooks));
        activateBook(availableBooks[0]);
      }
      if (result.failures.length > 0) {
        setError(formatImportFailures(result.failures));
      } else {
        setError(null);
      }
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(null);
    }
  }

  function requestBookSwitch(bookId: string): void {
    if (book?.id === bookId) {
      return;
    }

    const action: PendingBookChange = { type: "switch", bookId };
    if (shouldGuardBookChange(dirty, book?.id ?? null, bookId)) {
      setPendingBookChange(action);
      return;
    }

    void runBookChange(action);
  }

  async function runBookChange(action: PendingBookChange): Promise<void> {
    if (action.type === "switch") {
      const next = books.find((item) => item.id === action.bookId) ?? null;
      activateBook(next);
      return;
    }

    await importSelectedBooks(action.files);
  }

  async function savePendingBookChange(): Promise<void> {
    if (!pendingBookChange) {
      return;
    }
    const action = pendingBookChange;
    const saved = await persistBook();
    if (!saved) {
      return;
    }
    setPendingBookChange(null);
    await runBookChange(action);
  }

  async function discardPendingBookChange(): Promise<void> {
    if (!pendingBookChange) {
      return;
    }
    const action = pendingBookChange;
    setPendingBookChange(null);
    discardActiveBookEdits();
    await runBookChange(action);
  }

  function discardActiveBookEdits(): void {
    if (!book) {
      setDirty(false);
      return;
    }
    activateBook(books.find((item) => item.id === book.id) ?? book);
  }

  async function persistBook(): Promise<Book | null> {
    if (!book) {
      return null;
    }
    setBusy("Saving");
    try {
      const saved = await saveBook(book);
      setBook(saved);
      setBooks((current) => mergeLibraryBooks(current, [saved]));
      setDirty(false);
      setError(null);
      return saved;
    } catch (caught) {
      setError(messageFromError(caught));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handlePreview(): Promise<void> {
    if (!book || !selectedParagraph) {
      return;
    }
    setBusy("Previewing");
    setError(null);
    try {
      const preview = await createPreview(
        book.id,
        selectedParagraph.text,
        styleDraft,
        selectedParagraph.text,
      );
      setPreviewUrl(preview.audio_url);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!book) {
      return;
    }
    const saved = dirty ? await persistBook() : book;
    if (!saved) {
      return;
    }
    const chapterIds = saved.chapters
      .filter((chapter) => chapter.selected)
      .map((chapter) => chapter.id);
    if (chapterIds.length === 0) {
      setError("Select at least one chapter.");
      return;
    }
    setBusy("Starting");
    setError(null);
    try {
      const nextJob = await startGeneration(saved.id, chapterIds, styleDraft);
      setJob(nextJob);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleExportScript(): void {
    if (!book) {
      return;
    }
    try {
      const script = buildGenerationScript(book, styleDraft, {
        defaultApiUrl: defaultBackendUrlFromLocation(window.location),
      });
      downloadTextFile(
        generationScriptFilename(book),
        script,
        "text/x-python;charset=utf-8",
      );
      setError(null);
    } catch (caught) {
      setError(messageFromError(caught));
    }
  }

  async function pollJob(jobId: string): Promise<void> {
    try {
      const nextJob = await getJob(jobId);
      setJob(nextJob);
      if (nextJob.status === "done" || nextJob.status === "error") {
        const refreshed = await getBook(nextJob.book_id);
        setBook(refreshed);
        setBooks((current) => mergeLibraryBooks(current, [refreshed]));
      }
    } catch (caught) {
      setError(messageFromError(caught));
    }
  }

  async function handleCustomStyle(): Promise<void> {
    if (!customName.trim()) {
      setError("Name the custom style.");
      return;
    }
    setBusy("Saving style");
    setError(null);
    try {
      const created = await createCustomStyle({
        name: customName,
        engine: customEngine,
        paramsJson: customParams,
        referenceAudio: customReference,
      });
      setStyles((current) => [
        created,
        ...current.filter((style) => style.id !== created.id),
      ]);
      setStyleDraft(styleToDraft(created));
      setCustomName("");
      setCustomReference(null);
      if (styleReferenceRef.current) {
        styleReferenceRef.current.value = "";
      }
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleStyleImport(fileList: FileList | null): Promise<void> {
    const file = fileList?.[0];
    if (!file) {
      return;
    }
    const fileName = file.name.toLowerCase();
    const isStyleFile =
      fileName.endsWith(".json") || fileName.endsWith(".whisp");
    if (!isStyleFile) {
      setCustomReference(file);
      setCustomName((current) =>
        current.trim()
          ? current
          : file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      );
      setError(null);
      if (styleReferenceRef.current) {
        styleReferenceRef.current.value = "";
      }
      return;
    }

    try {
      const payload = JSON.parse(await file.text()) as Record<string, unknown>;
      const params =
        payload.params &&
        typeof payload.params === "object" &&
        !Array.isArray(payload.params)
          ? (payload.params as Record<string, unknown>)
          : payload;
      const nextEngine =
        typeof payload.engine === "string" && isEngineName(payload.engine)
          ? payload.engine
          : customEngine;
      setCustomEngine(nextEngine);
      setCustomName(
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name
          : file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      );
      setCustomParams(JSON.stringify(params, null, 2));
      setCustomReference(null);
      setError(null);
    } catch (caught) {
      setError(`Could not import style file: ${messageFromError(caught)}`);
    } finally {
      if (styleReferenceRef.current) {
        styleReferenceRef.current.value = "";
      }
    }
  }

  function updateBookTitle(title: string): void {
    updateBook((current) => ({ ...current, title }));
  }

  function updateChapter(
    chapterId: string,
    updater: (chapter: Chapter) => Chapter,
    options: { recordHistory?: boolean } = {},
  ): void {
    const recordHistory = options.recordHistory ?? true;
    updateBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => {
        if (chapter.id !== chapterId) {
          return chapter;
        }
        const nextChapter = updater(chapter);
        if (
          recordHistory &&
          !chapterSnapshotEquals(
            chapterEditSnapshot(chapter),
            chapterEditSnapshot(nextChapter),
          )
        ) {
          pushChapterHistory(chapterId, chapterEditSnapshot(chapter));
        }
        return nextChapter;
      }),
    }));
  }

  function undoActiveChapter(): void {
    if (!activeChapter) {
      return;
    }
    const history = chapterHistory[activeChapter.id];
    const previous = history?.past.at(-1);
    if (!history || !previous) {
      return;
    }

    setChapterHistory((current) => ({
      ...current,
      [activeChapter.id]: {
        past: history.past.slice(0, -1),
        future: [chapterEditSnapshot(activeChapter), ...history.future],
      },
    }));
    applyChapterSnapshot(activeChapter.id, previous);
  }

  function redoActiveChapter(): void {
    if (!activeChapter) {
      return;
    }
    const history = chapterHistory[activeChapter.id];
    const next = history?.future[0];
    if (!history || !next) {
      return;
    }

    setChapterHistory((current) => ({
      ...current,
      [activeChapter.id]: {
        past: [...history.past, chapterEditSnapshot(activeChapter)],
        future: history.future.slice(1),
      },
    }));
    applyChapterSnapshot(activeChapter.id, next);
  }

  function applyChapterSnapshot(
    chapterId: string,
    snapshot: ChapterEditSnapshot,
  ): void {
    updateChapter(
      chapterId,
      (chapter) => restoreChapterEditSnapshot(chapter, snapshot),
      { recordHistory: false },
    );
  }

  function pushChapterHistory(
    chapterId: string,
    snapshot: ChapterEditSnapshot,
  ): void {
    setChapterHistory((current) => {
      const history = current[chapterId] ?? { past: [], future: [] };
      const lastSnapshot = history.past.at(-1);
      if (lastSnapshot && chapterSnapshotEquals(lastSnapshot, snapshot)) {
        return current;
      }
      return {
        ...current,
        [chapterId]: {
          past: [...history.past.slice(-79), snapshot],
          future: [],
        },
      };
    });
  }

  function setAllChaptersSelected(selected: boolean): void {
    updateBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({ ...chapter, selected })),
    }));
  }

  function updateParagraph(
    chapterId: string,
    paragraphId: string,
    updater: (paragraph: Paragraph) => Paragraph,
  ): void {
    updateChapter(chapterId, (chapter) => ({
      ...chapter,
      paragraphs: chapter.paragraphs.map((paragraph) =>
        paragraph.id === paragraphId ? updater(paragraph) : paragraph,
      ),
    }));
  }

  function updateBook(updater: (book: Book) => Book): void {
    setBook((current) => {
      if (!current) {
        return current;
      }
      setDirty(true);
      return updater(current);
    });
  }

  const activeCapabilities = capabilityForEngine(
    capabilities,
    styleDraft.engine,
  );
  const languageOptions = activeCapabilities?.languages ?? [];
  const voiceOptions = voiceOptionsForLanguage(
    activeCapabilities,
    styleDraft.language,
  );
  const activeEngineSettings = settingsForEngine(styleDraft.engine);

  const selectedStyleName =
    styles.find((style) => style.id === styleDraft.style_id)?.name ?? "Fantasy";
  const isImporting = busy?.startsWith("Importing") ?? false;

  return (
    <main className="app-shell">
      <header className="status-strip" aria-label="System status">
        <span>Engine: {formatEngineName(styleDraft.engine)}</span>
        <span aria-hidden="true">|</span>
        <span>Renderer: {health?.ffmpeg ? "FFMPEG" : "Unavailable"}</span>
        <span aria-hidden="true">|</span>
        <span>Style: {selectedStyleName}</span>
        <button
          className="status-config-button"
          type="button"
          title="Show render settings"
          aria-label="Show render settings"
          onClick={() => setActivePane("render")}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {!book && (
        <EmptyState
          busy={busy}
          onUpload={() => fileInputRef.current?.click()}
        />
      )}

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept={documentImportAccept}
        multiple
        onChange={(event) => handleImportSelection(event.currentTarget.files)}
      />

      {book && (
        <>
        <nav className="pane-switcher" aria-label="Workspace panes">
          <button
            className={activePane === "book" ? "pane-tab is-active" : "pane-tab"}
            type="button"
            aria-pressed={activePane === "book"}
            onClick={() => setActivePane("book")}
          >
            <BookOpen size={17} aria-hidden="true" />
            <span>Book</span>
          </button>
          <button
            className={
              activePane === "manuscript" ? "pane-tab is-active" : "pane-tab"
            }
            type="button"
            aria-pressed={activePane === "manuscript"}
            onClick={() => setActivePane("manuscript")}
          >
            <FileText size={17} aria-hidden="true" />
            <span>Manuscript</span>
          </button>
          <button
            className={
              activePane === "render" ? "pane-tab is-active" : "pane-tab"
            }
            type="button"
            aria-pressed={activePane === "render"}
            onClick={() => setActivePane("render")}
          >
            <FileAudio size={17} aria-hidden="true" />
            <span>Render</span>
          </button>
        </nav>

        <section
          className="workspace"
          aria-label="Whispbook manuscript workstation"
        >
          <div
            className={
              activePane === "book"
                ? "workspace-zone book-zone is-mobile-active"
                : "workspace-zone book-zone"
            }
          >
            <div className="zone-backdrop" aria-hidden="true" />
            <div className="zone-overlay" aria-hidden="true" />
            <aside
              className="chapter-panel book-cover zone-content"
              aria-label="Book and chapters"
            >
            <div className="sidebar-brand">
              <Feather size={38} aria-hidden="true" />
              <div>
                <h1>Whispbook</h1>
                <p>Audiobook Alchemy</p>
              </div>
            </div>

            <div className="sidebar-actions">
              <button
                className="primary-action upload-action"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp size={18} />
                <span>
                  {isImporting ? busy : "Upload Book"}
                </span>
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={!dirty || Boolean(busy)}
                onClick={() => void persistBook()}
              >
                <Save size={18} />
                <span>{dirty ? "Save Edits" : "Saved"}</span>
              </button>
            </div>

            <label className="field book-title-field">
              <span>Book</span>
              <span className="book-title-control">
                <BookOpen size={21} aria-hidden="true" />
                <input
                  value={book.title}
                  onChange={(event) =>
                    updateBookTitle(event.currentTarget.value)
                  }
                />
              </span>
            </label>
            {books.length > 1 && (
              <label className="field book-switch-field">
                <span>Library</span>
                <select
                  value={book.id}
                  onChange={(event) =>
                    requestBookSwitch(event.currentTarget.value)
                  }
                >
                  {books.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="panel-heading chapter-heading">
              <div>
                <h2>Chapters</h2>
                <span>{includedChapters.length} selected</span>
              </div>
              <label className="select-all-field">
                <input
                  ref={selectAllCheckboxRef}
                  type="checkbox"
                  checked={allChaptersSelected}
                  disabled={!book.chapters.length}
                  onChange={(event) =>
                    setAllChaptersSelected(event.currentTarget.checked)
                  }
                />
                <span>Select all</span>
              </label>
            </div>

            <div className="chapter-list">
              {book.chapters.map((chapter) => (
                <ChapterRow
                  key={chapter.id}
                  chapter={chapter}
                  active={chapter.id === activeChapter?.id}
                  job={job}
                  onOpen={() => {
                    setActiveChapterId(chapter.id);
                    setSelectedParagraphId(
                      chapter.paragraphs.find((paragraph) => paragraph.included)
                        ?.id ??
                        chapter.paragraphs[0]?.id ??
                        null,
                    );
                    setActivePane("manuscript");
                  }}
                  onToggle={(selected) =>
                    updateChapter(chapter.id, (current) => ({
                      ...current,
                      selected,
                    }))
                  }
                />
              ))}
            </div>
            </aside>
          </div>

          <div
            className={
              activePane === "manuscript"
                ? "workspace-zone manuscript-zone is-mobile-active"
                : "workspace-zone manuscript-zone"
            }
          >
            <div className="zone-backdrop" aria-hidden="true" />
            <div className="zone-overlay" aria-hidden="true" />
            <section
              className="editor-panel manuscript-stage zone-content"
              aria-label="Manuscript workspace"
            >
            {activeChapter && (
              <>
                <div className="manuscript-page">
                  <ManuscriptControls
                    busy={busy}
                    dirty={dirty}
                    canUndo={canUndoChapter}
                    canRedo={canRedoChapter}
                    onUndo={undoActiveChapter}
                    onRedo={redoActiveChapter}
                    onSave={() => void persistBook()}
                  />
                  <label className="markdown-heading">
                    <span aria-hidden="true">#</span>
                    <input
                      aria-label="Chapter markdown heading"
                      spellCheck={false}
                      value={activeChapter.title}
                      onChange={(event) => {
                        const title = event.currentTarget.value;
                        updateChapter(activeChapter.id, (current) => ({
                          ...current,
                          title,
                        }));
                      }}
                    />
                  </label>
                  <div className="paragraph-list manuscript-flow markdown-flow">
                    {activeChapter.paragraphs.map((paragraph) => (
                      <article
                        key={paragraph.id}
                        tabIndex={0}
                        aria-current={
                          paragraph.id === selectedParagraph?.id
                            ? "true"
                            : undefined
                        }
                        className={
                          paragraph.id === selectedParagraph?.id
                            ? "paragraph-block is-selected"
                            : "paragraph-block"
                        }
                        onClick={() => setSelectedParagraphId(paragraph.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            setSelectedParagraphId(paragraph.id);
                          }
                        }}
                      >
                        <label
                          className="paragraph-number"
                          aria-label={`Include paragraph ${paragraph.index + 1}`}
                        >
                          <input
                            type="checkbox"
                            checked={paragraph.included}
                            onChange={(event) => {
                              const included = event.currentTarget.checked;
                              updateParagraph(
                                activeChapter.id,
                                paragraph.id,
                                (current) => ({ ...current, included }),
                              );
                            }}
                            onClick={(event) => event.stopPropagation()}
                          />
                          <span>{formatParagraphNumber(paragraph.index)}</span>
                        </label>
                        <div className="paragraph-copy">
                          <textarea
                            className="markdown-paragraph-editor"
                            value={paragraph.text}
                            disabled={!paragraph.included}
                            spellCheck={false}
                            rows={Math.max(
                              1,
                              Math.min(
                                8,
                                Math.ceil(paragraph.text.length / 88),
                              ),
                            )}
                            onFocus={() => setSelectedParagraphId(paragraph.id)}
                            onChange={(event) => {
                              const text = event.currentTarget.value;
                              updateParagraph(
                                activeChapter.id,
                                paragraph.id,
                                (current) => ({ ...current, text }),
                              );
                            }}
                          />
                        </div>
                        {paragraph.id === selectedParagraph?.id && (
                          <div
                            className="selected-paragraph-toolbar"
                            aria-label="Selected paragraph actions"
                          >
                            <button
                              type="button"
                              aria-label="Preview paragraph"
                              title="Preview paragraph"
                              disabled={Boolean(busy)}
                              onClick={() => void handlePreview()}
                            >
                              <Play size={17} />
                            </button>
                            <button
                              type="button"
                              aria-label="Remove paragraph"
                              title="Remove paragraph"
                              onClick={() =>
                                updateParagraph(
                                  activeChapter.id,
                                  paragraph.id,
                                  (current) => ({
                                    ...current,
                                    included: false,
                                  }),
                                )
                              }
                            >
                              <Trash2 size={17} />
                            </button>
                            <button
                              type="button"
                              aria-label="Mark paragraph"
                              title="Mark paragraph"
                              onClick={() =>
                                updateParagraph(
                                  activeChapter.id,
                                  paragraph.id,
                                  (current) => ({ ...current, included: true }),
                                )
                              }
                            >
                              <Bookmark size={17} />
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              </>
            )}
            </section>
          </div>

          <div
            className={
              activePane === "render"
                ? "workspace-zone controls-zone is-mobile-active"
                : "workspace-zone controls-zone"
            }
          >
            <div className="zone-backdrop" aria-hidden="true" />
            <div className="zone-overlay" aria-hidden="true" />
            <aside
              className="render-panel settings-scroll zone-content"
              aria-label="Voice timing output and style settings"
            >
            <section className="settings-section">
              <div className="settings-heading">
                <Mic2 size={19} aria-hidden="true" />
                <h2>Voice</h2>
              </div>
              <label className="field">
                <span>Engine</span>
                <select
                  value={styleDraft.engine}
                  onChange={(event) => {
                    const engine = event.currentTarget.value as EngineName;
                    setStyleDraft((current) =>
                      normalizeStyleDraft({ ...current, engine }, capabilities),
                    );
                  }}
                >
                  <option value="kokoro">Kokoro</option>
                  <option value="chatterbox">Chatterbox</option>
                  <option value="chatterbox_turbo">Chatterbox Turbo</option>
                </select>
              </label>
              <label className="field">
                <span>Voice</span>
                <select
                  value={styleDraft.voice ?? voiceOptions[0]?.value ?? ""}
                  disabled={voiceOptions.length === 0}
                  onChange={(event) =>
                    setStyleDraft((current) => ({
                      ...current,
                      voice: event.currentTarget.value,
                    }))
                  }
                >
                  {voiceOptions.map((voice) => (
                    <option key={voice.value} value={voice.value}>
                      {voice.label} ({voice.value})
                    </option>
                  ))}
                </select>
              </label>
              {activeEngineSettings.language && (
                <label className="field">
                  <span>Language</span>
                  <select
                    value={
                      styleDraft.language ?? languageOptions[0]?.value ?? ""
                    }
                    disabled={languageOptions.length === 0}
                    onChange={(event) => {
                      const language = event.currentTarget.value;
                      setStyleDraft((current) =>
                        normalizeStyleDraft(
                          { ...current, language },
                          capabilities,
                        ),
                      );
                    }}
                  >
                    {languageOptions.map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {activeEngineSettings.promptPrefix && (
                <label className="field tts-prompt-field">
                  <span>Prompt Prefix</span>
                  <textarea
                    rows={3}
                    value={styleDraft.prompt_prefix ?? ""}
                    onChange={(event) =>
                      setStyleDraft((current) => ({
                        ...current,
                        prompt_prefix: event.currentTarget.value,
                      }))
                    }
                  />
                </label>
              )}
            </section>

            <section className="settings-section">
              <div className="settings-heading">
                <Clock3 size={19} aria-hidden="true" />
                <h2>Timing</h2>
              </div>
              {activeEngineSettings.ranges.map((control) => (
                <RangeControl
                  key={control.key}
                  label={control.label}
                  value={styleDraft[control.key] ?? control.defaultValue}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  suffix={control.suffix}
                  onChange={(value) =>
                    setStyleDraft((current) => ({
                      ...current,
                      [control.key]: value,
                    }))
                  }
                />
              ))}
            </section>

            <section className="settings-section output-section">
              <div className="settings-heading">
                <FileAudio size={19} aria-hidden="true" />
                <h2>Output</h2>
              </div>
              <div className="output-actions">
                <button
                  className="secondary-action"
                  type="button"
                  disabled={!selectedParagraph || Boolean(busy)}
                  onClick={() => void handlePreview()}
                >
                  <Play size={18} />
                  <span>
                    {busy === "Previewing" ? "Previewing" : "Preview"}
                  </span>
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={!book || noChaptersSelected}
                  onClick={handleExportScript}
                >
                  <FileText size={18} />
                  <span>Export Script</span>
                </button>
                <button
                  className="generate-action"
                  type="button"
                  disabled={!book || Boolean(busy)}
                  onClick={() => void handleGenerate()}
                >
                  <Sparkles size={20} />
                  <span>
                    {busy === "Starting" ? "Starting" : "Generate Audiobook"}
                  </span>
                  <ChevronRight size={20} />
                </button>
              </div>
              {previewUrl && (
                <div className="audio-result">
                  <audio controls src={mediaUrl(previewUrl)} />
                </div>
              )}
            </section>

            <section className="settings-section style-preset-section">
              <div className="settings-heading">
                <Wand2 size={19} aria-hidden="true" />
                <h2>Style Preset</h2>
              </div>
              <label className="field">
                <span>Preset</span>
                <select
                  value={styleDraft.style_id}
                  onChange={(event) => {
                    const next = styles.find(
                      (style) => style.id === event.currentTarget.value,
                    );
                    if (next) {
                      setStyleDraft(
                        normalizeStyleDraft(styleToDraft(next), capabilities),
                      );
                      setPreviewUrl(null);
                    }
                  }}
                >
                  {styles.map((style) => (
                    <option key={style.id} value={style.id}>
                      {style.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="style-import-row">
                <input
                  ref={styleReferenceRef}
                  className="visually-hidden"
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.json,.whisp"
                  onChange={(event) =>
                    void handleStyleImport(event.currentTarget.files)
                  }
                />
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => styleReferenceRef.current?.click()}
                >
                  <Upload size={18} />
                  <span>Import Style File</span>
                </button>
                <small>json, .whisp, audio</small>
              </div>
              {(customReference || customName.trim()) && (
                <details className="advanced-style" open>
                  <summary>Advanced style params</summary>
                  <div className="control-grid">
                    <label className="field style-name-field">
                      <span>Import name</span>
                      <input
                        placeholder="Custom style name"
                        value={customName}
                        onChange={(event) =>
                          setCustomName(event.currentTarget.value)
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Engine</span>
                      <select
                        value={customEngine}
                        onChange={(event) =>
                          setCustomEngine(
                            event.currentTarget.value as EngineName,
                          )
                        }
                      >
                        <option value="chatterbox">Chatterbox</option>
                        <option value="chatterbox_turbo">
                          Chatterbox Turbo
                        </option>
                        <option value="kokoro">Kokoro</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Params JSON</span>
                      <textarea
                        rows={3}
                        value={customParams}
                        onChange={(event) =>
                          setCustomParams(event.currentTarget.value)
                        }
                      />
                    </label>
                  </div>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void handleCustomStyle()}
                  >
                    <Check size={18} />
                    <span>Save Style</span>
                  </button>
                </details>
              )}
            </section>

            {job && (
              <section
                className="settings-section job-panel"
                aria-live="polite"
              >
                <div className="panel-heading">
                  <h2>Generation</h2>
                  <span>{Math.round(job.progress)}%</span>
                </div>
                <div className="progress-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(1, job.progress)}%` }} />
                </div>
                <p
                  className={
                    job.status === "error"
                      ? "job-message is-error"
                      : "job-message"
                  }
                >
                  {job.error ?? job.message}
                </p>
                <div className="job-chapters">
                  {job.chapters.map((chapter) => (
                    <div key={chapter.chapter_id} className="job-chapter">
                      <span>{chapter.title}</span>
                      <StatusBadge status={chapter.status} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <Downloads book={book} />
            </aside>
          </div>
        </section>
        </>
      )}

      {pendingBookChange && book && (
        <UnsavedBookDialog
          bookTitle={book.title}
          pendingChange={pendingBookChange}
          busy={busy}
          onSave={() => void savePendingBookChange()}
          onDiscard={() => void discardPendingBookChange()}
          onCancel={() => setPendingBookChange(null)}
        />
      )}
    </main>
  );
}

function UnsavedBookDialog({
  bookTitle,
  pendingChange,
  busy,
  onSave,
  onDiscard,
  onCancel,
}: {
  bookTitle: string;
  pendingChange: PendingBookChange;
  busy: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const target =
    pendingChange.type === "import"
      ? `import ${pendingChange.files.length} ${
          pendingChange.files.length === 1 ? "book" : "books"
        }`
      : "switch books";
  const busySaving = busy === "Saving";

  return (
    <div className="save-guard-backdrop" role="presentation">
      <section
        className="save-guard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-guard-title"
        aria-describedby="save-guard-copy"
      >
        <h2 id="save-guard-title">Unsaved edits</h2>
        <p id="save-guard-copy">
          Save changes to <strong>{bookTitle}</strong> before you {target}?
        </p>
        <div className="save-guard-actions">
          <button
            className="primary-action"
            type="button"
            disabled={Boolean(busy)}
            onClick={onSave}
          >
            <Save size={18} aria-hidden="true" />
            <span>{busySaving ? "Saving" : "Save"}</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={Boolean(busy)}
            onClick={onDiscard}
          >
            Discard
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={Boolean(busy)}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function ManuscriptControls({
  busy,
  dirty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
}: {
  busy: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}) {
  const isSaving = busy === "Saving";
  const saveLabel = isSaving ? "Saving" : dirty ? "Save" : "Saved";
  const saveStatus = isSaving
    ? "Saving book edits"
    : dirty
      ? "Unsaved book edits"
      : "Book edits saved";

  return (
    <div
      className="manuscript-controls"
      role="group"
      aria-label="Manuscript actions"
    >
      <div
        className="page-action-tabs"
        role="group"
        aria-label="Chapter history"
      >
        <button
          className="page-action-tab"
          type="button"
          aria-label="Undo chapter edit"
          title="Undo chapter edit"
          disabled={!canUndo || Boolean(busy)}
          onClick={onUndo}
        >
          <Undo2 size={17} aria-hidden="true" />
        </button>
        <button
          className="page-action-tab"
          type="button"
          aria-label="Redo chapter edit"
          title="Redo chapter edit"
          disabled={!canRedo || Boolean(busy)}
          onClick={onRedo}
        >
          <Redo2 size={17} aria-hidden="true" />
        </button>
      </div>
      <div className="page-ornament" aria-hidden="true">
        <span />
      </div>
      <button
        className={
          isSaving
            ? "save-status-seal is-saving"
            : dirty
              ? "save-status-seal is-unsaved"
              : "save-status-seal is-saved"
        }
        type="button"
        aria-label={
          isSaving ? saveStatus : dirty ? "Save book edits" : saveStatus
        }
        disabled={!dirty || Boolean(busy)}
        onClick={onSave}
      >
        <span className="save-status-mark" aria-hidden="true">
          <Save size={14} />
        </span>
        <span>{saveLabel}</span>
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {saveStatus}
      </span>
    </div>
  );
}

function EmptyState({
  busy,
  onUpload,
}: {
  busy: string | null;
  onUpload: () => void;
}) {
  return (
    <section className="empty-state">
      {busy ? <Loader2 className="spin" size={32} /> : <FileAudio size={36} />}
      <h2>{busy ?? "No book loaded"}</h2>
      <p>Place a manuscript on the desk to begin audiobook alchemy.</p>
      <button
        className="primary-action upload-action"
        type="button"
        disabled={Boolean(busy)}
        onClick={onUpload}
      >
        <FileUp size={18} />
        <span>Upload Book</span>
      </button>
    </section>
  );
}

function ChapterRow({
  chapter,
  active,
  job,
  onOpen,
  onToggle,
}: {
  chapter: Chapter;
  active: boolean;
  job: GenerateJob | null;
  onOpen: () => void;
  onToggle: (selected: boolean) => void;
}) {
  const jobChapter = job?.chapters.find(
    (item) => item.chapter_id === chapter.id,
  );
  const status = jobChapter?.status ?? chapter.status;
  const progress =
    status === "generating" || status === "queued"
      ? Math.round(job?.progress ?? 0)
      : null;

  return (
    <div className={active ? "chapter-item is-active" : "chapter-item"}>
      <button className="chapter-open-button" type="button" onClick={onOpen}>
        <span className="chapter-roman" aria-hidden="true">
          {toRoman(chapter.index + 1)}
        </span>
        <span className="chapter-copy">
          <strong>{chapter.title}</strong>
          <span className="chapter-meta">
            <small>
              {chapter.paragraphs.filter((paragraph) => paragraph.included)
                .length}{" "}
              paragraphs
            </small>
            <span className="chapter-status">
              <StatusBadge status={status} progress={progress} />
            </span>
          </span>
        </span>
      </button>
      <input
        aria-label={`Select ${chapter.title}`}
        type="checkbox"
        checked={chapter.selected}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span>
        {label}
        <strong>
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}
          {suffix}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function StatusBadge({
  status,
  progress,
}: {
  status: string;
  progress?: number | null;
}) {
  const label =
    status === "done"
      ? "Ready"
      : status === "generating"
        ? `Generating ${progress ?? 0}%`
        : titleCase(status);
  return <em className={`status-badge status-${status}`}>{label}</em>;
}

function formatParagraphNumber(index: number): string {
  return String(index + 1).padStart(3, "0");
}

function formatEngineName(engine?: EngineName): string {
  if (!engine) {
    return "Kokoro";
  }
  return engine
    .split("_")
    .map((part) => titleCase(part))
    .join(" ");
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isEngineName(value: string): value is EngineName {
  return (
    value === "kokoro" ||
    value === "chatterbox" ||
    value === "chatterbox_turbo" ||
    value === "mock"
  );
}

function toRoman(value: number): string {
  const numerals: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = value;
  let result = "";
  for (const [arabic, roman] of numerals) {
    while (remaining >= arabic) {
      result += roman;
      remaining -= arabic;
    }
  }
  return result;
}

function Downloads({ book }: { book: Book }) {
  const chapterDownloads = book.chapters.filter(
    (chapter) => chapter.audio_url || chapter.vtt_url || chapter.srt_url,
  );
  if (!book.final_audio_url && chapterDownloads.length === 0) {
    return null;
  }

  return (
    <section className="downloads">
      <div className="panel-heading">
        <h2>Downloads</h2>
        <Download size={18} aria-hidden="true" />
      </div>
      {book.final_audio_url && (
        <div className="download-row">
          <strong>Audiobook</strong>
          <a href={mediaUrl(book.final_audio_url)} download>
            <FileAudio size={17} />
            <span>M4B</span>
          </a>
          {book.final_vtt_url && (
            <a href={mediaUrl(book.final_vtt_url)} download>
              <FileText size={17} />
              <span>VTT</span>
            </a>
          )}
          {book.final_srt_url && (
            <a href={mediaUrl(book.final_srt_url)} download>
              <FileText size={17} />
              <span>SRT</span>
            </a>
          )}
        </div>
      )}
      {chapterDownloads.map((chapter) => (
        <div key={chapter.id} className="download-row">
          <strong>{chapter.title}</strong>
          {chapter.audio_url && (
            <a href={mediaUrl(chapter.audio_url)} download>
              <FileAudio size={17} />
              <span>M4A</span>
            </a>
          )}
          {chapter.vtt_url && (
            <a href={mediaUrl(chapter.vtt_url)} download>
              <FileText size={17} />
              <span>VTT</span>
            </a>
          )}
        </div>
      ))}
    </section>
  );
}

function styleToDraft(style: VoiceStyle): StyleOverride {
  return {
    style_id: style.id,
    engine: style.engine,
    voice: style.voice,
    language: style.language,
    speed: style.speed,
    exaggeration: style.exaggeration,
    cfg_weight: style.cfg_weight,
    temperature: style.temperature,
    top_p: style.top_p,
    paragraph_gap_ms: style.paragraph_gap_ms,
    comma_pause_ms: style.comma_pause_ms,
    prompt_prefix: style.prompt_prefix,
  };
}

function normalizeStyleDraft(
  draft: StyleOverride,
  capabilities: TTSCapabilities | null,
): StyleOverride {
  const engine = draft.engine ?? "kokoro";
  const engineCapabilities = capabilityForEngine(capabilities, engine);
  if (!engineCapabilities) {
    return { ...draft, engine };
  }

  const language =
    engine === "chatterbox_turbo"
      ? "en"
      : engineCapabilities.languages.some(
            (option) => option.value === draft.language,
          )
        ? draft.language
        : engineCapabilities.languages[0]?.value;
  const availableVoices = voiceOptionsForLanguage(engineCapabilities, language);
  const voice = availableVoices.some((option) => option.value === draft.voice)
    ? draft.voice
    : availableVoices[0]?.value;

  return {
    ...draft,
    engine,
    language,
    voice,
  };
}

function settingsForEngine(
  engine: EngineName | undefined,
): EngineSettingsConfig {
  return (
    engineSettingsByModel[engine ?? "kokoro"] ?? engineSettingsByModel.kokoro!
  );
}

function capabilityForEngine(
  capabilities: TTSCapabilities | null,
  engine: EngineName | undefined,
): EngineCapabilities | null {
  if (!capabilities) {
    return null;
  }
  return capabilities[engine ?? "kokoro"] ?? capabilities.kokoro ?? null;
}

function voiceOptionsForLanguage(
  capabilities: EngineCapabilities | null,
  language: string | undefined,
) {
  if (!capabilities) {
    return [];
  }
  if (
    capabilities.engine === "chatterbox" ||
    capabilities.engine === "chatterbox_turbo"
  ) {
    return capabilities.voices;
  }
  const filtered = capabilities.voices.filter(
    (voice) => voice.language === language,
  );
  return filtered.length > 0 ? filtered : capabilities.voices;
}

function chapterEditSnapshot(chapter: Chapter): ChapterEditSnapshot {
  return {
    title: chapter.title,
    selected: chapter.selected,
    paragraphs: chapter.paragraphs.map((paragraph) => ({
      id: paragraph.id,
      text: paragraph.text,
      included: paragraph.included,
    })),
  };
}

function restoreChapterEditSnapshot(
  chapter: Chapter,
  snapshot: ChapterEditSnapshot,
): Chapter {
  const paragraphSnapshots = new Map(
    snapshot.paragraphs.map((paragraph) => [paragraph.id, paragraph]),
  );
  return {
    ...chapter,
    title: snapshot.title,
    selected: snapshot.selected,
    paragraphs: chapter.paragraphs.map((paragraph) => {
      const paragraphSnapshot = paragraphSnapshots.get(paragraph.id);
      return paragraphSnapshot
        ? {
            ...paragraph,
            text: paragraphSnapshot.text,
            included: paragraphSnapshot.included,
          }
        : paragraph;
    }),
  };
}

function chapterSnapshotEquals(
  first: ChapterEditSnapshot,
  second: ChapterEditSnapshot,
): boolean {
  if (
    first.title !== second.title ||
    first.selected !== second.selected ||
    first.paragraphs.length !== second.paragraphs.length
  ) {
    return false;
  }

  return first.paragraphs.every((paragraph, index) => {
    const comparison = second.paragraphs[index];
    return (
      paragraph.id === comparison.id &&
      paragraph.text === comparison.text &&
      paragraph.included === comparison.included
    );
  });
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatImportFailures(failures: BookImportFailure[]): string {
  if (failures.length === 1) {
    const [failure] = failures;
    return `Could not import ${failure.fileName}: ${failure.message}`;
  }
  return `Could not import ${failures.length} files: ${failures
    .map((failure) => `${failure.fileName} (${failure.message})`)
    .join("; ")}`;
}

export default App;
