// CSV parsing + row-by-row validation for the film assessment bank import.
//
// Pure — no Supabase, no HTTP. This is the authority for whether a row may become
// a DRAFT item, and it is what the PRD's import-validation checklist (§7.2) and QA
// rows (QA-01) test.
//
// The supplied bank is 256 rows, but this validator does NOT hard-fail a batch for
// not being 256: the 256 is the initial SEED expectation, while admins will import
// corrections and SME-approved additions later. Instead the count is surfaced as a
// warning so the preview is honest about an unexpected size without blocking work.

import {
  OPTION_IDS,
  isFilmModuleCode,
  isFilmStage,
  type FilmQuestionDraft,
  type ImportReport,
  type RowProblem,
} from './types';

/** RFC-4180-ish parser: handles quoted fields, embedded commas/newlines, "" escapes, BOM. */
export function parseCsv(text: string): string[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  while (i < clean.length) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { pushField(); i += 1; continue; }
    if (c === '\r') { if (clean[i + 1] === '\n') { i += 1; } pushRow(); i += 1; continue; }
    if (c === '\n') { pushRow(); i += 1; continue; }
    field += c; i += 1; continue;
  }
  // Flush the final field/row when the file does not end with a newline.
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop an all-empty trailing row that a terminal newline would produce.
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const REQUIRED_HEADERS = [
  'Question ID', 'Stage', 'Module ID', 'Module', 'Question',
  'Option A', 'Option B', 'Option C', 'Option D', 'Correct Option',
  'Points',
] as const;

function buildIndex(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => { idx[h.trim().toLowerCase()] = i; });
  return idx;
}

function cell(row: string[], idx: Record<string, number>, name: string): string {
  const at = idx[name.trim().toLowerCase()];
  if (at === undefined) return '';
  return (row[at] ?? '').trim();
}

/** Normalise for "does Answer Text match the referenced option" — case/space-insensitive. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function splitKeywords(raw: string): string[] {
  return raw
    ? raw.split(',').map((k) => k.trim()).filter(Boolean)
    : [];
}

export interface HeaderCheck {
  ok: boolean;
  missing: string[];
}

export function checkHeaders(headerRow: string[] | undefined): HeaderCheck {
  if (!headerRow) return { ok: false, missing: [...REQUIRED_HEADERS] };
  const have = new Set(headerRow.map((h) => h.trim().toLowerCase()));
  const missing = REQUIRED_HEADERS.filter((h) => !have.has(h.trim().toLowerCase()));
  return { ok: missing.length === 0, missing };
}

/**
 * Parse + validate a full CSV into an ImportReport.
 * `rows[0]` is treated as the header. A row that cannot become a draft is rejected
 * with a reason; a valid-but-notable row is warned. Rejected rows never block the
 * accepted ones — a partially valid batch stays in staging (§7.2).
 */
