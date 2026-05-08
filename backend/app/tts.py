from __future__ import annotations

import math
import os
import sys
import types
import wave
from importlib import import_module
from pathlib import Path
from typing import Dict, List, Optional

from .ffmpeg import concat_audio, normalize_wav
from .models import VoiceStyle
from .text_processing import split_long_paragraph


class TTSError(RuntimeError):
    pass


class BaseEngine:
    name = "base"

    def synthesize(self, text: str, style: VoiceStyle, output_path: Path) -> None:
        raise NotImplementedError


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
            raise TTSError("Kokoro is not installed. Install backend requirements and espeak-ng.") from error

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
            raise TTSError("Chatterbox needs torch and torchaudio. Install backend requirements.") from error

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
                    "Chatterbox's PerTh dependency needs pkg_resources. Install setuptools<82 or reinstall backend requirements."
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
        chunks = split_text_for_tts(style.prompt_prefix + text)
        if len(chunks) == 1:
            self.get_engine(style.engine).synthesize(chunks[0], style, output_path)
            normalize_in_place(output_path)
            return

        chunk_dir = output_path.with_suffix("")
        chunk_dir.mkdir(parents=True, exist_ok=True)
        normalized_files: List[Path] = []
        for index, chunk in enumerate(chunks):
            raw_path = chunk_dir / f"chunk-{index:04d}.raw.wav"
            normalized_path = chunk_dir / f"chunk-{index:04d}.wav"
            self.get_engine(style.engine).synthesize(chunk, style, raw_path)
            normalize_wav(raw_path, normalized_path)
            normalized_files.append(normalized_path)
        concat_audio(normalized_files, output_path)


def split_text_for_tts(text: str) -> List[str]:
    pieces: List[str] = []
    for paragraph in split_long_paragraph(text):
        if len(paragraph) <= 640:
            pieces.append(paragraph)
            continue
        for index in range(0, len(paragraph), 640):
            piece = paragraph[index : index + 640].strip()
            if piece:
                pieces.append(piece)
    return pieces or ["."]


def normalize_in_place(path: Path) -> None:
    normalized = path.with_suffix(".normalized.wav")
    normalize_wav(path, normalized)
    normalized.replace(path)


def ensure_perth_watermarker() -> None:
    install_pkg_resources_compat()
    try:
        import perth
    except ImportError as error:
        raise TTSError("Chatterbox needs resemble-perth. Reinstall backend requirements.") from error

    if getattr(perth, "PerthImplicitWatermarker", None) is not None:
        return

    try:
        module = import_module("perth.perth_net.perth_net_implicit.perth_watermarker")
    except ModuleNotFoundError as error:
        if error.name == "pkg_resources":
            raise TTSError(
                "Chatterbox's PerTh dependency needs pkg_resources. Install setuptools<82 or reinstall backend requirements."
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
