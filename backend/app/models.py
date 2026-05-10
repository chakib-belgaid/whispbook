from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


ChapterStatus = Literal["draft", "queued", "generating", "done", "error"]
EngineName = Literal["kokoro", "chatterbox", "chatterbox_turbo", "mock"]
JobStatus = Literal["queued", "running", "done", "error"]


class VoiceRange(BaseModel):
    id: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    cast_id: str


class CastMember(BaseModel):
    id: str
    name: str
    style_id: str
    color: str


class Paragraph(BaseModel):
    id: str
    index: int
    original_text: str
    text: str
    included: bool = True
    voice_ranges: List[VoiceRange] = Field(default_factory=list)


class Chapter(BaseModel):
    id: str
    index: int
    title: str
    selected: bool = True
    status: ChapterStatus = "draft"
    status_message: Optional[str] = None
    paragraphs: List[Paragraph]
    audio_url: Optional[str] = None
    vtt_url: Optional[str] = None
    srt_url: Optional[str] = None
    generated_at: Optional[float] = None


class Book(BaseModel):
    id: str
    title: str
    filename: str
    created_at: float
    updated_at: float
    cast: List[CastMember] = Field(default_factory=list)
    chapters: List[Chapter]
    final_audio_url: Optional[str] = None
    final_vtt_url: Optional[str] = None
    final_srt_url: Optional[str] = None
    final_package_url: Optional[str] = None


class ParagraphPatch(BaseModel):
    id: str
    text: str
    included: bool
    voice_ranges: List[VoiceRange] = Field(default_factory=list)


class ChapterPatch(BaseModel):
    id: str
    title: str
    selected: bool
    paragraphs: List[ParagraphPatch]


class BookPatch(BaseModel):
    title: Optional[str] = None
    cast: List[CastMember] = Field(default_factory=list)
    chapters: List[ChapterPatch] = Field(default_factory=list)


class VoiceStyle(BaseModel):
    id: str
    name: str
    engine: EngineName
    description: str = ""
    voice: str = "af_heart"
    language: str = "a"
    speed: float = 1.0
    exaggeration: float = 0.5
    cfg_weight: float = 0.5
    temperature: float = 0.8
    top_p: float = 1.0
    paragraph_gap_ms: int = 450
    comma_pause_ms: int = 160
    prompt_prefix: str = ""
    reference_audio_path: Optional[str] = None
    reference_audio_url: Optional[str] = None
    custom: bool = False


class TTSOption(BaseModel):
    value: str
    label: str


class TTSVoiceOption(TTSOption):
    language: str


class EngineCapabilities(BaseModel):
    engine: EngineName
    voices: List[TTSVoiceOption]
    languages: List[TTSOption]
    paralinguistic_tags: List[str] = Field(default_factory=list)


class StyleOverride(BaseModel):
    style_id: str = "neutral"
    engine: Optional[EngineName] = None
    voice: Optional[str] = None
    language: Optional[str] = None
    speed: Optional[float] = None
    exaggeration: Optional[float] = None
    cfg_weight: Optional[float] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    paragraph_gap_ms: Optional[int] = None
    comma_pause_ms: Optional[int] = None
    prompt_prefix: Optional[str] = None


class PreviewRequest(BaseModel):
    text: str
    style: StyleOverride
    subtitle_text: Optional[str] = None
    cast: List[CastMember] = Field(default_factory=list)
    voice_ranges: List[VoiceRange] = Field(default_factory=list)


class PreviewResponse(BaseModel):
    id: str
    audio_url: str
    vtt_url: str
    duration_seconds: float


class GenerateRequest(BaseModel):
    chapter_ids: List[str] = Field(default_factory=list)
    style: StyleOverride
    subtitle_source: Literal["edited", "original"] = "edited"


class ChapterJobState(BaseModel):
    chapter_id: str
    title: str
    status: ChapterStatus
    message: Optional[str] = None
    audio_url: Optional[str] = None
    vtt_url: Optional[str] = None
    srt_url: Optional[str] = None


class GenerateJob(BaseModel):
    id: str
    book_id: str
    status: JobStatus
    created_at: float
    updated_at: float
    message: str = ""
    progress: float = 0
    chapters: List[ChapterJobState] = Field(default_factory=list)
    final_audio_url: Optional[str] = None
    final_vtt_url: Optional[str] = None
    final_srt_url: Optional[str] = None
    final_package_url: Optional[str] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    ok: bool
    ffmpeg: bool
    engines: Dict[str, bool]
    storage_path: str
