const defaultMaxChunkLength = 140;
const minimumReadableCut = 42;

export function splitSpeechText(text: string, maxLength = defaultMaxChunkLength): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const remaining = normalized.slice(cursor).trimStart();
    const skipped = normalized.length - cursor - remaining.length;
    cursor += skipped;

    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const cut = findSpeechCut(remaining, maxLength);
    const chunk = remaining.slice(0, cut).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    cursor += cut;
  }

  return chunks;
}

function findSpeechCut(text: string, maxLength: number): number {
  const window = text.slice(0, maxLength);
  const punctuationCuts = [". ", "? ", "! ", "; ", ": ", ", "].map((marker) => window.lastIndexOf(marker));
  const punctuationCut = Math.max(...punctuationCuts);
  if (punctuationCut >= minimumReadableCut) {
    return punctuationCut + 1;
  }

  const spaceCut = window.lastIndexOf(" ");
  return spaceCut >= minimumReadableCut ? spaceCut : maxLength;
}
