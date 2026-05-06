import * as ort from "onnxruntime-web";
import { list_voices, phonemize } from "phonemizer";
import { pickPhonemizerLanguage } from "../lib/phonemizerLanguage";
import { PiperEngine, type PiperSession } from "../lib/piperEngine";
import type { PiperWorkerRequest, PiperWorkerResponse, VoiceDefinition } from "../types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const voiceCacheName = "whispbook-voices-v1";

const engine = new PiperEngine({
  fetchAsset,
  createSession: async (model) =>
    (await ort.InferenceSession.create(model, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    })) as unknown as PiperSession,
  createTensor: (type, data, dims) => new ort.Tensor(type, data, dims),
  phonemize: async (text, espeakVoice) => {
    const result = await phonemize(text, await resolvePhonemizerLanguage(espeakVoice));
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
  const cache = await caches.open(voiceCacheName);
  const request = new Request(url, { mode: "cors" });
  const cached = await cache.match(request);
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

  const response = await fetch(request);
  if (!response.ok) {
    throw new Error(`Could not download ${meta.label.toLowerCase()}: ${response.status}`);
  }

  if (!response.body) {
    await cache.put(request, response.clone());
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
  await cache.put(request, new Response(buffer.slice(0), response));
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
