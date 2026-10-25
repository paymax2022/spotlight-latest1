// CSV parsing + row-by-row validation for the film assessment bank import.
//
// Pure — no Supabase, no HTTP. This is the authority for whether a row may become
// a DRAFT item, and it is what the PRD's import-validation checklist (§7.2) and QA
// rows (QA-01) test.
//
// Two header formats are auto-detected: the legacy Title Case 256-row bank and the
// snake_case TMFA curriculum-pack bank (336 rows). Neither row count hard-fails a
// batch: it is the initial SEED expectation, while admins will import corrections
// and SME-approved additions later. Instead the count is surfaced as a warning so
// the preview is honest about an unexpected size without blocking work.

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

export type ImportFormat = 'legacy' | 'tmfa';

/**
 * Column names per supported format. `legacy` is the Title Case 256-row bank;
 * `tmfa` is the snake_case TMFA curriculum-pack bank (TMFA_QUESTION_BANK_DRAFT.csv).
 * A TMFA row maps verbatim: question_id -> external_code, topic_id ->
 * film_module_code, stage -> film_stage, rationale -> answer.explanation.
 */
interface FormatSpec {
  required: readonly string[];
  expectedRows: number;
  code: string; stage: string; moduleCode: string; moduleLabel: string;
  department: string; learningOutcome: string; cognitive: string; difficulty: string;
  stem: string; option: (letter: string) => string; correct: string; answerText: string;
  explanation: string; points: string; type: string; status: string; language: string;
  keywords: string; version: string; owner: string; reviewNotes: string;
  /** TMFA rules (GATE-009): rationale mandatory, question_type must be known. */
  strict: boolean;
}

const FORMATS: Record<ImportFormat, FormatSpec> = {
  legacy: {
    required: [
      'Question ID', 'Stage', 'Module ID', 'Module', 'Question',
      'Option A', 'Option B', 'Option C', 'Option D', 'Correct Option',
      'Points',
    ],
    expectedRows: 256,
    code: 'Question ID', stage: 'Stage', moduleCode: 'Module ID', moduleLabel: 'Module',
    department: 'Department', learningOutcome: 'Learning Outcome', cognitive: 'Cognitive Level',
    difficulty: 'Difficulty', stem: 'Question', option: (l) => `Option ${l.toUpperCase()}`,
    correct: 'Correct Option', answerText: 'Answer Text', explanation: 'Explanation',
    points: 'Points', type: 'Question Type', status: 'Status', language: 'Language',
    keywords: 'Keywords', version: 'Version', owner: 'Owner', reviewNotes: 'Review Notes',
    strict: false,
  },
  tmfa: {
    required: [
      'question_id', 'topic_id', 'stage', 'question_type', 'stem',
      'option_a', 'option_b', 'option_c', 'option_d', 'correct_option',
      'rationale', 'points',
    ],
    expectedRows: 336,
    code: 'question_id', stage: 'stage', moduleCode: 'topic_id', moduleLabel: 'topic_title',
    department: 'course_id', learningOutcome: 'objective_id', cognitive: 'cognitive_level',
    difficulty: 'difficulty', stem: 'stem', option: (l) => `option_${l.toLowerCase()}`,
    correct: 'correct_option', answerText: 'correct_answer', explanation: 'rationale',
    points: 'points', type: 'question_type', status: 'status', language: 'language',
    keywords: 'keywords', version: 'version', owner: 'reviewer', reviewNotes: 'source_note',
    strict: true,
  },
};

const TMFA_QUESTION_TYPES = new Set(['single_select']);
// Option columns past D (option_e / Option E …) are a wrong option count.
const EXTRA_OPTION_RE = /^option[ _]?[e-z]$/i;

/** The pack is recognised by its snake_case key columns; anything else is legacy. */
export function detectFormat(headerRow: string[] | undefined): ImportFormat {
  const have = new Set((headerRow ?? []).map((h) => h.trim().toLowerCase()));
  return have.has('question_id') && have.has('topic_id') ? 'tmfa' : 'legacy';
}

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
  format: ImportFormat;
}

export function checkHeaders(headerRow: string[] | undefined): HeaderCheck {
  const format = detectFormat(headerRow);
  const required = FORMATS[format].required;
  if (!headerRow) return { ok: false, missing: [...required], format };
  const have = new Set(headerRow.map((h) => h.trim().toLowerCase()));
  const missing = required.filter((h) => !have.has(h.trim().toLowerCase()));
  return { ok: missing.length === 0, missing, format };
}

/**
 * Parse + validate a full CSV into an ImportReport.
 * `rows[0]` is treated as the header and selects the format (legacy / TMFA pack).
 * A row that cannot become a draft is rejected with a reason; a valid-but-notable
 * row is warned. Rejected rows never block the accepted ones — a partially valid
 * batch stays in staging (§7.2). Whatever a row's status column says, it can only
 * ever become a DRAFT (commitDrafts hard-codes it).
 */
