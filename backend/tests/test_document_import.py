import builtins
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.main import extract_document_text, validate_supported_document


def test_validate_supported_document_accepts_core_extensions():
    assert validate_supported_document("novel.PDF") == ".pdf"
    assert validate_supported_document("outline.docx") == ".docx"
    assert validate_supported_document("slides.pptx") == ".pptx"
    assert validate_supported_document("notes.md") == ".md"
    assert validate_supported_document("book.epub") == ".epub"


def test_validate_supported_document_rejects_unsupported_extensions():
    with pytest.raises(HTTPException) as caught:
        validate_supported_document("archive.zip")

    assert caught.value.status_code == 400
    assert "supported document" in caught.value.detail
    assert ".pdf" in caught.value.detail


def test_extract_document_text_uses_markitdown_stream_metadata(monkeypatch):
    fake_markitdown = install_fake_markitdown(monkeypatch, text_content="  Chapter One\n\nThe road bent.  ")

    extracted = extract_document_text(b"document bytes", "Story.DOCX")

    assert extracted == "Chapter One\n\nThe road bent."
    assert fake_markitdown.calls == [
        {
            "content": b"document bytes",
            "filename": "Story.DOCX",
            "extension": ".docx",
            "mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "options": {"enable_plugins": False},
        }
    ]


def test_extract_document_text_rejects_empty_conversion(monkeypatch):
    install_fake_markitdown(monkeypatch, text_content=" \n ")

    with pytest.raises(HTTPException) as caught:
        extract_document_text(b"%PDF", "scanned.pdf")

    assert caught.value.status_code == 422
    assert "No text content found" in caught.value.detail
    assert "OCR" in caught.value.detail


def test_extract_document_text_surfaces_conversion_failure(monkeypatch):
    install_fake_markitdown(monkeypatch, error=RuntimeError("broken file"))

    with pytest.raises(HTTPException) as caught:
        extract_document_text(b"bad bytes", "broken.pdf")

    assert caught.value.status_code == 422
    assert "Could not convert" in caught.value.detail


def test_extract_document_text_reports_missing_markitdown(monkeypatch):
    original_import = builtins.__import__

    def missing_markitdown(name, *args, **kwargs):
        if name == "markitdown":
            raise ImportError("missing")
        return original_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "markitdown", raising=False)
    monkeypatch.setattr(builtins, "__import__", missing_markitdown)

    with pytest.raises(HTTPException) as caught:
        extract_document_text(b"%PDF", "book.pdf")

    assert caught.value.status_code == 500
    assert "MarkItDown is required" in caught.value.detail


def test_extract_document_text_does_not_import_pypdf(monkeypatch):
    install_fake_markitdown(monkeypatch, text_content="Chapter One\n\nThe road bent.")
    original_import = builtins.__import__

    def block_pypdf(name, *args, **kwargs):
        if name == "pypdf":
            raise AssertionError("PyPDF should not be imported")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", block_pypdf)

    assert extract_document_text(b"%PDF", "book.pdf") == "Chapter One\n\nThe road bent."


def install_fake_markitdown(monkeypatch, text_content="", error=None):
    class FakeStreamInfo:
        def __init__(self, **kwargs):
            self.filename = kwargs["filename"]
            self.extension = kwargs["extension"]
            self.mimetype = kwargs["mimetype"]

    class FakeMarkItDown:
        calls = []

        def __init__(self, **kwargs):
            self.options = kwargs

        def convert_stream(self, stream, *, stream_info):
            if error is not None:
                raise error
            self.__class__.calls.append(
                {
                    "content": stream.read(),
                    "filename": stream_info.filename,
                    "extension": stream_info.extension,
                    "mimetype": stream_info.mimetype,
                    "options": self.options,
                }
            )
            return SimpleNamespace(text_content=text_content)

    monkeypatch.setitem(
        sys.modules,
        "markitdown",
        SimpleNamespace(MarkItDown=FakeMarkItDown, StreamInfo=FakeStreamInfo),
    )
    return FakeMarkItDown
