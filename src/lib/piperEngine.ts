import type {
  ReaderSettings,
  SynthesisRequest,
  SynthesisResult,
  VoiceDefinition,
  VoiceRuntimeConfig
} from "../types";
import { speedToLengthScale } from "./settings";

type TensorType = "int64" | "float32";

export interface PiperSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | number[] }>>;
}

export interface PiperEngineDeps {
  fetchAsset: (url: string, meta: { voice: VoiceDefinition; label: string }) => Promise<ArrayBuffer>;
  createSession: (model: ArrayBuffer) => Promise<PiperSession>;
  createTensor: (type: TensorType, data: BigInt64Array | Float32Array, dims: number[]) => unknown;
  phonemize: (text: string, espeakVoice: string) => Promise<string | string[]>;
  reportStatus?: (label: string, progress?: number) => void;
}

interface LoadedVoice {
  config: VoiceRuntimeConfig;
  session: PiperSession;
}

export class PiperEngine {
  private readonly loadedVoices = new Map<string, Promise<LoadedVoice>>();

  constructor(private readonly deps: PiperEngineDeps) {}

  async warmVoice(voice: VoiceDefinition): Promise<void> {
    await this.loadVoice(voice);
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const loaded = await this.loadVoice(request.voice);
    const phonemes = await this.getPhonemes(request.text, loaded.config.espeak.voice);
    const phonemeIds = phonemesToPiperIds(phonemes, loaded.config.phoneme_id_map);
    if (phonemeIds.length < 3) {
      throw new Error("The selected text could not be phonemized.");
    }

    const feeds = createFeeds(this.deps, phonemeIds, loaded.config, request.settings);
    this.deps.reportStatus?.("Generating speech audio", 1);
    const outputs = await loaded.session.run(feeds);
    this.deps.reportStatus?.("Speech audio ready", 1);
    const output = Object.values(outputs)[0];
    if (!output) {
      throw new Error("Piper returned no audio output.");
    }

    const samples = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
    const sampleRate = loaded.config.audio.sample_rate;
    const audio = floatPcmToWav(samples, sampleRate);

    return {
      id: request.id,
      audio,
      sampleRate,
      durationSeconds: samples.length / sampleRate
    };
  }

  private async loadVoice(voice: VoiceDefinition): Promise<LoadedVoice> {
    const cached = this.loadedVoices.get(voice.id);
    if (cached) {
      return cached;
    }

    const promise = Promise.all([
      this.deps.fetchAsset(voice.configUrl, { voice, label: "Voice config" }),
      this.deps.fetchAsset(voice.modelUrl, { voice, label: "Voice model" })
    ]).then(async ([configBuffer, modelBuffer]) => {
      const config = parseVoiceConfig(configBuffer);
      const session = await this.deps.createSession(modelBuffer);
      return { config, session };
    });

    this.loadedVoices.set(voice.id, promise);
    return promise;
  }

  private async getPhonemes(text: string, espeakVoice: string): Promise<string> {
    const result = await this.deps.phonemize(text, espeakVoice);
    return Array.isArray(result) ? result.join(" ") : result;
  }
}

export function phonemesToPiperIds(phonemes: string, phonemeMap: Record<string, number[]>): number[] {
  const ids: number[] = [];
  const padId = phonemeMap._?.[0] ?? 0;
  const bos = phonemeMap["^"] ?? [1];
  const eos = phonemeMap.$ ?? [2];

  ids.push(...bos);
  for (const symbol of Array.from(phonemes)) {
    const mapped = phonemeMap[symbol] ?? (/\s/.test(symbol) ? phonemeMap[" "] : undefined);
    if (!mapped) {
      continue;
    }
    ids.push(...mapped, padId);
  }
  ids.push(...eos);
  return ids;
}

export function createFeeds(
  deps: Pick<PiperEngineDeps, "createTensor">,
  phonemeIds: number[],
  config: VoiceRuntimeConfig,
  settings: ReaderSettings
): Record<string, unknown> {
  const input = BigInt64Array.from(phonemeIds.map((id) => BigInt(id)));
  const inputLengths = BigInt64Array.from([BigInt(phonemeIds.length)]);
  const scales = new Float32Array([
    config.inference.noise_scale,
    speedToLengthScale(settings.speed),
    config.inference.noise_w
  ]);

  const feeds: Record<string, unknown> = {
    input: deps.createTensor("int64", input, [1, phonemeIds.length]),
    input_lengths: deps.createTensor("int64", inputLengths, [1]),
    scales: deps.createTensor("float32", scales, [3])
  };

  if (config.num_speakers > 1) {
    feeds.sid = deps.createTensor("int64", BigInt64Array.from([0n]), [1]);
  }

  return feeds;
}

export function floatPcmToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const wavHeaderBytes = 44;
  const buffer = new ArrayBuffer(wavHeaderBytes + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = wavHeaderBytes;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function parseVoiceConfig(buffer: ArrayBuffer): VoiceRuntimeConfig {
  const text = new TextDecoder().decode(buffer);
  return JSON.parse(text) as VoiceRuntimeConfig;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
