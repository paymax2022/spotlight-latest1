# Task 6 report
Fail first: `npm run test:film-academy` -> 7 pass (youtube) / 1 fail (optionPricing.spec.ts: module not found).
After implementation: 13 tests, 13 pass, 0 fail.
tsc (`npx tsc --noEmit -p .`): no errors in filmAcademy files, apply.tsx, status.tsx, index.tsx.
Added npm script test:film-academy (package.json). types.ts: FilmAcademyAreaOption, FilmAcademySelection, area.options, input.selections?, areas_of_interest made optional. api.ts getOverview defaults options [] and Number() coercion; applyToBatch passes input through so selections are sent.
