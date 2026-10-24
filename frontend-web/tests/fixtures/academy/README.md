# Film Academy assessment bank — NOT stored in this repository

`Timeless_Movies_Assessment_Bank_256.csv` (the Timeless Movies Film Academy starter
question bank: 32 modules × 8 questions) is the **answer key**. Its `Correct Option`,
`Answer Text` and `Explanation` columns reveal which option is right and why.

**It must never be committed here.** This repository is public. Keep the bank in private
storage and pass it to the importer or the test at run time:

```bash
FILM_BANK_CSV=/path/to/Timeless_Movies_Assessment_Bank_256.csv npx vitest run tests/unit/academy
```

Without `FILM_BANK_CSV`, the real-data case in `tests/unit/academy/assessment.test.ts`
is skipped. The parser, scoring and validation cases still run on synthetic rows.

Hard rules for the bank:

1. Never serve the file, or any answer/explanation column, to a learner. Learner exam
   payloads carry opaque `presentationOptionId`s and the learner's own picks only.
2. Import never auto-publishes. Rows land as `draft`, and a question becomes
   exam-eligible only after an SME approves it.
