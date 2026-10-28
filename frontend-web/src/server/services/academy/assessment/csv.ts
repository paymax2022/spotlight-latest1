// CSV parsing + row-by-row validation for the film assessment bank import.
//
// Pure — no Supabase, no HTTP. This is the authority for whether a row may become
// a DRAFT item, and it is what the PRD's import-validation checklist (§7.2) and QA
// rows (QA-01) test.
//
// Two bank dialects share one report: the legacy Title Case 256-row starter bank and
// the TMFA curriculum pack (snake_case, 336 rows, rationale required). The dialect
// is read off the header row, so an admin uploads one file type without a mode switch.
// Neither count is a hard failure: the expected size is the SEED expectation, while
// admins later import corrections and SME-approved additions. A mismatch is a warning
// so the preview stays honest about an unexpected size without blocking work.

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

const LEGACY_REQUIRED_HEADERS = [
  'Question ID', 'Stage', 'Module ID', 'Module', 'Question',
  'Option A', 'Option B', 'Option C', 'Option D', 'Correct Option',
  'Points',
] as const;

// The TMFA curriculum pack ships snake_case headers and one extra authority: every
// question must carry a rationale, because GATE-009 forbids an unexplained key.
const TMFA_REQUIRED_HEADERS = [
  'question_id', 'topic_id', 'stage', 'stem',
  'option_a', 'option_b', 'option_c', 'option_d',
  'correct_option', 'correct_answer', 'rationale', 'points',
] as const;

