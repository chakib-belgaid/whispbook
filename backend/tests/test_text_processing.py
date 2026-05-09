from app.text_processing import paragraphs_from_text, split_chapters


def test_split_chapters_detects_common_headings():
    paragraphs = paragraphs_from_text(
        """
        Chapter One

        The road bent toward the old tower.

        Chapter Two

        A silver light crossed the valley.
        """
    )

    chapters = split_chapters(paragraphs)

    assert [title for title, _ in chapters] == ["Chapter One", "Chapter Two"]
    assert chapters[0][1] == ["The road bent toward the old tower."]


def test_split_chapters_detects_markdown_headings():
    paragraphs = paragraphs_from_text(
        """
        # Chapter One

        The road bent toward the old tower.

        ## Chapter Two

        A silver light crossed the valley.
        """
    )

    chapters = split_chapters(paragraphs)

    assert [title for title, _ in chapters] == ["Chapter One", "Chapter Two"]
    assert chapters[0][1] == ["The road bent toward the old tower."]


def test_paragraph_cleanup_splits_long_text():
    text = "Chapter 1\n\n" + ("This sentence is readable. " * 120)
    paragraphs = paragraphs_from_text(text)

    assert len(paragraphs) > 1
    assert all(len(paragraph) <= 1200 for paragraph in paragraphs)
