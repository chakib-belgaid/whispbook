from app.subtitles import SubtitleCue, format_srt_time, format_vtt_time, wrap_subtitle_text


def test_subtitle_time_formatting():
    assert format_vtt_time(3723.456) == "01:02:03.456"
    assert format_srt_time(3723.456) == "01:02:03,456"


def test_subtitle_text_is_wrapped_and_escaped():
    lines = wrap_subtitle_text("A line with <markup> and enough words to wrap across more than one subtitle row.", 32)

    assert len(lines) > 1
    assert "&lt;markup&gt;" in " ".join(lines)

