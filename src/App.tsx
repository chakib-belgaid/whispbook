import {
  BookOpen,
  Check,
  ChevronRight,
  Download,
  FileAudio,
  FileText,
  FileUp,
  Loader2,
  Play,
  Save,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Upload
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
  startGeneration
} from "./lib/api";
import {
  buildGenerationScript,
  defaultBackendUrlFromLocation,
  downloadTextFile,
  generationScriptFilename
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
  VoiceStyle
} from "./types";

const defaultStyleDraft: StyleOverride = {
  style_id: "neutral",
  engine: "kokoro",
  voice: "af_heart",
  language: "a",
  speed: 1,
  exaggeration: 0.5,
  cfg_weight: 0.5,
  temperature: 0.8,
  top_p: 1,
  paragraph_gap_ms: 450,
  comma_pause_ms: 160,
  prompt_prefix: ""
};

type ThemeName = "default" | "fantasy";
type NumericStyleKey = Extract<
  keyof StyleOverride,
  "speed" | "exaggeration" | "cfg_weight" | "temperature" | "top_p" | "paragraph_gap_ms" | "comma_pause_ms"
>;

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

const engineSettingsByModel: Partial<Record<EngineName, EngineSettingsConfig>> = {
  kokoro: {
    language: true,
    promptPrefix: false,
    ranges: [
      { key: "speed", label: "Speed", min: 0.7, max: 1.4, step: 0.01, defaultValue: 1, suffix: "x" },
      { key: "paragraph_gap_ms", label: "Paragraph Pause", min: 0, max: 1500, step: 25, defaultValue: 450, suffix: "ms" },
      { key: "comma_pause_ms", label: "Comma Pause", min: 0, max: 600, step: 20, defaultValue: 160, suffix: "ms" }
    ]
  },
  chatterbox: {
    language: true,
    promptPrefix: true,
    ranges: [
      { key: "exaggeration", label: "Expression", min: 0, max: 1.2, step: 0.01, defaultValue: 0.5 },
      { key: "cfg_weight", label: "CFG", min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
      { key: "temperature", label: "Temperature", min: 0.2, max: 1.2, step: 0.01, defaultValue: 0.8 },
      { key: "top_p", label: "Top P", min: 0.1, max: 1, step: 0.01, defaultValue: 1 },
      { key: "paragraph_gap_ms", label: "Paragraph Pause", min: 0, max: 1500, step: 25, defaultValue: 450, suffix: "ms" },
      { key: "comma_pause_ms", label: "Comma Pause", min: 0, max: 600, step: 20, defaultValue: 160, suffix: "ms" }
    ]
  },
  chatterbox_turbo: {
    language: false,
    promptPrefix: true,
    ranges: [
      { key: "temperature", label: "Temperature", min: 0.2, max: 1.2, step: 0.01, defaultValue: 0.8 },
      { key: "top_p", label: "Top P", min: 0.1, max: 1, step: 0.01, defaultValue: 1 },
      { key: "paragraph_gap_ms", label: "Paragraph Pause", min: 0, max: 1500, step: 25, defaultValue: 450, suffix: "ms" },
      { key: "comma_pause_ms", label: "Comma Pause", min: 0, max: 600, step: 20, defaultValue: 160, suffix: "ms" }
    ]
  },
  mock: {
    language: false,
    promptPrefix: false,
    ranges: [
      { key: "paragraph_gap_ms", label: "Paragraph Pause", min: 0, max: 1500, step: 25, defaultValue: 450, suffix: "ms" },
      { key: "comma_pause_ms", label: "Comma Pause", min: 0, max: 600, step: 20, defaultValue: 160, suffix: "ms" }
    ]
  }
};

const themeStorageKey = "whispbook.theme";

function readInitialTheme(): ThemeName {
  if (typeof window === "undefined") {
    return "default";
  }

  return window.localStorage.getItem(themeStorageKey) === "fantasy" ? "fantasy" : "default";
}

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const styleReferenceRef = useRef<HTMLInputElement | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [theme, setTheme] = useState<ThemeName>(readInitialTheme);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [styles, setStyles] = useState<VoiceStyle[]>([]);
  const [capabilities, setCapabilities] = useState<TTSCapabilities | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null);
  const [styleDraft, setStyleDraft] = useState<StyleOverride>(defaultStyleDraft);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [job, setJob] = useState<GenerateJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customEngine, setCustomEngine] = useState<EngineName>("chatterbox");
  const [customParams, setCustomParams] = useState('{"speed": 0.95, "exaggeration": 0.65, "cfg_weight": 0.35}');
  const [customReference, setCustomReference] = useState<File | null>(null);

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(themeStorageKey, theme);
    document.documentElement.dataset.whispbookTheme = theme;
  }, [theme]);

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
    return book.chapters.find((chapter) => chapter.id === activeChapterId) ?? book.chapters[0] ?? null;
  }, [activeChapterId, book]);

  const includedChapters = useMemo(() => book?.chapters.filter((chapter) => chapter.selected) ?? [], [book]);
  const allChaptersSelected = Boolean(book && book.chapters.length > 0 && includedChapters.length === book.chapters.length);
  const noChaptersSelected = includedChapters.length === 0;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = Boolean(book && !allChaptersSelected && !noChaptersSelected);
    }
  }, [allChaptersSelected, book, noChaptersSelected]);

  const selectedParagraph = useMemo(() => {
    if (!activeChapter) {
      return null;
    }
    return (
      activeChapter.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ??
      activeChapter.paragraphs.find((paragraph) => paragraph.included) ??
      activeChapter.paragraphs[0] ??
      null
    );
  }, [activeChapter, selectedParagraphId]);

  async function boot(): Promise<void> {
    setBusy("Loading");
    try {
      const [nextHealth, nextStyles, nextCapabilities, nextBooks] = await Promise.all([
        getHealth(),
        getStyles(),
        getTtsCapabilities(),
        getBooks()
      ]);
      setHealth(nextHealth);
      setStyles(nextStyles);
      setCapabilities(nextCapabilities);
      setBooks(nextBooks);
      const firstBook = nextBooks[0] ?? null;
      setBook(firstBook);
      setActiveChapterId(firstBook?.chapters[0]?.id ?? null);
      const neutral = nextStyles.find((style) => style.id === "neutral") ?? nextStyles[0];
      if (neutral) {
        setStyleDraft(normalizeStyleDraft(styleToDraft(neutral), nextCapabilities));
      }
      setError(null);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(fileList: FileList | null): Promise<void> {
    const file = fileList?.[0];
    if (!file) {
      return;
    }
    setBusy("Importing");
    setError(null);
    try {
      const imported = await importBook(file, file.name.replace(/\.pdf$/i, ""));
      setBook(imported);
      setBooks((current) => [imported, ...current.filter((item) => item.id !== imported.id)]);
      setActiveChapterId(imported.chapters[0]?.id ?? null);
      setSelectedParagraphId(imported.chapters[0]?.paragraphs[0]?.id ?? null);
      setDirty(false);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setBusy(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function persistBook(): Promise<Book | null> {
    if (!book) {
      return null;
    }
    setBusy("Saving");
    try {
      const saved = await saveBook(book);
      setBook(saved);
      setBooks((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
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
      const preview = await createPreview(book.id, selectedParagraph.text, styleDraft, selectedParagraph.text);
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
    const chapterIds = saved.chapters.filter((chapter) => chapter.selected).map((chapter) => chapter.id);
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
        defaultApiUrl: defaultBackendUrlFromLocation(window.location)
      });
      downloadTextFile(generationScriptFilename(book), script, "text/x-python;charset=utf-8");
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
        setBooks((current) => [refreshed, ...current.filter((item) => item.id !== refreshed.id)]);
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
        referenceAudio: customReference
      });
      setStyles((current) => [created, ...current.filter((style) => style.id !== created.id)]);
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

  function updateBookTitle(title: string): void {
    updateBook((current) => ({ ...current, title }));
  }

  function updateChapter(chapterId: string, updater: (chapter: Chapter) => Chapter): void {
    updateBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => (chapter.id === chapterId ? updater(chapter) : chapter))
    }));
  }

  function setAllChaptersSelected(selected: boolean): void {
    updateBook((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) => ({ ...chapter, selected }))
    }));
  }

  function updateParagraph(chapterId: string, paragraphId: string, updater: (paragraph: Paragraph) => Paragraph): void {
    updateChapter(chapterId, (chapter) => ({
      ...chapter,
      paragraphs: chapter.paragraphs.map((paragraph) => (paragraph.id === paragraphId ? updater(paragraph) : paragraph))
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

  const activeCapabilities = capabilityForEngine(capabilities, styleDraft.engine);
  const languageOptions = activeCapabilities?.languages ?? [];
  const voiceOptions = voiceOptionsForLanguage(activeCapabilities, styleDraft.language);
  const activeEngineSettings = settingsForEngine(styleDraft.engine);

  return (
    <main className={`app-shell theme-${theme}`}>
      <header className="top-bar">
        <div className="brand-lockup">
          <BookOpen size={24} aria-hidden="true" />
          <div>
            <h1>Whispbook</h1>
            <p>{book ? book.title : "Self-hosted audiobook studio"}</p>
          </div>
        </div>
        <div className="status-lockup">
          <span className={health?.ffmpeg ? "status-pill is-ready" : "status-pill"}>ffmpeg</span>
          <span className={health?.engines.kokoro || health?.engines.chatterbox ? "status-pill is-ready" : "status-pill"}>tts</span>
          <button
            className="theme-toggle"
            type="button"
            aria-pressed={theme === "fantasy"}
            onClick={() => setTheme((current) => (current === "fantasy" ? "default" : "fantasy"))}
          >
            <span>{theme === "fantasy" ? "Fantasy" : "Default"}</span>
          </button>
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}

      <section className="command-bar" aria-label="Studio controls">
        <div className="command-cluster">
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => void handleImport(event.currentTarget.files)}
          />
          <button className="primary-action" type="button" disabled={Boolean(busy)} onClick={() => fileInputRef.current?.click()}>
            <FileUp size={18} />
            <span>{busy === "Importing" ? "Importing" : "Upload PDF"}</span>
          </button>
          <button className="secondary-action" type="button" disabled={!dirty || Boolean(busy)} onClick={() => void persistBook()}>
            <Save size={18} />
            <span>{dirty ? "Save edits" : "Saved"}</span>
          </button>
          {books.length > 1 && (
            <select
              className="book-select"
              value={book?.id ?? ""}
              onChange={(event) => {
                const next = books.find((item) => item.id === event.currentTarget.value) ?? null;
                setBook(next);
                setActiveChapterId(next?.chapters[0]?.id ?? null);
                setDirty(false);
              }}
            >
              {books.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="command-meta" aria-label="Book summary">
          <span>{book ? `${book.chapters.length} chapters` : "No book"}</span>
          <span>{includedChapters.length} queued</span>
          <span>{dirty ? "Unsaved" : "Synced"}</span>
        </div>
      </section>

      {!book && <EmptyState busy={busy} />}

      {book && (
        <section className="workspace">
          <aside className="chapter-panel" aria-label="Chapters">
            <label className="field">
              <span>Book</span>
              <input value={book.title} onChange={(event) => updateBookTitle(event.currentTarget.value)} />
            </label>
            <div className="panel-heading">
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
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setAllChaptersSelected(checked);
                  }}
                />
                <span>Select all</span>
              </label>
            </div>
            <div className="chapter-list">
              {book.chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  className={chapter.id === activeChapter?.id ? "chapter-item is-active" : "chapter-item"}
                  type="button"
                  onClick={() => {
                    setActiveChapterId(chapter.id);
                    setSelectedParagraphId(chapter.paragraphs.find((paragraph) => paragraph.included)?.id ?? null);
                  }}
                >
                  <input
                    aria-label={`Select ${chapter.title}`}
                    type="checkbox"
                    checked={chapter.selected}
                    onChange={(event) => {
                      event.stopPropagation();
                      const checked = event.currentTarget.checked;
                      updateChapter(chapter.id, (current) => ({ ...current, selected: checked }));
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <span>
                    <strong>{chapter.title}</strong>
                    <small>{chapter.paragraphs.filter((paragraph) => paragraph.included).length} paragraphs</small>
                  </span>
                  <StatusBadge status={chapter.status} />
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              ))}
            </div>
          </aside>

          <section className="editor-panel" aria-label="Chapter editor">
            {activeChapter && (
              <>
                <div className="panel-heading">
                  <label className="field compact">
                    <span>Chapter</span>
                    <input
                      value={activeChapter.title}
                      onChange={(event) => {
                        const title = event.currentTarget.value;
                        updateChapter(activeChapter.id, (chapter) => ({ ...chapter, title }));
                      }}
                    />
                  </label>
                  <span>{activeChapter.status}</span>
                </div>

                <div className="paragraph-list">
                  {activeChapter.paragraphs.map((paragraph) => (
                    <article
                      key={paragraph.id}
                      className={paragraph.id === selectedParagraph?.id ? "paragraph-item is-selected" : "paragraph-item"}
                    >
                      <div className="paragraph-tools">
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={paragraph.included}
                            onChange={(event) => {
                              const included = event.currentTarget.checked;
                              updateParagraph(activeChapter.id, paragraph.id, (current) => ({
                                ...current,
                                included
                              }));
                            }}
                          />
                          <span>{paragraph.index + 1}</span>
                        </label>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label="Use for preview"
                          onClick={() => setSelectedParagraphId(paragraph.id)}
                        >
                          <Play size={17} />
                        </button>
                        <button
                          className="icon-button danger"
                          type="button"
                          aria-label="Remove paragraph"
                          onClick={() =>
                            updateParagraph(activeChapter.id, paragraph.id, (current) => ({ ...current, included: false }))
                          }
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                      <textarea
                        value={paragraph.text}
                        disabled={!paragraph.included}
                        rows={Math.max(3, Math.min(8, Math.ceil(paragraph.text.length / 90)))}
                        onFocus={() => setSelectedParagraphId(paragraph.id)}
                        onChange={(event) => {
                          const text = event.currentTarget.value;
                          updateParagraph(activeChapter.id, paragraph.id, (current) => ({
                            ...current,
                            text
                          }));
                        }}
                      />
                      {paragraph.text !== paragraph.original_text && (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() =>
                            updateParagraph(activeChapter.id, paragraph.id, (current) => ({
                              ...current,
                              text: current.original_text,
                              included: true
                            }))
                          }
                        >
                          Restore original
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>

          <aside className="render-panel" aria-label="Audio generation">
            <div className="panel-heading">
              <h2>Style</h2>
              <SlidersHorizontal size={19} aria-hidden="true" />
            </div>

            <div className="style-grid">
              {styles.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  className={styleDraft.style_id === style.id ? "style-chip is-selected" : "style-chip"}
                  onClick={() => {
                    setStyleDraft(normalizeStyleDraft(styleToDraft(style), capabilities));
                    setPreviewUrl(null);
                  }}
                >
                  <span>{style.name}</span>
                  <small>{style.engine}</small>
                </button>
              ))}
            </div>

            <div className="control-grid">
              <label className="field">
                <span>Engine</span>
                <select
                  value={styleDraft.engine}
                  onChange={(event) => {
                    const engine = event.currentTarget.value as EngineName;
                    setStyleDraft((current) =>
                      normalizeStyleDraft({ ...current, engine }, capabilities)
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
                  onChange={(event) => {
                    const voice = event.currentTarget.value;
                    setStyleDraft((current) => ({ ...current, voice }));
                  }}
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
                    value={styleDraft.language ?? languageOptions[0]?.value ?? ""}
                    disabled={languageOptions.length === 0}
                    onChange={(event) => {
                      const language = event.currentTarget.value;
                      setStyleDraft((current) =>
                        normalizeStyleDraft({ ...current, language }, capabilities)
                      );
                    }}
                  >
                    {languageOptions.map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label} ({language.value})
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
                onChange={(value) => setStyleDraft((current) => ({ ...current, [control.key]: value }))}
              />
            ))}

            {activeEngineSettings.promptPrefix && (
              <label className="field tts-prompt-field">
                <span>Prompt Prefix</span>
                <textarea
                  rows={3}
                  value={styleDraft.prompt_prefix ?? ""}
                  onChange={(event) => setStyleDraft((current) => ({ ...current, prompt_prefix: event.currentTarget.value }))}
                />
              </label>
            )}

            <div className="action-row">
              <button className="secondary-action" type="button" disabled={!selectedParagraph || Boolean(busy)} onClick={() => void handlePreview()}>
                <Play size={18} />
                <span>{busy === "Previewing" ? "Previewing" : "Preview"}</span>
              </button>
              <button className="secondary-action" type="button" disabled={!book || noChaptersSelected} onClick={handleExportScript}>
                <Terminal size={18} />
                <span>Export script</span>
              </button>
              <button className="primary-action" type="button" disabled={!book || Boolean(busy)} onClick={() => void handleGenerate()}>
                <Sparkles size={18} />
                <span>{busy === "Starting" ? "Starting" : "Generate"}</span>
              </button>
            </div>

            {previewUrl && (
              <div className="audio-result">
                <audio controls src={mediaUrl(previewUrl)} />
              </div>
            )}

            <section className="custom-style">
              <div className="panel-heading">
                <h2>Import Style</h2>
                <Upload size={18} aria-hidden="true" />
              </div>
              <label className="field">
                <span>Name</span>
                <input value={customName} onChange={(event) => setCustomName(event.currentTarget.value)} />
              </label>
              <div className="control-grid">
                <label className="field">
                  <span>Engine</span>
                  <select value={customEngine} onChange={(event) => setCustomEngine(event.currentTarget.value as EngineName)}>
                    <option value="chatterbox">Chatterbox</option>
                    <option value="chatterbox_turbo">Chatterbox Turbo</option>
                    <option value="kokoro">Kokoro</option>
                  </select>
                </label>
                <label className="field">
                  <span>Reference</span>
                  <input
                    ref={styleReferenceRef}
                    type="file"
                    accept="audio/*"
                    onChange={(event) => setCustomReference(event.currentTarget.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <label className="field">
                <span>Params JSON</span>
                <textarea rows={4} value={customParams} onChange={(event) => setCustomParams(event.currentTarget.value)} />
              </label>
              <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={() => void handleCustomStyle()}>
                <Check size={18} />
                <span>Save Style</span>
              </button>
            </section>

            {job && (
              <section className="job-panel" aria-live="polite">
                <div className="panel-heading">
                  <h2>Generation</h2>
                  <span>{Math.round(job.progress)}%</span>
                </div>
                <div className="progress-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(1, job.progress)}%` }} />
                </div>
                <p className={job.status === "error" ? "job-message is-error" : "job-message"}>{job.error ?? job.message}</p>
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
        </section>
      )}
    </main>
  );
}

function EmptyState({ busy }: { busy: string | null }) {
  return (
    <section className="empty-state">
      {busy ? <Loader2 className="spin" size={32} /> : <FileAudio size={36} />}
      <h2>{busy ?? "No book loaded"}</h2>
    </section>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange
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
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <em className={`status-badge status-${status}`}>{status}</em>;
}

function Downloads({ book }: { book: Book }) {
  const chapterDownloads = book.chapters.filter((chapter) => chapter.audio_url || chapter.vtt_url || chapter.srt_url);
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
    prompt_prefix: style.prompt_prefix
  };
}

function normalizeStyleDraft(draft: StyleOverride, capabilities: TTSCapabilities | null): StyleOverride {
  const engine = draft.engine ?? "kokoro";
  const engineCapabilities = capabilityForEngine(capabilities, engine);
  if (!engineCapabilities) {
    return { ...draft, engine };
  }

  const language = engine === "chatterbox_turbo"
    ? "en"
    : engineCapabilities.languages.some((option) => option.value === draft.language)
    ? draft.language
    : engineCapabilities.languages[0]?.value;
  const availableVoices = voiceOptionsForLanguage(engineCapabilities, language);
  const voice = availableVoices.some((option) => option.value === draft.voice) ? draft.voice : availableVoices[0]?.value;

  return {
    ...draft,
    engine,
    language,
    voice
  };
}

function settingsForEngine(engine: EngineName | undefined): EngineSettingsConfig {
  return engineSettingsByModel[engine ?? "kokoro"] ?? engineSettingsByModel.kokoro!;
}

function capabilityForEngine(capabilities: TTSCapabilities | null, engine: EngineName | undefined): EngineCapabilities | null {
  if (!capabilities) {
    return null;
  }
  return capabilities[engine ?? "kokoro"] ?? capabilities.kokoro ?? null;
}

function voiceOptionsForLanguage(capabilities: EngineCapabilities | null, language: string | undefined) {
  if (!capabilities) {
    return [];
  }
  if (capabilities.engine === "chatterbox" || capabilities.engine === "chatterbox_turbo") {
    return capabilities.voices;
  }
  const filtered = capabilities.voices.filter((voice) => voice.language === language);
  return filtered.length > 0 ? filtered : capabilities.voices;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
