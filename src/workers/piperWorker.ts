import * as ort from "onnxruntime-web";
import { list_voices, phonemize } from "phonemizer";
import { pickPhonemizerLanguage } from "../lib/phonemizerLanguage";
import { PiperEngine, type PiperSession } from "../lib/piperEngine";
import type { PiperWorkerRequest, PiperWorkerResponse, VoiceDefinition } from "../types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const voiceCacheName = "whispbook-voices-v1";
const sessionCreateTimeoutMs = 90000;
const phonemizeTimeoutMs = 30000;

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const engine = new PiperEngine({
  fetchAsset,
  createSession: async (model) => {
    postStatus("Loading voice model on device", 1);
    return (await withTimeout(
      ort.InferenceSession.create(model, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      }),
      sessionCreateTimeoutMs,
      "Voice model loaded, but ONNX setup is taking too long. Try low quality or reload the app."
    )) as unknown as PiperSession;
  },
  createTensor: (type, data, dims) => new ort.Tensor(type, data, dims),
  phonemize: async (text, espeakVoice) => {
    postStatus("Preparing pronunciation", 1);
    const result = await withTimeout(
      phonemize(text, await resolvePhonemizerLanguage(espeakVoice)),
      phonemizeTimeoutMs,
      "Pronunciation timed out. Select a later paragraph and try again."
    );
    return result as string | string[];
  }
});

let synthesisChain = Promise.resolve();
let englishIdentifiersPromise: Promise<Set<string>> | null = null;

ctx.addEventListener("message", (event: MessageEvent<PiperWorkerRequest>) => {
  const message = event.data;
  if (message.type === "warmVoice") {
    void engine
      .warmVoice(message.voice)
      .then(() => post({ type: "ready", id: message.id, voiceId: message.voice.id }))
      .catch((error: unknown) => post({ type: "error", id: message.id, message: errorMessage(error) }));
    return;
  }

  synthesisChain = synthesisChain
    .then(() => engine.synthesize(message.payload))
    .then((result) => {
      post({ type: "synthesized", payload: result }, [result.audio]);
    })
    .catch((error: unknown) => post({ type: "error", id: message.payload.id, message: errorMessage(error) }));
});

async function fetchAsset(url: string, meta: { voice: VoiceDefinition; label: string }): Promise<ArrayBuffer> {
  postStatus(`Checking ${meta.label.toLowerCase()} cache`, 0);
  const cache = await getVoiceCache();
  const request = new Request(url, { mode: "cors" });
  const cached = await cache?.match(request);
  if (cached) {
    post({
      type: "downloadProgress",
      id: meta.voice.id,
      voiceId: meta.voice.id,
      progress: 1,
      label: `${meta.label} cached`
    });
    return cached.arrayBuffer();
  }

  post({
    type: "downloadProgress",
    id: meta.voice.id,
    voiceId: meta.voice.id,
    progress: 0.01,
    label: `Connecting ${meta.label.toLowerCase()}`
  });
  const response = await fetchWithTimeout(request, 45000);
  if (!response.ok) {
    throw new Error(`Could not download ${meta.label.toLowerCase()}: ${response.status}`);
  }

  if (!response.body) {
    void cache?.put(request, response.clone()).catch(() => undefined);
    return response.arrayBuffer();
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.byteLength;
    post({
      type: "downloadProgress",
      id: meta.voice.id,
      voiceId: meta.voice.id,
      progress: total ? received / total : 0,
      label: meta.label
    });
  }

  const buffer = concatChunks(chunks, received);
  void cache?.put(request, cacheableResponse(buffer, response)).catch(() => undefined);
  return buffer;
}

function concatChunks(chunks: Uint8Array[], total: number): ArrayBuffer {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

function post(message: PiperWorkerResponse, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer ?? []);
}

function postStatus(label: string, progress?: number): void {
  post({ type: "status", label, progress });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getVoiceCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") {
    return null;
  }

  try {
    return await caches.open(voiceCacheName);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(request: Request, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(request, { signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Voice download did not start. Check the connection or try low quality.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cacheableResponse(buffer: ArrayBuffer, response: Response): Response {
  return new Response(buffer.slice(0), {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream"
    }
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

async function resolvePhonemizerLanguage(espeakVoice: unknown): Promise<string> {
  return pickPhonemizerLanguage(espeakVoice, await getEnglishIdentifiers());
}

async function getEnglishIdentifiers(): Promise<Set<string>> {
  englishIdentifiersPromise ??= list_voices("en").then((voices) => {
    const identifiers = new Set<string>();
    for (const voice of voices) {
      identifiers.add(voice.identifier);
      for (const language of voice.languages) {
        identifiers.add(language.name);
      }
    }
    return identifiers;
  });
  return englishIdentifiersPromise;
}
