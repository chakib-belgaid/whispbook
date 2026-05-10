from __future__ import annotations

import math
import os
import re
import sys
import types
import wave
from dataclasses import dataclass
from importlib import import_module
from pathlib import Path
from typing import Dict, List, Optional

from .ffmpeg import concat_audio, make_silence, normalize_wav
from .models import VoiceStyle
from .text_processing import split_long_paragraph


class TTSError(RuntimeError):
    pass


class BaseEngine:
    name = "base"

    def synthesize(self, text: str, style: VoiceStyle, output_path: Path) -> None:
        raise NotImplementedError


@dataclass(frozen=True)
class TTSUnit:
    text: str = ""
    pause_ms: int = 0

    @property
    def is_pause(self) -> bool:
        return self.pause_ms > 0


PAUSING_PUNCTUATION = ",;:"
TRAILING_PAUSE_MARKS = set("\"')]}") | set(
    "\u201d\u2019\u00bb\u203a\u300d\u300f"
)


class KokoroEngine(BaseEngine):
    name = "kokoro"

    def __init__(self) -> None:
        self._pipelines: Dict[str, object] = {}

    def synthesize(self, text: str, style: VoiceStyle, output_path: Path) -> None:
        try:
            import numpy as np
            import soundfile as sf
            from kokoro import KPipeline
        except ImportError as error:
            raise TTSError("Kokoro is not installed. Run `uv sync --project backend` and install espeak-ng.") from error

        lang_code = kokoro_lang_code(style.language)
        if lang_code not in self._pipelines:
            self._pipelines[lang_code] = KPipeline(lang_code=lang_code)

        generator = self._pipelines[lang_code](
            text,
            voice=style.voice or "af_heart",
            speed=style.speed,
            split_pattern=r"\n+",
        )
        chunks = [audio for _, _, audio in generator]
        if not chunks:
            raise TTSError("Kokoro returned no audio.")
        audio = np.concatenate(chunks)
        sf.write(str(output_path), audio, 24000)


class ChatterboxEngine(BaseEngine):
    name = "chatterbox"

    def __init__(self, turbo: bool = False) -> None:
        self.turbo = turbo
        self._model = None
        self._multilingual_model = None

    def synthesize(self, text: str, style: VoiceStyle, output_path: Path) -> None:
        try:
            import torch
            import torchaudio as ta
        except ImportError as error:
            raise TTSError("Chatterbox needs torch and torchaudio. Run `uv sync --project backend`.") from error

        language = (style.language or "en").lower()
        reference_path = style.reference_audio_path
        device = best_torch_device(torch)

        try:
            ensure_perth_watermarker()

            if self.turbo:
                from chatterbox.tts_turbo import ChatterboxTurboTTS

                if self._model is None:
                    self._model = ChatterboxTurboTTS.from_pretrained(device=device)
                wav = self._model.generate(
                    text,
                    audio_prompt_path=reference_path,
                    temperature=style.temperature,
                    top_p=style.top_p,
                )
                ta.save(str(output_path), wav.cpu(), self._model.sr)
                return

            if language not in {"en", "eng", "english"}:
                from chatterbox.mtl_tts import ChatterboxMultilingualTTS

                if self._multilingual_model is None:
                    self._multilingual_model = ChatterboxMultilingualTTS.from_pretrained(device=device)
                wav = self._multilingual_model.generate(
                    text,
                    language_id=language,
                    audio_prompt_path=reference_path,
                    exaggeration=style.exaggeration,
                    cfg_weight=style.cfg_weight,
                    temperature=style.temperature,
                )
                ta.save(str(output_path), wav.cpu(), self._multilingual_model.sr)
                return

            from chatterbox.tts import ChatterboxTTS

            if self._model is None:
                self._model = ChatterboxTTS.from_pretrained(device=device)
            wav = self._model.generate(
                text,
                audio_prompt_path=reference_path,
                exaggeration=style.exaggeration,
                cfg_weight=style.cfg_weight,
                temperature=style.temperature,
                top_p=style.top_p,
            )
            ta.save(str(output_path), wav.cpu(), self._model.sr)
        except AssertionError as error:
            raise TTSError("Chatterbox needs a built-in voice or a custom reference audio clip for this model.") from error
        except ModuleNotFoundError as error:
            if error.name == "pkg_resources":
                raise TTSError(
                    "Chatterbox's PerTh dependency needs pkg_resources. Run `uv sync --project backend` to install setuptools<82."
                ) from error
            raise


