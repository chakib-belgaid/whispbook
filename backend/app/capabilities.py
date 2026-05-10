from __future__ import annotations

from typing import Dict

from .models import EngineCapabilities, TTSOption, TTSVoiceOption


KOKORO_LANGUAGES = [
    TTSOption(value="a", label="American English"),
    TTSOption(value="b", label="British English"),
    TTSOption(value="e", label="Spanish"),
    TTSOption(value="f", label="French"),
    TTSOption(value="h", label="Hindi"),
    TTSOption(value="i", label="Italian"),
    TTSOption(value="j", label="Japanese"),
    TTSOption(value="p", label="Portuguese"),
    TTSOption(value="z", label="Chinese"),
]

KOKORO_VOICES = [
    TTSVoiceOption(value="af_heart", label="Heart", language="a"),
    TTSVoiceOption(value="af_alloy", label="Alloy", language="a"),
    TTSVoiceOption(value="af_aoede", label="Aoede", language="a"),
    TTSVoiceOption(value="af_bella", label="Bella", language="a"),
    TTSVoiceOption(value="af_jessica", label="Jessica", language="a"),
    TTSVoiceOption(value="af_kore", label="Kore", language="a"),
    TTSVoiceOption(value="af_nicole", label="Nicole", language="a"),
    TTSVoiceOption(value="af_nova", label="Nova", language="a"),
    TTSVoiceOption(value="af_river", label="River", language="a"),
    TTSVoiceOption(value="af_sarah", label="Sarah", language="a"),
    TTSVoiceOption(value="af_sky", label="Sky", language="a"),
    TTSVoiceOption(value="am_adam", label="Adam", language="a"),
    TTSVoiceOption(value="am_echo", label="Echo", language="a"),
    TTSVoiceOption(value="am_eric", label="Eric", language="a"),
    TTSVoiceOption(value="am_fenrir", label="Fenrir", language="a"),
    TTSVoiceOption(value="am_liam", label="Liam", language="a"),
    TTSVoiceOption(value="am_michael", label="Michael", language="a"),
    TTSVoiceOption(value="am_onyx", label="Onyx", language="a"),
    TTSVoiceOption(value="am_puck", label="Puck", language="a"),
    TTSVoiceOption(value="am_santa", label="Santa", language="a"),
    TTSVoiceOption(value="bf_alice", label="Alice", language="b"),
    TTSVoiceOption(value="bf_emma", label="Emma", language="b"),
    TTSVoiceOption(value="bf_isabella", label="Isabella", language="b"),
    TTSVoiceOption(value="bf_lily", label="Lily", language="b"),
    TTSVoiceOption(value="bm_daniel", label="Daniel", language="b"),
    TTSVoiceOption(value="bm_fable", label="Fable", language="b"),
    TTSVoiceOption(value="bm_george", label="George", language="b"),
    TTSVoiceOption(value="bm_lewis", label="Lewis", language="b"),
    TTSVoiceOption(value="ef_dora", label="Dora", language="e"),
    TTSVoiceOption(value="em_alex", label="Alex", language="e"),
    TTSVoiceOption(value="em_santa", label="Santa", language="e"),
    TTSVoiceOption(value="ff_siwis", label="Siwis", language="f"),
    TTSVoiceOption(value="hf_alpha", label="Alpha", language="h"),
    TTSVoiceOption(value="hf_beta", label="Beta", language="h"),
    TTSVoiceOption(value="hm_omega", label="Omega", language="h"),
    TTSVoiceOption(value="hm_psi", label="Psi", language="h"),
    TTSVoiceOption(value="if_sara", label="Sara", language="i"),
    TTSVoiceOption(value="im_nicola", label="Nicola", language="i"),
    TTSVoiceOption(value="jf_alpha", label="Alpha", language="j"),
    TTSVoiceOption(value="jf_gongitsune", label="Gongitsune", language="j"),
    TTSVoiceOption(value="jf_nezumi", label="Nezumi", language="j"),
    TTSVoiceOption(value="jf_tebukuro", label="Tebukuro", language="j"),
    TTSVoiceOption(value="jm_kumo", label="Kumo", language="j"),
    TTSVoiceOption(value="pf_dora", label="Dora", language="p"),
    TTSVoiceOption(value="pm_alex", label="Alex", language="p"),
    TTSVoiceOption(value="pm_santa", label="Santa", language="p"),
    TTSVoiceOption(value="zf_xiaobei", label="Xiaobei", language="z"),
    TTSVoiceOption(value="zf_xiaoni", label="Xiaoni", language="z"),
    TTSVoiceOption(value="zf_xiaoxiao", label="Xiaoxiao", language="z"),
    TTSVoiceOption(value="zf_xiaoyi", label="Xiaoyi", language="z"),
    TTSVoiceOption(value="zm_yunjian", label="Yunjian", language="z"),
    TTSVoiceOption(value="zm_yunxi", label="Yunxi", language="z"),
    TTSVoiceOption(value="zm_yunxia", label="Yunxia", language="z"),
    TTSVoiceOption(value="zm_yunyang", label="Yunyang", language="z"),
]

CHATTERBOX_LANGUAGES = [
    TTSOption(value="ar", label="Arabic"),
    TTSOption(value="da", label="Danish"),
    TTSOption(value="de", label="German"),
    TTSOption(value="el", label="Greek"),
    TTSOption(value="en", label="English"),
    TTSOption(value="es", label="Spanish"),
    TTSOption(value="fi", label="Finnish"),
    TTSOption(value="fr", label="French"),
    TTSOption(value="he", label="Hebrew"),
    TTSOption(value="hi", label="Hindi"),
    TTSOption(value="it", label="Italian"),
    TTSOption(value="ja", label="Japanese"),
    TTSOption(value="ko", label="Korean"),
    TTSOption(value="ms", label="Malay"),
    TTSOption(value="nl", label="Dutch"),
    TTSOption(value="no", label="Norwegian"),
    TTSOption(value="pl", label="Polish"),
    TTSOption(value="pt", label="Portuguese"),
    TTSOption(value="ru", label="Russian"),
    TTSOption(value="sv", label="Swedish"),
    TTSOption(value="sw", label="Swahili"),
    TTSOption(value="tr", label="Turkish"),
    TTSOption(value="zh", label="Chinese"),
]

CHATTERBOX_VOICES = [
    TTSVoiceOption(value="default", label="Default model voice", language="en"),
    TTSVoiceOption(value="reference", label="Custom reference audio", language="en"),
]

CHATTERBOX_TURBO_PARALINGUISTIC_TAGS = [
    "[laugh]",
    "[chuckle]",
    "[cough]",
    "[sigh]",
    "[gasp]",
    "[whisper]",
    "[breath]",
]


def tts_capabilities() -> Dict[str, EngineCapabilities]:
    chatterbox = EngineCapabilities(engine="chatterbox", voices=CHATTERBOX_VOICES, languages=CHATTERBOX_LANGUAGES)
    return {
        "kokoro": EngineCapabilities(engine="kokoro", voices=KOKORO_VOICES, languages=KOKORO_LANGUAGES),
        "chatterbox": chatterbox,
        "chatterbox_turbo": chatterbox.model_copy(
            update={
                "engine": "chatterbox_turbo",
                "paralinguistic_tags": CHATTERBOX_TURBO_PARALINGUISTIC_TAGS,
            }
        ),
        "mock": EngineCapabilities(
            engine="mock",
            voices=[TTSVoiceOption(value="mock", label="Mock sine voice", language="en")],
            languages=[TTSOption(value="en", label="English")],
        ),
    }
