/**
 * Estate AI meeting notes (Block 39).
 *
 * The "AI" summary is produced by a deterministic, dependency-free extractive
 * summariser over the recorded meeting minutes — no external LLM call, so it is
 * cheap, private, and reproducible. It scores sentences by keyword frequency and
 * position, takes the top few, and lifts action items from the minutes'
 * `decisions` JSON (and any "action:"/"to-do:" lines in the body).
 */

export interface ExtractiveResult { summary: string; actionItems: string[]; }

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its',
  'as', 'we', 'they', 'he', 'she', 'will', 'shall', 'has', 'have', 'had', 'not', 'all', 'any', 'our',
]);

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9₦][a-z0-9'₦,.-]*/g)?.map((w) => w.replace(/[^a-z0-9₦]/g, '')) ?? [];
}

export function summariseMinutes(content: string, decisions: unknown, maxSentences = 3): ExtractiveResult {
  const text = (content ?? '').trim();
  const sentences = splitSentences(text);

  // Term-frequency table (minus stopwords) to score sentence salience.
  const freq = new Map<string, number>();
  for (const w of tokenize(text)) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  const scored = sentences.map((s, idx) => {
    const words = tokenize(s).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
    const raw = words.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0);
    const norm = words.length ? raw / words.length : 0;
    // Light positional bias: earlier sentences carry agenda framing.
    const positionBoost = 1 + (sentences.length - idx) / (sentences.length * 4);
    return { s, idx, score: norm * positionBoost };
  });

  const top = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.idx - b.idx) // restore reading order
    .map((x) => x.s);

  const summary = top.join(' ').trim() || (text ? text.slice(0, 400) : 'No minutes were recorded for this meeting.');

  // Action items: decisions[] first, then any imperative-ish lines in the body.
  const actionItems: string[] = [];
  if (Array.isArray(decisions)) {
    for (const d of decisions) {
      if (typeof d === 'string' && d.trim()) actionItems.push(d.trim());
      else if (d && typeof d === 'object' && 'text' in (d as any) && typeof (d as any).text === 'string') actionItems.push((d as any).text.trim());
    }
  }
  for (const line of text.split(/\n+/)) {
    const m = line.match(/^\s*(?:action|to-?do|todo|next step)s?\s*[:\-]\s*(.+)$/i);
    if (m && m[1].trim()) actionItems.push(m[1].trim());
  }

  // De-dup + cap.
  const seen = new Set<string>();
  const deduped = actionItems.filter((a) => { const k = a.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);

  return { summary, actionItems: deduped };
}
