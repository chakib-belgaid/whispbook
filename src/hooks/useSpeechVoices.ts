import { useEffect, useState } from "react";
import { canUseSpeechSynthesis } from "../lib/speechVoices";

interface SpeechVoiceState {
  supported: boolean;
  voices: SpeechSynthesisVoice[];
  loaded: boolean;
}

export function useSpeechVoices(): SpeechVoiceState {
  const supported = canUseSpeechSynthesis();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!supported) {
      setVoices([]);
      setLoaded(true);
      return;
    }

    const synth = window.speechSynthesis;
    const refresh = () => {
      const nextVoices = synth.getVoices();
      setVoices(nextVoices);
      setLoaded(true);
    };

    refresh();
    synth.addEventListener("voiceschanged", refresh);
    const timeout = window.setTimeout(refresh, 900);

    return () => {
      window.clearTimeout(timeout);
      synth.removeEventListener("voiceschanged", refresh);
    };
  }, [supported]);

  return { supported, voices, loaded };
}
