import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "../lib/settings";
import { canUseSpeechSynthesis, selectSpeechVoice } from "../lib/speechVoices";
import type { PlaybackStatus, ReaderSettings, StoredDocument, TextSegment } from "../types";

interface UseSpeechPlaybackOptions {
  document: StoredDocument | null;
  settings: ReaderSettings;
  onProgress: (documentId: string, cursorSegmentId: string | null) => Promise<void>;
}

type WakeLockHandle = WakeLockSentinel;
const speechWindowParagraphLimit = 10;
const streamingBufferPollMs = 120;

interface SpeechWindow {
  segments: TextSegment[];
  nextIndex: number;
}

export interface SpeechPlaybackState {
  status: PlaybackStatus;
  activeSegmentId: string | null;
  activeSegmentIds: string[];
  error: string | null;
  message: string | null;
  playFrom: (segmentId?: string | null) => Promise<void>;
  pause: () => Promise<void>;
  toggle: (segmentId?: string | null) => Promise<void>;
}

export function useSpeechPlayback({ document, settings, onProgress }: UseSpeechPlaybackOptions): SpeechPlaybackState {
  const runTokenRef = useRef(0);
  const documentRef = useRef<StoredDocument | null>(document);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const activeSegmentIdRef = useRef<string | null>(document?.cursorSegmentId ?? null);
  const settingsRef = useRef(settings);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const gapTimeoutRef = useRef<number | null>(null);
  const gapResolveRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(document?.cursorSegmentId ?? null);
  const [activeSegmentIds, setActiveSegmentIds] = useState<string[]>(
    document?.cursorSegmentId ? [document.cursorSegmentId] : []
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  documentRef.current = document;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    activeSegmentIdRef.current = document?.cursorSegmentId ?? null;
    setActiveSegmentId(document?.cursorSegmentId ?? null);
    setActiveSegmentIds(document?.cursorSegmentId ? [document.cursorSegmentId] : []);
    setStatus((current) => {
      if (!document) {
        return "idle";
      }
      return current === "playing" || current === "loading" ? "paused" : current;
    });
    stopSpeech();
    void releaseWakeLock();
    runTokenRef.current += 1;
  }, [document?.id]);

  const pause = useCallback(async () => {
    runTokenRef.current += 1;
    stopSpeech();
    setStatus("paused");
    setActiveSegmentIds(activeSegmentIdRef.current ? [activeSegmentIdRef.current] : []);
    setMessage("Paused");
    await releaseWakeLock();
    const currentDocument = documentRef.current;
    if (currentDocument && activeSegmentIdRef.current) {
      await onProgress(currentDocument.id, activeSegmentIdRef.current);
    }
  }, [onProgress]);

  useEffect(() => {
    const persistAndPause = () => {
      if (document && activeSegmentIdRef.current) {
        void onProgress(document.id, activeSegmentIdRef.current);
      }
      void pause();
    };

    window.addEventListener("pagehide", persistAndPause);
    const handleVisibility = () => {
      if (window.document.visibilityState === "hidden") {
        persistAndPause();
      }
    };
    window.document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("pagehide", persistAndPause);
      window.document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [document, onProgress, pause]);

  useEffect(() => {
    return () => {
      runTokenRef.current += 1;
      stopSpeech();
      void releaseWakeLock();
    };
  }, []);

  const playFrom = useCallback(
    async (segmentId?: string | null) => {
      const playbackDocument = documentRef.current;
      if (!playbackDocument || playbackDocument.segments.length === 0) {
        return;
      }

      if (!canUseSpeechSynthesis()) {
        setError("Android speech is not available in this browser.");
        setMessage("Speech unavailable");
        setStatus("error");
        return;
      }

      const documentId = playbackDocument.id;
      const startIndex = startIndexFor(
        playbackDocument.segments,
        segmentId ?? activeSegmentIdRef.current ?? playbackDocument.cursorSegmentId
      );
      const token = runTokenRef.current + 1;
      runTokenRef.current = token;
      stopSpeech();
      setError(null);
      setStatus("loading");
      setMessage("Preparing Android speech");
      await acquireWakeLock();

      try {
        let index = startIndex;
        while (true) {
          if (runTokenRef.current !== token) {
            return;
          }

          const speechWindow = await waitForSpeechWindow(documentId, index, token);
          if (runTokenRef.current !== token) {
            return;
          }
          if (!speechWindow) {
            setStatus("idle");
            setActiveSegmentIds([]);
            setMessage("Finished");
            await releaseWakeLock();
            return;
          }

          const segment = speechWindow.segments[0];
          activeSegmentIdRef.current = segment.id;
          setActiveSegmentId(segment.id);
          setActiveSegmentIds(speechWindow.segments.map((speechSegment) => speechSegment.id));
          setStatus("playing");
          setMessage(speechWindow.segments.length > 1 ? `Reading ${speechWindow.segments.length} paragraphs` : "Reading");
          await speakSegments(speechWindow.segments, token);

          if (runTokenRef.current !== token) {
            return;
          }

          const nextIndex = speechWindow.nextIndex;
          const lastSegment = speechWindow.segments[speechWindow.segments.length - 1];

          if (!settingsRef.current.autoAdvance) {
            const latestDocument = latestDocumentFor(documentId);
            const nextCursor = latestDocument?.segments[nextIndex]?.id ?? lastSegment.id;
            activeSegmentIdRef.current = nextCursor;
            setActiveSegmentId(nextCursor);
            setActiveSegmentIds([nextCursor]);
            await onProgress(documentId, nextCursor);
            setStatus("paused");
            setMessage("Paused");
            await releaseWakeLock();
            return;
          }

          const latestDocument = latestDocumentFor(documentId);
          const nextSegment = latestDocument?.segments[nextIndex];
          const nextCursor = nextSegment?.id ?? lastSegment.id;
          activeSegmentIdRef.current = nextCursor;
          setActiveSegmentId(nextCursor);
          setActiveSegmentIds(nextSegment ? [nextSegment.id] : []);
          await onProgress(documentId, nextCursor);

          if (!nextSegment) {
            if (latestDocument && isStreamingDocument(latestDocument)) {
              index = nextIndex;
              continue;
            }
            setStatus("idle");
            setActiveSegmentIds([]);
            setMessage("Finished");
            await releaseWakeLock();
            return;
          }

          const gap = settingsRef.current.paragraphGapMs;
          if (gap > 0) {
            setStatus("loading");
            setMessage("Waiting for next speech window");
            await waitForGap(gap);
          }

          index = nextIndex;
        }
      } catch (caught) {
        if (runTokenRef.current === token) {
          const nextError = caught instanceof Error ? caught.message : String(caught);
          setError(nextError);
          setMessage("Speech failed");
          setStatus("error");
          setActiveSegmentIds([]);
          await releaseWakeLock();
        }
      }
    },
    [onProgress]
  );

  const toggle = useCallback(
    async (segmentId?: string | null) => {
      if (status === "playing" || status === "loading") {
        await pause();
        return;
      }
      await playFrom(segmentId ?? activeSegmentIdRef.current);
    },
    [pause, playFrom, status]
  );

  return {
    status,
    activeSegmentId,
    activeSegmentIds,
    error,
    message,
    playFrom,
    pause,
    toggle
  };

  function stopSpeech(): void {
    if (gapTimeoutRef.current !== null) {
      window.clearTimeout(gapTimeoutRef.current);
      gapTimeoutRef.current = null;
      gapResolveRef.current?.();
      gapResolveRef.current = null;
    }
    utteranceRef.current = null;
    if (canUseSpeechSynthesis()) {
      window.speechSynthesis.cancel();
    }
  }

  async function speakSegments(segments: TextSegment[], token: number): Promise<void> {
    const voices = await loadSpeechVoices();
    const currentSettings = settingsRef.current;
    const utterance = new SpeechSynthesisUtterance(segments.map((segment) => segment.text).join("\n\n"));
    utterance.lang = currentSettings.language;
    utterance.rate = clamp(currentSettings.speed, 0.5, 2.5);
    utterance.pitch = clamp(currentSettings.pitch, 0, 2);
    utterance.volume = clamp(currentSettings.volume, 0, 1);
    utterance.voice = selectSpeechVoice(voices, currentSettings);

    return new Promise((resolve, reject) => {
      utterance.onend = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
        }
        resolve();
      };
      utterance.onerror = (event) => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
        }
        if (runTokenRef.current !== token || event.error === "canceled" || event.error === "interrupted") {
          resolve();
          return;
        }
        reject(new Error(`Android speech failed: ${event.error || "unknown error"}`));
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.resume();
    });
  }

  function waitForGap(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      gapResolveRef.current = resolve;
      gapTimeoutRef.current = window.setTimeout(() => {
        gapTimeoutRef.current = null;
        gapResolveRef.current = null;
        resolve();
      }, milliseconds);
    });
  }

  async function acquireWakeLock(): Promise<void> {
    const currentSettings = settingsRef.current;
    const wakeLock = "wakeLock" in navigator ? navigator.wakeLock : undefined;
    if (!currentSettings.keepAwake || !wakeLock || wakeLockRef.current) {
      return;
    }

    try {
      wakeLockRef.current = await wakeLock.request("screen");
    } catch {
      // Wake Lock is optional; playback should continue without it.
    }
  }

  async function releaseWakeLock(): Promise<void> {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && !lock.released) {
      await lock.release().catch(() => undefined);
    }
  }

  function latestDocumentFor(documentId: string): StoredDocument | null {
    const currentDocument = documentRef.current;
    return currentDocument?.id === documentId ? currentDocument : null;
  }

  async function waitForSpeechWindow(documentId: string, startIndex: number, token: number): Promise<SpeechWindow | null> {
    while (runTokenRef.current === token) {
      const currentDocument = latestDocumentFor(documentId);
      if (!currentDocument) {
        return null;
      }
      if (!currentDocument.segments[startIndex] && !isStreamingDocument(currentDocument)) {
        return null;
      }

      const speechWindow = buildSpeechWindow(currentDocument, startIndex, settingsRef.current.autoAdvance);
      if (speechWindow) {
        return speechWindow;
      }

      setStatus("loading");
      setMessage("Buffering speech window");
      await delay(streamingBufferPollMs);
    }

    return null;
  }
}

function startIndexFor(segments: TextSegment[], segmentId?: string | null): number {
  const index = segmentId ? segments.findIndex((segment) => segment.id === segmentId) : -1;
  return Math.max(0, index);
}

function buildSpeechWindow(document: StoredDocument, startIndex: number, autoAdvance: boolean): SpeechWindow | null {
  if (!document.segments[startIndex]) {
    return null;
  }

  const windowSize = autoAdvance ? speechWindowParagraphLimit : 1;
  if (isStreamingDocument(document) && autoAdvance && document.segments.length < startIndex + windowSize) {
    return null;
  }

  const nextIndex = Math.min(document.segments.length, startIndex + windowSize);
  return {
    segments: document.segments.slice(startIndex, nextIndex),
    nextIndex
  };
}

function isStreamingDocument(document: StoredDocument): boolean {
  return document.kind === "pdf" && document.extraction?.status === "extracting";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function loadSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    return voices;
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }, 900);

    function handleVoicesChanged(): void {
      window.clearTimeout(timeout);
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }

    window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
  });
}
