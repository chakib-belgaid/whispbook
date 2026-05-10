import type { Book, GenerateJob, HealthResponse, PreviewResponse, StyleOverride, TTSCapabilities, VoiceStyle } from "../types";

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health");
}

export async function getStyles(): Promise<VoiceStyle[]> {
  return request<VoiceStyle[]>("/api/styles");
}

export async function getTtsCapabilities(): Promise<TTSCapabilities> {
  return request<TTSCapabilities>("/api/tts/capabilities");
}

export async function getBooks(): Promise<Book[]> {
  return request<Book[]>("/api/books");
}

export async function getBook(bookId: string): Promise<Book> {
  return request<Book>(`/api/books/${bookId}`);
}

export async function importBook(file: File, title: string): Promise<Book> {
  const form = new FormData();
  form.set("file", file);
  form.set("title", title);
  return request<Book>("/api/books/import", {
    method: "POST",
    body: form
  });
}

export async function saveBook(book: Book): Promise<Book> {
  return request<Book>(`/api/books/${book.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: book.title,
      chapters: book.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        selected: chapter.selected,
        paragraphs: chapter.paragraphs.map((paragraph) => ({
          id: paragraph.id,
          text: paragraph.text,
          included: paragraph.included
        }))
      }))
    })
  });
}

export async function createPreview(bookId: string, text: string, style: StyleOverride, subtitleText: string): Promise<PreviewResponse> {
  return request<PreviewResponse>(`/api/books/${bookId}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, style, subtitle_text: subtitleText })
  });
}

export async function startGeneration(bookId: string, chapterIds: string[], style: StyleOverride): Promise<GenerateJob> {
  return request<GenerateJob>(`/api/books/${bookId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chapter_ids: chapterIds,
      style,
      subtitle_source: "edited"
    })
  });
}

export async function getJob(jobId: string): Promise<GenerateJob> {
  return request<GenerateJob>(`/api/jobs/${jobId}`);
}

export async function createCustomStyle(input: {
  name: string;
  engine: string;
  paramsJson: string;
  referenceAudio: File | null;
  referenceStartSeconds: number;
}): Promise<VoiceStyle> {
  const form = new FormData();
  form.set("name", input.name);
  form.set("engine", input.engine);
  form.set("params_json", input.paramsJson);
  form.set("reference_start_seconds", String(input.referenceStartSeconds));
  if (input.referenceAudio) {
    form.set("reference_audio", input.referenceAudio);
  }
  return request<VoiceStyle>("/api/styles/custom", {
    method: "POST",
    body: form
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.text();
    let detail = response.statusText;
    if (body) {
      try {
        const payload = JSON.parse(body) as { detail?: unknown };
        detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
      } catch {
        detail = body;
      }
    }
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function mediaUrl(url: string | null): string {
  return url ?? "";
}
