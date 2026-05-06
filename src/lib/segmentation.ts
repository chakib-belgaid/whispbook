import type { TextSegment } from "../types";

const sentencePattern = /[^.!?;:]+[.!?;:]+["')\]]*|[^.!?;:]+$/g;
const maxSegmentLength = 520;

export function normalizeReadableText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function segmentText(input: string): TextSegment[] {
  const text = normalizeReadableText(input);
  if (!text) {
    return [];
  }

  const segments: TextSegment[] = [];
  const paragraphMatches = [...text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)];

  for (const paragraphMatch of paragraphMatches) {
    const paragraph = paragraphMatch[0].replace(/\n/g, " ").replace(/\s{2,}/g, " ").trim();
    const paragraphStart = paragraphMatch.index ?? 0;
    if (!paragraph) {
      continue;
    }

    const sentenceMatches = [...paragraph.matchAll(sentencePattern)];
    const sourceMatches = sentenceMatches.length > 0 ? sentenceMatches : [[paragraph] as unknown as RegExpMatchArray];

    for (const match of sourceMatches) {
      const sentence = match[0].replace(/\s{2,}/g, " ").trim();
      if (!sentence) {
        continue;
      }

      const localStart = match.index ?? 0;
      pushSegmentPieces(segments, sentence, paragraphStart + localStart);
    }
  }

  return segments.map((segment, index) => ({
    ...segment,
    id: `seg-${index}-${segment.start}`,
    index
  }));
}

function pushSegmentPieces(segments: TextSegment[], sentence: string, absoluteStart: number): void {
  if (sentence.length <= maxSegmentLength) {
    segments.push({
      id: "",
      index: segments.length,
      text: sentence,
      start: absoluteStart,
      end: absoluteStart + sentence.length
    });
    return;
  }

  let cursor = 0;
  while (cursor < sentence.length) {
    const remaining = sentence.slice(cursor);
    const cut = findReadableCut(remaining);
    const text = remaining.slice(0, cut).trim();
    if (text) {
      segments.push({
        id: "",
        index: segments.length,
        text,
        start: absoluteStart + cursor,
        end: absoluteStart + cursor + text.length
      });
    }
    cursor += cut;
  }
}

function findReadableCut(text: string): number {
  if (text.length <= maxSegmentLength) {
    return text.length;
  }

  const window = text.slice(0, maxSegmentLength);
  const punctuationCut = Math.max(window.lastIndexOf(","), window.lastIndexOf(" - "), window.lastIndexOf(" "));
  return punctuationCut > 160 ? punctuationCut + 1 : maxSegmentLength;
}
