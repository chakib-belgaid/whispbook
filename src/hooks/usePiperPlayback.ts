import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackQueue } from "../lib/playbackQueue";
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

export function usePiperPlayback({ document, settings, onProgress }: UsePiperPlaybackOptions) {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<string, PendingRequest>());
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const runTokenRef = useRef(0);
  const activeSegmentIdRef = useRef<string | null>(document?.cursorSegmentId ?? null);

  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(document?.cursorSegmentId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/piperWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<PiperWorkerResponse>) => {
      const message = event.data;
      if (message.type === "downloadProgress") {
        setDownload({
          progress: Math.max(0, Math.min(1, message.progress)),
          label: message.label
        });
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

      if (message.type === "error") {
        const pending = pendingRef.current.get(message.id);
        if (pending) {
          pendingRef.current.delete(message.id);
          pending.reject(new Error(message.message));
        } else {
          setError(message.message);
          setStatus("error");
        }
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingRef.current.forEach((pending) => pending.reject(new Error("Playback worker stopped.")));
      pendingRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!gainRef.current) {
      return;
    }
    gainRef.current.gain.value = settings.volume;
  }, [settings.volume]);

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

  const synthesize = useCallback(
    (segment: TextSegment): Promise<SynthesisResult> => {
      const worker = workerRef.current;
      if (!worker) {
        return Promise.reject(new Error("Playback worker is not ready."));
      }

      const voice = voiceForQuality(settings.quality);
      const id = `${segment.id}-${crypto.randomUUID()}`;
      const message: PiperWorkerRequest = {
        type: "synthesize",
        payload: {
          id,
          text: segment.text,
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
      setDownload(null);
      setStatus("loading");

      const queue = new PlaybackQueue(document.segments, synthesize);
      queue.preloadWindow(startIndex);

      try {
        for (let index = startIndex; index < document.segments.length; index += 1) {
          if (runTokenRef.current !== token) {
            return;
          }

          const segment = document.segments[index];
          activeSegmentIdRef.current = segment.id;
          setActiveSegmentId(segment.id);
          await onProgress(document.id, segment.id);
          const result = await queue.take(index);

          if (runTokenRef.current !== token) {
            return;
          }

          setStatus("playing");
          await playAudio(result.audio, settings.volume);

          if (runTokenRef.current !== token) {
            return;
          }

          const nextCursor = document.segments[index + 1]?.id ?? segment.id;
          activeSegmentIdRef.current = nextCursor;
          await onProgress(document.id, nextCursor);
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
    [document, onProgress, settings.volume, synthesize]
  );

  const toggle = useCallback(async () => {
    if (status === "playing" || status === "loading") {
      await pause();
      return;
    }
    await playFrom(activeSegmentIdRef.current);
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

  function stopAudio(): void {
    try {
      sourceRef.current?.stop();
    } catch {
      // Already stopped sources can throw in some mobile browsers.
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
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
}