class MockEngine(BaseEngine):
    name = "mock"

    def synthesize(self, text: str, style: VoiceStyle, output_path: Path) -> None:
        if os.environ.get("WHISPBOOK_ENABLE_MOCK_TTS") != "1":
            raise TTSError("Mock TTS is disabled. Set WHISPBOOK_ENABLE_MOCK_TTS=1 only for local smoke tests.")
        duration = max(0.8, min(8.0, len(text) / 95.0))
        sample_rate = 24000
        amplitude = 9000
        frequency = 220
        frame_count = int(sample_rate * duration)
        with wave.open(str(output_path), "w") as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(sample_rate)
            frames = bytearray()
            for index in range(frame_count):
                value = int(amplitude * math.sin(2 * math.pi * frequency * index / sample_rate))
                frames.extend(value.to_bytes(2, "little", signed=True))
            file.writeframes(bytes(frames))


class TTSManager:
    def __init__(self) -> None:
        self.engines: Dict[str, BaseEngine] = {}

    def engine_available(self, name: str) -> bool:
        try:
            self.get_engine(name)
            return True
        except Exception:
            return False

    def get_engine(self, name: str) -> BaseEngine:
        if name not in self.engines:
            if name == "kokoro":
                self.engines[name] = KokoroEngine()
            elif name == "chatterbox":
                self.engines[name] = ChatterboxEngine(turbo=False)
            elif name == "chatterbox_turbo":
                self.engines[name] = ChatterboxEngine(turbo=True)
            elif name == "mock":
                self.engines[name] = MockEngine()
            else:
                raise TTSError(f"Unknown TTS engine: {name}")
        return self.engines[name]

    def synthesize(self, text: str, style: VoiceStyle, output_path: Path) -> None:
        units = split_text_for_tts(
            text_for_style(style, text),
            comma_pause_ms=punctuation_pause_ms_for_engine(style),
        )
        if len(units) == 1 and not units[0].is_pause:
            self.get_engine(style.engine).synthesize(units[0].text, style, output_path)
            normalize_in_place(output_path)
            return

        chunk_dir = output_path.with_suffix("")
        chunk_dir.mkdir(parents=True, exist_ok=True)
        normalized_files: List[Path] = []
        silence_files: Dict[int, Path] = {}
        chunk_index = 0
        for unit in units:
            if unit.is_pause:
                silence_path = silence_files.get(unit.pause_ms)
                if silence_path is None:
                    silence_path = chunk_dir / f"pause-{unit.pause_ms:04d}.wav"
                    make_silence(silence_path, unit.pause_ms / 1000.0)
                    silence_files[unit.pause_ms] = silence_path
                normalized_files.append(silence_path)
                continue

            raw_path = chunk_dir / f"chunk-{chunk_index:04d}.raw.wav"
            normalized_path = chunk_dir / f"chunk-{chunk_index:04d}.wav"
            self.get_engine(style.engine).synthesize(unit.text, style, raw_path)
            normalize_wav(raw_path, normalized_path)
            normalized_files.append(normalized_path)
            chunk_index += 1
        concat_audio(normalized_files, output_path)


def split_text_for_tts(text: str, comma_pause_ms: int = 160) -> List[TTSUnit]:
    units: List[TTSUnit] = []
    for paragraph in split_long_paragraph(text):
        for unit in split_paused_paragraph(paragraph, comma_pause_ms):
            if unit.is_pause:
                if units and not units[-1].is_pause:
                    units.append(unit)
                continue
            units.extend(TTSUnit(text=chunk) for chunk in split_tts_text(unit.text))

    while units and units[-1].is_pause:
        units.pop()
    return units or [TTSUnit(text=".")]


def punctuation_pause_ms_for_engine(style: VoiceStyle) -> int:
    if style.engine in {"chatterbox", "chatterbox_turbo"}:
        return 0
    return style.comma_pause_ms


def text_for_style(style: VoiceStyle, text: str) -> str:
    if style.engine in {"chatterbox", "chatterbox_turbo"}:
        return text
    return style.prompt_prefix + text