export function parseAndValidate(text: string): ImportReport {
  const grid = parseCsv(text);
  const header = grid[0] ?? [];
  const idx = buildIndex(header);
  const dataRows = grid.slice(1);
  const f = FORMATS[detectFormat(header)];
  const extraOptionCols = header.filter((h) => EXTRA_OPTION_RE.test(h.trim()));

  const accepted: FilmQuestionDraft[] = [];
  const rejected: RowProblem[] = [];
  const warned: RowProblem[] = [];
  const seenCodes = new Map<string, number>(); // external_code -> first row number
  const seenStems = new Set<string>();

  dataRows.forEach((row, r) => {
    const rowNum = r + 1;
    const code = cell(row, idx, f.code);
    const problems: string[] = [];

    if (!code) problems.push(`${f.code} is blank`);

    const stage = cell(row, idx, f.stage);
    if (f.strict && !stage) problems.push(`${f.stage} is blank`);
    if (stage && !isFilmStage(stage)) problems.push(`${f.stage} "${stage}" is not L0-L5 or survey`);

    const moduleCode = cell(row, idx, f.moduleCode);
    if (f.strict && !moduleCode) problems.push(`${f.moduleCode} is blank`);
    if (moduleCode && !isFilmModuleCode(moduleCode)) {
      problems.push(`${f.moduleCode} "${moduleCode}" is not FM01-FM32, A01-A24 or C01-T1..C12-T4`);
    }

    const stem = cell(row, idx, f.stem);
    if (!stem) problems.push('Question stem is blank');

    // Exactly four distinct, non-blank options.
    const options = OPTION_IDS.map((id) => ({ id, text: cell(row, idx, f.option(id)) }));
    if (options.some((o) => !o.text)) problems.push('All four options (A-D) are required');
    if (extraOptionCols.some((h) => cell(row, idx, h))) problems.push('Exactly four options (A-D) are allowed');
    const texts = options.map((o) => normalise(o.text));
    if (new Set(texts).size !== 4) problems.push('Options must be four distinct answers');

    // Correct option in {A,B,C,D}.
    // Legacy keeps its first-letter read ("A)" → a); the pack must be exactly one letter.
    const correctCell = cell(row, idx, f.correct).toUpperCase();
    const correctId = (f.strict && correctCell.length !== 1 ? '' : correctCell.charAt(0)).toLowerCase();
    if (!OPTION_IDS.includes(correctId as (typeof OPTION_IDS)[number])) {
      problems.push(`${f.correct} must be A, B, C or D`);
    }

    // Answer Text must match the referenced choice (after normalisation).
    const answerText = cell(row, idx, f.answerText);
    if (correctId && answerText) {
      const chosen = options.find((o) => o.id === correctId);
      if (chosen && normalise(chosen.text) !== normalise(answerText)) {
        problems.push(`${f.answerText} does not match the ${f.correct}`);
      }
    }

    // Points: positive finite.
    const pointsRaw = cell(row, idx, f.points);
    const points = Number(pointsRaw);
    if (!pointsRaw || !Number.isFinite(points) || points <= 0) {
      problems.push('Points must be a positive number');
    }

    // TMFA pack (GATE-009): a rationale is mandatory and the item type must be known.
    const explanation = cell(row, idx, f.explanation);
    const type = cell(row, idx, f.type);
    if (f.strict) {
      if (!explanation) problems.push(`${f.explanation} is blank`);
      if (!TMFA_QUESTION_TYPES.has(type)) problems.push(`${f.type} "${type}" is not single_select`);
    }

    // Duplicate external_code within the file.
    if (code && seenCodes.has(code)) {
      problems.push(`Duplicate ${f.code} (also on row ${seenCodes.get(code)})`);
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
    if (!f.strict && type && !/single[-\s]?select/i.test(type)) {
      warned.push({ row: rowNum, externalCode: code, message: `Question Type "${type}" mapped as single-select` });
    }
    const status = cell(row, idx, f.status);
    if (status && !/draft/i.test(status)) {
      warned.push({ row: rowNum, externalCode: code, message: `Status "${status}" will still be imported as draft (never auto-published)` });
    } else if (/rewrite/i.test(status)) {
      warned.push({ row: rowNum, externalCode: code, message: `Status "${status}": rewrite before SME approval` });
    }

    accepted.push({
      externalCode: code,
      stage,
      department: cell(row, idx, f.department),
      moduleCode,
      moduleLabel: cell(row, idx, f.moduleLabel),
      learningOutcome: cell(row, idx, f.learningOutcome),
      cognitive: cell(row, idx, f.cognitive),
      difficulty: cell(row, idx, f.difficulty),
      stem,
      options,
      answer: { correct: [correctId], explanation: explanation || undefined },
      points: Math.max(1, Math.round(points)),
      locale: cell(row, idx, f.language) || 'en-NG',
      keywords: splitKeywords(cell(row, idx, f.keywords)),
      sourceVersion: cell(row, idx, f.version) || '1.0',
      owner: cell(row, idx, f.owner),
      reviewNotes: cell(row, idx, f.reviewNotes),
    });
  });

  // Seed-size reconciliation: warn, never block (§7.1 "initial seed expectation").
  if (dataRows.length > 0 && dataRows.length !== f.expectedRows) {
    warned.unshift({
      row: 0,
      message: `Expected the ${f.expectedRows}-row starter bank but the file has ${dataRows.length} data rows`,
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
    explanation: normalise(d.answer.explanation ?? ''),
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
