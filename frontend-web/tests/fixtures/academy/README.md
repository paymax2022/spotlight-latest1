# Film Academy assessment bank — canonical import fixture

`Timeless_Movies_Assessment_Bank_256.csv` is the **versioned source of truth** for the
Timeless Movies Film Academy starter question bank. The PRD lists it as a source
artifact and expects the import pipeline to read it, so it lives in-repo rather than
on one machine's Downloads folder.

- 256 rows = 32 modules (`FM01`–`FM32`) × 8 questions (two each for stages L1–L4).
- It is the input to the admin **Import** flow (`/api/admin/academy/questions/*`) and
  to `tests/unit/academy/assessment.test.ts`, which asserts every row parses clean.

## ⚠️ This file is the answer key — internal only

Its columns `Correct Option`, `Answer Text` and `Explanation` reveal which option is
right and why. Per the PRD these questions are **`DRAFT — SME review`**, not
production-approved.

Hard rules:

1. **Never serve this file, or any of its answer/explanation columns, to a learner.**
   Learner exam payloads carry opaque `presentationOptionId`s and the learner's own
   picks only. The answer key lives in `academy_question_items.answer` and stops there.
2. **Do not auto-publish on import.** Import inserts as `draft`; a question only
   becomes exam-eligible after an SME approves it (`scores:manage`).
3. Keep any future updates to the bank as a deliberate, reviewed change — the import
   is idempotent on `external_code`, so re-importing unchanged content is a no-op.