export function parseAndValidate(text: string): ImportReport {
  const grid = parseCsv(text);
  const header = grid[0] ?? [];
  const idx = buildIndex(header);
  const dataRows = grid.slice(1);

  const accepted: FilmQuestionDraft[] = [];
  const rejected: RowProblem[] = [];
  const warned: RowProblem[] = [];
  const seenCodes = new Map<string, number>(); // external_code -> first row number
  const seenStems = new Set<string>();

  dataRows.forEach((row, r) => {
    const rowNum = r + 1;
    const code = cell(row, idx, 'Question ID');
    const problems: string[] = [];

    if (!code) problems.push('Question ID is blank');

    const stage = cell(row, idx, 'Stage');
    if (stage && !isFilmStage(stage)) problems.push(`Stage "${stage}" is not L0-L5`);

    const moduleCode = cell(row, idx, 'Module ID');
    if (moduleCode && !isFilmModuleCode(moduleCode)) {
      problems.push(`Module ID "${moduleCode}" is not FM01-FM32`);
    }

    const stem = cell(row, idx, 'Question');
    if (!stem) problems.push('Question stem is blank');

    // Exactly four distinct, non-blank options.
    const options = OPTION_IDS.map((id) => ({
      id,
      text: cell(row, idx, `Option ${id.toUpperCase()}`),
    }));
    if (options.some((o) => !o.text)) problems.push('All four options (A-D) are required');
    const texts = options.map((o) => normalise(o.text));
    if (new Set(texts).size !== 4) problems.push('Options must be four distinct answers');

    // Correct option in {A,B,C,D}.
    const correctRaw = cell(row, idx, 'Correct Option').toUpperCase().charAt(0);
    const correctId = correctRaw.toLowerCase();
    if (!OPTION_IDS.includes(correctId as (typeof OPTION_IDS)[number])) {
      problems.push('Correct Option must be A, B, C or D');
    }

    // Answer Text must match the referenced choice (after normalisation).
    const answerText = cell(row, idx, 'Answer Text');
    if (correctId && answerText) {
      const chosen = options.find((o) => o.id === correctId);
      if (chosen && normalise(chosen.text) !== normalise(answerText)) {
        problems.push('Answer Text does not match the Correct Option');
      }
    }

    // Points: positive finite.
    const pointsRaw = cell(row, idx, 'Points');
    const points = Number(pointsRaw);
    if (!pointsRaw || !Number.isFinite(points) || points <= 0) {
      problems.push('Points must be a positive number');
    }

    // Duplicate external_code within the file.
    if (code && seenCodes.has(code)) {
      problems.push(`Duplicate Question ID (also on row ${seenCodes.get(code)})`);
    }

    if (problems.length > 0) {
      rejected.push({ row: rowNum, externalCode: code || undefined, message: problems.join('; ') });
      return;
    }

    if (code) seenCodes.set(code, rowNum);

    // Warnings (non-blocking).
    if (stem && seenStems.has(normalise(stem))) {
      warned.push({ row: rowNum, externalCode: code, message: 'Identical question text appears more than once' });
    } else if (stem) {
      seenStems.add(normalise(stem));
    }
    if (stem && stem.length > 600) {
      warned.push({ row: rowNum, externalCode: code, message: 'Unusually long question text' });
    }
    const type = cell(row, idx, 'Question Type');
    if (type && !/single[-\s]?select/i.test(type)) {
      warned.push({ row: rowNum, externalCode: code, message: `Question Type "${type}" mapped as single-select` });
    }
    const status = cell(row, idx, 'Status');
    if (status && !/draft/i.test(status)) {
      warned.push({ row: rowNum, externalCode: code, message: `Status "${status}" will still be imported as draft (never auto-published)` });
    }

    accepted.push({
      externalCode: code,
      stage,
      department: cell(row, idx, 'Department'),
      moduleCode,
      moduleLabel: cell(row, idx, 'Module'),
      learningOutcome: cell(row, idx, 'Learning Outcome'),
      cognitive: cell(row, idx, 'Cognitive Level'),
      difficulty: cell(row, idx, 'Difficulty'),
      stem,
      options,
      answer: { correct: [correctId], explanation: cell(row, idx, 'Explanation') || undefined },
      points: Math.max(1, Math.round(points)),
      locale: cell(row, idx, 'Language') || 'en-NG',
      keywords: splitKeywords(cell(row, idx, 'Keywords')),
      sourceVersion: cell(row, idx, 'Version') || '1.0',
      owner: cell(row, idx, 'Owner'),
      reviewNotes: cell(row, idx, 'Review Notes'),
    });
  });

  // Seed-size reconciliation: warn, never block (§7.1 "initial seed expectation").
  if (dataRows.length > 0 && dataRows.length !== 256) {
    warned.unshift({
      row: 0,
      message: `Expected the 256-row starter bank but the file has ${dataRows.length} data rows`,
    });
  }

  return { totalRows: dataRows.length, accepted, rejected, warned };
}

/** Deterministic content fingerprint for an accepted draft (dedupe of identical revisions). */
export function draftContentHash(d: FilmQuestionDraft): string {
  const canon = JSON.stringify({
    stage: d.stage, module: d.moduleCode, outcome: d.learningOutcome,
    stem: normalise(d.stem),
    options: d.options.map((o) => normalise(o.text)),
    answer: [...d.answer.correct].sort(),
    points: d.points, locale: d.locale,
  });
  return fnv1a(canon);
}

// FNV-1a — small, stable, dependency-free; only used to compare an imported row
// against the stored one to decide "changed" vs "identical". Not a security hash.
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
