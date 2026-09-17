import type { CallEvidence } from "./analysis-v2";

export function normalizeTranscriptText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[“”„״]/g, '"')
    .replace(/[’‘׳]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateEvidence(quote: unknown, transcript: string): CallEvidence {
  if (typeof quote !== "string" || quote.trim() === "") {
    return {
      quote: null,
      normalizedQuote: null,
      start: null,
      end: null,
      validation: "missing",
    };
  }

  const normalizedTranscript = normalizeTranscriptText(transcript);
  const normalizedQuote = normalizeTranscriptText(quote);
  const start = normalizedTranscript.indexOf(normalizedQuote);
  if (start < 0) {
    return {
      quote: quote.trim(),
      normalizedQuote,
      start: null,
      end: null,
      validation: "not_found",
    };
  }

  return {
    quote: quote.trim(),
    normalizedQuote,
    start,
    end: start + normalizedQuote.length,
    validation: "valid",
  };
}

export function hasValidEvidence(evidence: CallEvidence | null | undefined): boolean {
  return evidence?.validation === "valid";
}
