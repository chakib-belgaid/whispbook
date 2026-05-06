export function pickPhonemizerLanguage(espeakVoice: unknown, identifiers: Set<string>): string {
  return buildPhonemizerCandidates(espeakVoice).find((candidate) => identifiers.has(candidate)) ?? "en-us";
}

export function buildPhonemizerCandidates(espeakVoice: unknown): string[] {
  const source = coerceLanguageIdentifier(espeakVoice);
  const normalized = source.replaceAll("_", "-");
  const lower = normalized.toLowerCase();

  return unique([
    source,
    normalized,
    lower,
    lower === "en-us" ? "gmw/en-US" : "",
    lower === "en-gb" ? "gmw/en" : "",
    "en-us",
    "gmw/en-US",
    "en"
  ]);
}

function coerceLanguageIdentifier(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["voice", "language", "identifier", "name"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return "en-us";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
