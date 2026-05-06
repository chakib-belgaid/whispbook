import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackQueue } from "../lib/playbackQueue";
import { clamp } from "../lib/settings";
import { splitSpeechText } from "../lib/speechChunks";
import type {
  PiperWorkerRequest,
  PiperWorkerResponse,
  PlaybackStatus,
  ReaderSettings,
  StoredDocument,
  SynthesisResult,
  TextSegment
} from "../types";
import { voiceForQuality } from "../voices";

interface DownloadState {
  progress: number;
  label: string;
}

interface UsePiperPlaybackOptions {
  document: StoredDocument | null;
  settings: ReaderSettings;
  onProgress: (documentId: string, cursorSegmentId: string | null) => Promise<void>;
}

interface PendingRequest {
  resolve: (result: SynthesisResult) => void;
  reject: (error: Error) => void;
}

interface PlaybackChunk {
  id: string;
  text: string;
  segmentId: string;
  segmentIndex: number;
  chunkIndex: number;
  chunkCount: number;
}

type ChunkPlayback =
  | { kind: "piper"; chunk: PlaybackChunk; result: SynthesisResult }
  | { kind: "browser"; chunk: PlaybackChunk };

const piperSynthesisTimeoutMs = 18000;
const piperQueueWindow = 2;

export function usePiperPlayback({ document, settings, onProgress }: UsePiperPlaybackOptions) {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<string, PendingRequest>());
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const browserUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const runTokenRef = useRef(0);
  const activeSegmentIdRef = useRef<string | null>(document?.cursorSegmentId ?? null);
  const requestedWarmVoicesRef = useRef(new Set<string>());
  const browserSpeechFallbackRef = useRef(false);

  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(document?.cursorSegmentId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);

  useEffect(() => {
    startWorker();

    return () => {
      shutdownWorker("Playback worker stopped.");
    };
  }, []);

  useEffect(() => {
    if (!gainRef.current) {
      return;
    }
    gainRef.current.gain.value = settings.volume;
  }, [settings.volume]);

  useEffect(() => {
    if (!document || browserSpeechFallbackRef.current) {
      return;
    }

    const worker = startWorker();
    const voice = voiceForQuality(settings.quality);
    if (requestedWarmVoicesRef.current.has(voice.id)) {
      return;
    }

    requestedWarmVoicesRef.current.add(voice.id);
    worker.postMessage({
      type: "warmVoice",
      id: `warm-${voice.id}`,
      voice
    } satisfies PiperWorkerRequest);
  }, [document?.id, settings.quality]);

  useEffect(() => {
    activeSegmentIdRef.current = document?.cursorSegmentId ?? null;
    setActiveSegmentId(document?.cursorSegmentId ?? null);
    setStatus((current) => {
      if (!document) {
        return "idle";
      }
      return current === "playing" || current === "loading" ? "paused" : current;
    });
    stopAudio();
    runTokenRef.current += 1;
  }, [document?.id]);

  useEffect(() => {
    const persistOnHide = () => {
      if (document && activeSegmentIdRef.current) {
        void onProgress(document.id, activeSegmentIdRef.current);
      }
    };
    window.addEventListener("visibilitychange", persistOnHide);
    window.addEventListener("pagehide", persistOnHide);
    return () => {
      window.removeEventListener("visibilitychange", persistOnHide);
      window.removeEventListener("pagehide", persistOnHide);
    };
  }, [document, onProgress]);

  const sendPiperSynthesis = useCallback(
    (chunk: PlaybackChunk): Promise<SynthesisResult> => {
      const worker = startWorker();
      const voice = voiceForQuality(settings.quality);
      const id = `${chunk.id}-${crypto.randomUUID()}`;
      const message: PiperWorkerRequest = {
        type: "synthesize",
        payload: {
          id,
          text: chunk.text,
          voice,
          settings
        }
      };

      return new Promise((resolve, reject) => {
        pendingRef.current.set(id, { resolve, reject });
        worker.postMessage(message);
      });
    },
    [settings]
  );

  const synthesizeChunk = useCallback(
    async (chunk: PlaybackChunk): Promise<ChunkPlayback> => {
      if (browserSpeechFallbackRef.current) {
        return { kind: "browser", chunk };
      }

      setDownload({
        progress: 1,
        label: chunk.chunkCount > 1 ? `Generating audio ${chunk.chunkIndex + 1}/${chunk.chunkCount}` : "Generating audio"
      });

      try {
        const result = await withTimeout(
          sendPiperSynthesis(chunk),
          piperSynthesisTimeoutMs,
          "Piper is too slow on this mobile browser. Switching to Android speech."
        );
        return { kind: "piper", chunk, result };
      } catch (caught) {
        if (!canUseBrowserSpeech()) {
          throw caught;
        }

        activateBrowserSpeechFallback(caught instanceof Error ? caught.message : String(caught));
        return { kind: "browser", chunk };
      }
    },
    [sendPiperSynthesis]
  );

  const pause = useCallback(async () => {
    runTokenRef.current += 1;
    stopAudio();
    setStatus("paused");
    if (document && activeSegmentIdRef.current) {
      await onProgress(document.id, activeSegmentIdRef.current);
    }
  }, [document, onProgress]);

  const playFrom = useCallback(
    async (segmentId?: string | null) => {
      if (!document || document.segments.length === 0) {
        return;
      }

      const startSegmentId = segmentId ?? activeSegmentIdRef.current ?? document.cursorSegmentId ?? document.segments[0].id;
      const startIndex = Math.max(
        0,
        document.segments.findIndex((segment) => segment.id === startSegmentId)
      );
      const token = runTokenRef.current + 1;
      runTokenRef.current = token;
      stopAudio();
      setError(null);
      setDownload((current) => {
        if (current && current.label !== "Voice ready") {
          return current;
        }
        return { progress: 0, label: "Preparing selected paragraph" };
      });
      setStatus("loading");

      const chunks = buildPlaybackChunks(document.segments, startIndex);
      const queue = new PlaybackQueue(chunks, synthesizeChunk, piperQueueWindow);
      queue.preloadWindow(0);

      try {
        let currentSegmentId: string | null = null;
        for (let index = 0; index < chunks.length; index += 1) {
          if (runTokenRef.current !== token) {
            return;
          }

          const chunk = chunks[index];
          if (chunk.segmentId !== currentSegmentId) {
            currentSegmentId = chunk.segmentId;
            activeSegmentIdRef.current = chunk.segmentId;
            setActiveSegmentId(chunk.segmentId);
            await onProgress(document.id, chunk.segmentId);
          }

          const result = await queue.take(index);

          if (runTokenRef.current !== token) {
            return;
          }

          setStatus("playing");
          if (result.kind === "browser") {
            setDownload({
              progress: 1,
              label: "Using Android speech"
            });
            await speakWithBrowser(result.chunk.text, settings);
          } else {
            await playAudio(result.result.audio, settings.volume);
          }

          if (runTokenRef.current !== token) {
            return;
          }

          const nextCursor = chunks[index + 1]?.segmentId ?? chunk.segmentId;
          if (nextCursor !== chunk.segmentId) {
            activeSegmentIdRef.current = nextCursor;
            await onProgress(document.id, nextCursor);
          }
        }

        setStatus("idle");
      } catch (caught) {
        if (runTokenRef.current === token) {
          const message = caught instanceof Error ? caught.message : String(caught);
          setError(message);
          setStatus("error");
        }
      }
    },
    [document, onProgress, settings, synthesizeChunk]
  );

  const toggle = useCallback(async (segmentId?: string | null) => {
    if (status === "playing" || status === "loading") {
      await pause();
      return;
    }
    await playFrom(segmentId ?? activeSegmentIdRef.current);
  }, [pause, playFrom, status]);

  return {
    status,
    activeSegmentId,
    error,
    download,
    playFrom,
    pause,
    toggle
  };

  function startWorker(): Worker {
    if (workerRef.current) {
      return workerRef.current;
    }

    const worker = new Worker(new URL("../workers/piperWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<PiperWorkerResponse>) => {
      handleWorkerMessage(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      failWorker(`Speech worker failed: ${event.message || "unknown worker error"}`);
    };
    worker.onmessageerror = () => {
      failWorker("Speech worker sent an unreadable message.");
    };
    return worker;
  }

  function handleWorkerMessage(message: PiperWorkerResponse): void {
    if (message.type === "status") {
      const next = {
        progress: Math.max(0, Math.min(1, message.progress ?? 0)),
        label: message.label
      };
      setDownload((current) => (shouldPreserveCurrentDownload(current, next.label) ? current : next));
      return;
    }

    if (message.type === "downloadProgress") {
      const next = {
        progress: Math.max(0, Math.min(1, message.progress)),
        label: message.label
      };
      setDownload((current) => (shouldPreserveCurrentDownload(current, next.label) ? current : next));
      return;
    }

    if (message.type === "synthesized") {
      const pending = pendingRef.current.get(message.payload.id);
      if (pending) {
        pendingRef.current.delete(message.payload.id);
        pending.resolve(message.payload);
      }
      return;
    }

    if (message.type === "ready") {
      requestedWarmVoicesRef.current.add(message.voiceId);
      setDownload((current) =>
        shouldPreserveCurrentDownload(current, "Voice ready")
          ? current
          : {
              progress: 1,
              label: "Voice ready"
            }
      );
      return;
    }

    if (message.type === "error") {
      const pending = pendingRef.current.get(message.id);
      if (pending) {
        pendingRef.current.delete(message.id);
        pending.reject(new Error(message.message));
      } else {
        if (message.id.startsWith("warm-")) {
          requestedWarmVoicesRef.current.delete(message.id.slice("warm-".length));
        }
        setError(message.message);
        setStatus("error");
      }
    }
  }

  function failWorker(message: string): void {
    shutdownWorker(message);
    setError(message);
    setStatus("error");
  }

  function shutdownWorker(message: string): void {
    workerRef.current?.terminate();
    workerRef.current = null;
    const error = new Error(message);
    pendingRef.current.forEach((pending) => pending.reject(error));
    pendingRef.current.clear();
    requestedWarmVoicesRef.current.clear();
  }

  function activateBrowserSpeechFallback(reason: string): void {
    browserSpeechFallbackRef.current = true;
    shutdownWorker(reason);
    setError(null);
    setDownload({
      progress: 1,
      label: "Using Android speech"
    });
  }

  function stopAudio(): void {
    try {
      sourceRef.current?.stop();
    } catch {
      // Already stopped sources can throw in some mobile browsers.
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    browserUtteranceRef.current = null;
    if (canUseBrowserSpeech()) {
      window.speechSynthesis.cancel();
    }
  }

  async function playAudio(audio: ArrayBuffer, volume: number): Promise<void> {
    const context = await getAudioContext(volume);
    const decoded = await context.decodeAudioData(audio.slice(0));

    return new Promise((resolve) => {
      const source = context.createBufferSource();
      source.buffer = decoded;
      source.connect(gainRef.current ?? context.destination);
      source.onended = () => {
        if (sourceRef.current === source) {
          sourceRef.current = null;
        }
        resolve();
      };
      sourceRef.current = source;
      source.start();
    });
  }

  async function getAudioContext(volume: number): Promise<AudioContext> {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      gainRef.current = audioContextRef.current.createGain();
      gainRef.current.connect(audioContextRef.current.destination);
    }

    gainRef.current!.gain.value = volume;
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }

  async function speakWithBrowser(text: string, nextSettings: ReaderSettings): Promise<void> {
    if (!canUseBrowserSpeech()) {
      throw new Error("Android speech is not available in this browser.");
    }

    const voices = await loadBrowserVoices();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = clamp(nextSettings.speed, 0.6, 2);
    utterance.volume = clamp(nextSettings.volume, 0, 1);
    utterance.voice = pickBrowserVoice(voices);

    return new Promise((resolve, reject) => {
      utterance.onend = () => {
        if (browserUtteranceRef.current === utterance) {
          browserUtteranceRef.current = null;
        }
        resolve();
      };
      utterance.onerror = (event) => {
        if (browserUtteranceRef.current === utterance) {
          browserUtteranceRef.current = null;
        }
        reject(new Error(`Android speech failed: ${event.error || "unknown error"}`));
      };
      browserUtteranceRef.current = utterance;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.resume();
    });
  }
}

function shouldPreserveCurrentDownload(current: DownloadState | null, nextLabel: string): boolean {
  if (!current) {
    return false;
  }

  if (current.label === "Using Android speech") {
    return true;
  }

  const isActivePlaybackLabel =
    current.label === "Preparing selected paragraph" ||
    current.label.startsWith("Generating audio") ||
    current.label === "Preparing pronunciation" ||
    current.label === "Generating speech audio";
  const isLateWarmupLabel = nextLabel === "Voice ready" || nextLabel === "Voice model ready";
  return isActivePlaybackLabel && isLateWarmupLabel;
}

function buildPlaybackChunks(segments: TextSegment[], startIndex: number): PlaybackChunk[] {
  const chunks: PlaybackChunk[] = [];

  for (let segmentIndex = startIndex; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const pieces = splitSpeechText(segment.text);
    pieces.forEach((text, chunkIndex) => {
      chunks.push({
        id: `${segment.id}-chunk-${chunkIndex}`,
        text,
        segmentId: segment.id,
        segmentIndex,
        chunkIndex,
        chunkCount: pieces.length
      });
    });
  }

  return chunks;
}

function canUseBrowserSpeech(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

function loadBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    return Promise.resolve(voices);
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }, 1000);

    function handleVoicesChanged(): void {
      window.clearTimeout(timeout);
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }

    window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
  });
}

function pickBrowserVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return (
    voices.find((voice) => voice.lang.toLowerCase() === "en-us") ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ??
    null
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timeoutId!);
  }
}
