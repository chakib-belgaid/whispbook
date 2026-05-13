from app import main as api
from app.models import Book, BookPatch, CastMember, Chapter, Paragraph


def test_update_book_preserves_cast_when_patch_omits_cast(monkeypatch):
    cast_member = CastMember(
        id="alice",
        name="Alice",
        style_id="alice-style",
        color="#77aadd",
    )
    paragraph = Paragraph(
        id="p1",
        index=0,
        original_text="Alice speaks.",
        text="Alice speaks.",
    )
    chapter = Chapter(
        id="c1",
        index=0,
        title="Chapter 1",
        selected=True,
        status="done",
        status_message="Generated",
        paragraphs=[paragraph],
        audio_url="/media/chapter.m4a",
        vtt_url="/media/chapter.vtt",
        srt_url="/media/chapter.srt",
        generated_at=123.0,
    )
    book = Book(
        id="b1",
        title="Original title",
        filename="book.md",
        created_at=1.0,
        updated_at=2.0,
        cast=[cast_member],
        chapters=[chapter],
    )
    patch = BookPatch.model_validate(
        {
            "title": "Renamed",
            "chapters": [
                {
                    "id": "c1",
                    "title": "Chapter 1",
                    "selected": True,
                    "paragraphs": [
                        {
                            "id": "p1",
                            "text": "Alice speaks.",
                            "included": True,
                            "voice_ranges": [],
                        }
                    ],
                }
            ],
        }
    )

    monkeypatch.setattr(api, "load_or_404", lambda book_id: book)
    monkeypatch.setattr(api, "save_book", lambda saved: saved)

    updated = api.update_book("b1", patch)

    assert updated.cast == [cast_member]
    assert updated.chapters[0].status == "done"
    assert updated.chapters[0].audio_url == "/media/chapter.m4a"
