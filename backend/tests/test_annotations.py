from app.capabilities import tts_capabilities
from app.jobs import build_annotated_tts_segments, strip_paralinguistic_tags, validate_voice_ranges
from app.models import CastMember, Paragraph, VoiceRange, VoiceStyle


def turbo_style(style_id: str) -> VoiceStyle:
    return VoiceStyle(
        id=style_id,
        name=style_id,
        engine="chatterbox_turbo",
        voice="reference",
        language="en",
    )


def test_turbo_capabilities_include_paralinguistic_tags():
    tags = tts_capabilities()["chatterbox_turbo"].paralinguistic_tags

    assert tags == ["[laugh]", "[chuckle]", "[cough]", "[sigh]", "[gasp]", "[whisper]", "[breath]"]


def test_validate_voice_ranges_rejects_overlaps_and_unknown_cast():
    text = "Alice speaks and Bob replies."
    ranges = [
        VoiceRange(id="r1", start=0, end=12, cast_id="alice"),
        VoiceRange(id="r2", start=6, end=21, cast_id="bob"),
    ]

    errors = validate_voice_ranges(text, ranges, {"alice"})

    assert "overlap" in "; ".join(errors)
    assert "Unknown cast member" in "; ".join(errors)


def test_build_annotated_tts_segments_resolves_cast_styles():
    text = "Narrator opens. Alice answers. Narrator closes."
    start = text.index("Alice")
    end = start + len("Alice answers.")
    paragraph = Paragraph(
        id="p1",
        index=0,
        original_text=text,
        text=text,
        voice_ranges=[VoiceRange(id="r1", start=start, end=end, cast_id="alice")],
    )
    cast = [CastMember(id="alice", name="Alice", style_id="alice-style", color="#77aadd")]

    segments = build_annotated_tts_segments(
        paragraph,
        default_style=turbo_style("narrator"),
        cast=cast,
        load_style=lambda style_id: turbo_style(style_id),
    )

    assert [(segment.text, segment.style.id) for segment in segments] == [
        ("Narrator opens. ", "narrator"),
        ("Alice answers.", "alice-style"),
        (" Narrator closes.", "narrator"),
    ]


def test_strip_paralinguistic_tags_cleans_subtitle_text():
    assert strip_paralinguistic_tags("Wait [breath] this is funny [laugh].") == "Wait this is funny."
