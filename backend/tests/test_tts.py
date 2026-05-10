from pathlib import Path

from app.models import VoiceStyle
from app.jobs import merge_style
from app.storage import default_styles
from app.tts import BaseEngine, TTSManager, split_text_for_tts


class RecordingEngine(BaseEngine):
    name = "recording"

    def __init__(self) -> None:
        self.texts: list[str] = []

    def synthesize(self, text: str, style: VoiceStyle, output_path: Path) -> None:
        self.texts.append(text)
        output_path.write_bytes(b"fake wav")


def stub_audio_pipeline(monkeypatch) -> None:
    monkeypatch.setattr("app.tts.normalize_in_place", lambda path: None)
    monkeypatch.setattr(
        "app.tts.normalize_wav",
        lambda input_path, output_path: output_path.write_bytes(b"normalized"),
    )
    monkeypatch.setattr(
        "app.tts.make_silence",
        lambda path, duration_seconds: path.write_bytes(b"silence"),
    )
    monkeypatch.setattr(
        "app.tts.concat_audio",
        lambda files, output_path: output_path.write_bytes(b"concat"),
    )


def test_split_text_for_tts_inserts_comma_pauses():
    units = split_text_for_tts("Wait, listen to this, then answer.", comma_pause_ms=180)

    assert [(unit.text, unit.pause_ms) for unit in units] == [
        ("Wait,", 0),
        ("", 180),
        ("listen to this,", 0),
        ("", 180),
        ("then answer.", 0),
    ]


def test_split_text_for_tts_does_not_pause_inside_numbers():
    units = split_text_for_tts("The price was 1,000 credits, payable now.", comma_pause_ms=180)

    assert [(unit.text, unit.pause_ms) for unit in units] == [
        ("The price was 1,000 credits,", 0),
        ("", 180),
        ("payable now.", 0),
    ]


def test_split_text_for_tts_pauses_after_commas_before_closing_quotes():
    units = split_text_for_tts("Wait,\u201d she said, \u201clisten.\u201d", comma_pause_ms=220)

    assert [(unit.text, unit.pause_ms) for unit in units] == [
        ("Wait,\u201d", 0),
        ("", 220),
        ("she said,", 0),
        ("", 220),
        ("\u201clisten.\u201d", 0),
    ]


def test_chatterbox_ignores_artificial_punctuation_pauses(monkeypatch, tmp_path):
    stub_audio_pipeline(monkeypatch)
    engine = RecordingEngine()
    manager = TTSManager()
    manager.engines["chatterbox"] = engine
    style = VoiceStyle(
        id="chatter",
        name="Chatterbox",
        engine="chatterbox",
        voice="reference",
        language="en",
        comma_pause_ms=240,
    )

    manager.synthesize("Wait, listen. Then answer.", style, tmp_path / "out.wav")

    assert engine.texts == ["Wait, listen. Then answer."]


def test_chatterbox_turbo_ignores_artificial_punctuation_pauses(monkeypatch, tmp_path):
    stub_audio_pipeline(monkeypatch)
    engine = RecordingEngine()
    manager = TTSManager()
    manager.engines["chatterbox_turbo"] = engine
    style = VoiceStyle(
        id="turbo",
        name="Chatterbox Turbo",
        engine="chatterbox_turbo",
        voice="reference",
        language="en",
        comma_pause_ms=240,
    )

    manager.synthesize("Wait, listen. Then answer.", style, tmp_path / "out.wav")

    assert engine.texts == ["Wait, listen. Then answer."]


def test_merge_style_clears_chatterbox_prompt_when_switching_to_kokoro():
    base = VoiceStyle(
        id="dramatic",
        name="Dramatic",
        engine="chatterbox",
        voice="reference",
        language="en",
        exaggeration=0.9,
        cfg_weight=0.2,
        prompt_prefix="[deep breath] ",
    )
    override = type(
        "Override",
        (),
        {
            "engine": "kokoro",
            "voice": "af_heart",
            "language": "a",
            "speed": 1.08,
            "comma_pause_ms": 140,
        },
    )()

    style = merge_style(base, override)

    assert style.engine == "kokoro"
    assert style.voice == "af_heart"
    assert style.language == "a"
    assert style.speed == 1.08
    assert style.comma_pause_ms == 140
    assert style.prompt_prefix == ""
    assert style.exaggeration == 0.5


def test_fantasy_style_uses_kokoro_george_voice():
    fantasy = default_styles()["fantasy"]

    assert fantasy.engine == "kokoro"
    assert fantasy.voice == "bm_george"
    assert fantasy.language == "b"
    assert fantasy.speed == 0.91
    assert fantasy.prompt_prefix == ""