/** Which bank vocabulary a header row uses, decided by its column names alone. */
export function detectFormat(headerRow: string[] | undefined): BankFormat {
  if (!headerRow) return 'legacy';
  const have = new Set(headerRow.map((h) => h.trim().toLowerCase()));
  return have.has('question_id') ? 'tmfa' : 'legacy';
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

export type BankFormat = 'tmfa' | 'legacy';

export interface HeaderCheck {
  ok: boolean;
  missing: string[];
  format: BankFormat;
}

export function checkHeaders(headerRow: string[] | undefined): HeaderCheck {
  const format = detectFormat(headerRow);
  const required = format === 'tmfa' ? TMFA_REQUIRED_HEADERS : LEGACY_REQUIRED_HEADERS;
  if (!headerRow) return { ok: false, missing: [...required], format };
  const have = new Set(headerRow.map((h) => h.trim().toLowerCase()));
  const missing = required.filter((h) => !have.has(h.trim().toLowerCase()));
  return { ok: missing.length === 0, missing, format };
}

/**
 * Parse + validate a full CSV into an ImportReport, auto-selecting the bank format.
 * `rows[0]` is treated as the header. A row that cannot become a draft is rejected
 * with a reason; a valid-but-notable row is warned. Rejected rows never block the
 * accepted ones — a partially valid batch stays in staging (§7.2).
 */
export function parseAndValidate(text: string): ImportReport {
  const grid = parseCsv(text);
  const header = grid[0] ?? [];
  return detectFormat(header) === 'tmfa' ? validateTmfa(grid) : validateLegacy(grid);
}

function validateTmfa(grid: string[][]): ImportReport {
  const header = grid[0] ?? [];
  const idx = buildIndex(header);
  const dataRows = grid.slice(1);

  // option_e would silently drop a fifth answer from the learner-facing four.
  const optionColumns = header.filter((h) => /^option_[a-z]$/i.test(h.trim())).length;

  const accepted: FilmQuestionDraft[] = [];
  const rejected: RowProblem[] = [];
  const warned: RowProblem[] = [];
  const seenCodes = new Map<string, number>();
  const seenStems = new Set<string>();

  dataRows.forEach((row, r) => {
    const rowNum = r + 1;
    const code = cell(row, idx, 'question_id');
    const problems: string[] = [];

    if (!code) problems.push('question_id is blank');
    if (optionColumns !== 4) problems.push('Exactly four options are supported (option_a-option_d)');

    const stage = cell(row, idx, 'stage');
    if (stage && !isFilmStage(stage)) problems.push(`stage "${stage}" is not L0-L5 or survey`);

    const topic = cell(row, idx, 'topic_id');
    if (topic && !isFilmModuleCode(topic)) {
      problems.push(`topic_id "${topic}" is not an A01-A24 or C01-C12 topic`);
    }

    const stem = cell(row, idx, 'stem');
    if (!stem) problems.push('Question stem is blank');

    const options = OPTION_IDS.map((id) => ({ id, text: cell(row, idx, `option_${id}`) }));
    if (options.some((o) => !o.text)) problems.push('All four options (A-D) are required');
    const texts = options.map((o) => normalise(o.text));
    if (new Set(texts).size !== 4) problems.push('Options must be four distinct answers');

    const rationale = cell(row, idx, 'rationale');
    if (!rationale) problems.push('rationale is blank — every pack question needs its explanation');

    const type = cell(row, idx, 'question_type');
    if (type && !/^single[-_\s]?select$/i.test(type)) {
      problems.push(`question_type "${type}" is not single_select`);
    }

    // The key must name exactly one option; 'AB' and 'E' are both authoring errors.
    const correctRaw = cell(row, idx, 'correct_option').toUpperCase();
    const correctId = correctRaw.length === 1 ? correctRaw.toLowerCase() : '';
    if (!OPTION_IDS.includes(correctId as (typeof OPTION_IDS)[number])) {
      problems.push('correct_option must be A, B, C or D');
    }

    const correctAnswer = cell(row, idx, 'correct_answer');
    if (correctId && correctAnswer) {
      const chosen = options.find((o) => o.id === correctId);
      if (chosen && normalise(chosen.text) !== normalise(correctAnswer)) {
        problems.push('correct_answer does not match the keyed option');
      }
    }

    const pointsRaw = cell(row, idx, 'points');
    const points = Number(pointsRaw);
    if (!pointsRaw || !Number.isFinite(points) || points <= 0) {
      problems.push('Points must be a positive number');
    }

    if (code && seenCodes.has(code)) {
      problems.push(`Duplicate question_id (also on row ${seenCodes.get(code)})`);
    }

    if (problems.length > 0) {
      rejected.push({ row: rowNum, externalCode: code || undefined, message: problems.join('; ') });
      return;
    }

    if (code) seenCodes.set(code, rowNum);

    if (stem && seenStems.has(normalise(stem))) {
      warned.push({ row: rowNum, externalCode: code, message: 'Identical question text appears more than once' });
    } else if (stem) {
      seenStems.add(normalise(stem));
    }
    if (stem && stem.length > 600) {
      warned.push({ row: rowNum, externalCode: code, message: 'Unusually long question text' });
    }

    const status = cell(row, idx, 'status');
    if (/rewrite/i.test(status)) {
      warned.push({ row: rowNum, externalCode: code, message: 'Pack marks this question for rewrite; it stays a draft until an SME re-approves it' });
    } else if (status && !/draft/i.test(status)) {
      warned.push({ row: rowNum, externalCode: code, message: `Status "${status}" will still be imported as draft (never auto-published)` });
    }

    accepted.push({
      externalCode: code,
      stage,
      department: cell(row, idx, 'course_id'),
      moduleCode: topic,
      moduleLabel: cell(row, idx, 'topic_name'),
      learningOutcome: cell(row, idx, 'objective_id'),
      cognitive: cell(row, idx, 'cognitive_level'),
      difficulty: cell(row, idx, 'difficulty'),
      stem,
      options,
      answer: { correct: [correctId], explanation: rationale },
      points: Math.max(1, Math.round(points)),
      locale: cell(row, idx, 'language') || 'en-NG',
      keywords: splitKeywords(cell(row, idx, 'keywords')),
      sourceVersion: cell(row, idx, 'version') || '1.0',
      owner: cell(row, idx, 'reviewer'),
      reviewNotes: cell(row, idx, 'source_note'),
    });
  });

  if (dataRows.length > 0 && dataRows.length !== 336) {
    warned.unshift({
      row: 0,
      message: `Expected the 336-row starter bank but the file has ${dataRows.length} data rows`,
    });
  }

  return { totalRows: dataRows.length, accepted, rejected, warned };
}

function validateLegacy(grid: string[][]): ImportReport {
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
    // The explanation is part of the authored content: an SME rationale fix must
    // re-import as a change, not read as an identical row.
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