def split_paused_paragraph(paragraph: str, comma_pause_ms: int) -> List[TTSUnit]:
    if comma_pause_ms <= 0:
        return [TTSUnit(text=paragraph.strip())] if paragraph.strip() else []

    units: List[TTSUnit] = []
    buffer: List[str] = []
    index = 0
    while index < len(paragraph):
        char = paragraph[index]
        buffer.append(char)
        if char in PAUSING_PUNCTUATION and should_pause_after_punctuation(paragraph, index):
            pause_end = trailing_pause_boundary(paragraph, index)
            if pause_end > index + 1:
                buffer.append(paragraph[index + 1 : pause_end])
            text = clean_tts_piece("".join(buffer))
            if text:
                units.append(TTSUnit(text=text))
                units.append(TTSUnit(pause_ms=pause_for_punctuation(char, comma_pause_ms)))
            buffer = []
            index = pause_end
            while index < len(paragraph) and paragraph[index].isspace():
                index += 1
            continue
        index += 1

    text = clean_tts_piece("".join(buffer))
    if text:
        units.append(TTSUnit(text=text))
    return units


def should_pause_after_punctuation(text: str, index: int) -> bool:
    char = text[index]
    boundary = trailing_pause_boundary(text, index)
    if boundary < len(text) and not text[boundary].isspace():
        return False
    if char == ",":
        previous_char = text[index - 1] if index > 0 else ""
        next_non_space = next(
            (
                candidate
                for candidate in text[index + 1 :]
                if not candidate.isspace() and candidate not in TRAILING_PAUSE_MARKS
            ),
            "",
        )
        if previous_char.isdigit() and next_non_space.isdigit():
            return False
    return True


def trailing_pause_boundary(text: str, index: int) -> int:
    boundary = index + 1
    while boundary < len(text) and text[boundary] in TRAILING_PAUSE_MARKS:
        boundary += 1
    return boundary


def pause_for_punctuation(char: str, comma_pause_ms: int) -> int:
    if char == ",":
        return comma_pause_ms
    return max(comma_pause_ms + 80, round(comma_pause_ms * 1.35))


def split_tts_text(text: str, max_chars: int = 640) -> List[str]:
    if len(text) <= max_chars:
        return [text]

    chunks: List[str] = []
    remaining = text
    while len(remaining) > max_chars:
        split_at = remaining.rfind(" ", 0, max_chars + 1)
        if split_at < max_chars // 2:
            split_at = max_chars
        chunk = remaining[:split_at].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[split_at:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


def clean_tts_piece(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_in_place(path: Path) -> None:
    normalized = path.with_suffix(".normalized.wav")
    normalize_wav(path, normalized)
    normalized.replace(path)


def ensure_perth_watermarker() -> None:
    install_pkg_resources_compat()
    try:
        import perth
    except ImportError as error:
        raise TTSError("Chatterbox needs resemble-perth. Run `uv sync --project backend`.") from error

    if getattr(perth, "PerthImplicitWatermarker", None) is not None:
        return

    try:
        module = import_module("perth.perth_net.perth_net_implicit.perth_watermarker")
    except ModuleNotFoundError as error:
        if error.name == "pkg_resources":
            raise TTSError(
                "Chatterbox's PerTh dependency needs pkg_resources. Run `uv sync --project backend` to install setuptools<82."
            ) from error
        raise
    watermarker = getattr(module, "PerthImplicitWatermarker", None)
    if watermarker is None:
        raise TTSError("Chatterbox's PerTh watermarker could not be loaded.")
    perth.PerthImplicitWatermarker = watermarker


def install_pkg_resources_compat() -> None:
    try:
        import pkg_resources  # noqa: F401
        return
    except ModuleNotFoundError:
        pass

    module = types.ModuleType("pkg_resources")

    def resource_filename(package_or_requirement: str, resource_name: str) -> str:
        try:
            from importlib import resources

            return str(resources.files(package_or_requirement).joinpath(resource_name))
        except Exception as error:
            raise ModuleNotFoundError("pkg_resources") from error

    module.resource_filename = resource_filename  # type: ignore[attr-defined]
    sys.modules["pkg_resources"] = module


def best_torch_device(torch_module: object) -> str:
    if torch_module.cuda.is_available():
        return "cuda"
    if hasattr(torch_module.backends, "mps") and torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def kokoro_lang_code(language: Optional[str]) -> str:
    value = (language or "a").lower()
    mapping = {
        "en": "a",
        "en-us": "a",
        "american": "a",
        "en-gb": "b",
        "british": "b",
        "es": "e",
        "fr": "f",
        "hi": "h",
        "it": "i",
        "ja": "j",
        "pt": "p",
        "zh": "z",
    }
    return mapping.get(value, value[:1] or "a")
