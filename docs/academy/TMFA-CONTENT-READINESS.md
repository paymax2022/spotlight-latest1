# TMFA Curriculum Pack — Content Readiness Report

Date: 2026-10-25 · Source of truth:
`frontend-web/src/server/services/academy/topics/data/{curriculum,media-manifest,question-bank,a04-lesson}.json`

**Bottom line: the software is ready; the curriculum is not.** On a fresh import,
all 72 topics are drafts, none has a produced teaching asset, and none can reach
the 20-approved-question threshold with the supplied bank. A learner can see the
path, but no topic can be published and no certificate can be earned.

Everything below is counted directly from the bundled JSON, not estimated.

---

## 1. Curriculum inventory

| Metric | Value |
|---|---|
| Schema / product | `1.0` / "Timeless Movies Film Academy" |
| Declared pack pass mark | 85% |
| Question-bank status | `DRAFT — NOT LIVE` |
| Courses | **13** (ACT + C01–C12) |
| Topics | **72** (ACT 24; C01–C12 4 each) |
| Topic IDs | Stable (`A01`–`A24`, `C01-T1` … `C12-T4`) |
| Lesson length | **442–756 characters / 53–106 words** (median 57 words) |
| Topic content status in pack | 24 `DRAFT — FACULTY REVIEW`; 48 `TOPIC BRIEF — EXPANSION REQUIRED` |
| Stage labels | ACT stages L1–L4/survey; craft topics L1–L4 survey/specialization |

The import normalises every article to `content_status = 'draft'` and every topic
to unpublished. Nothing in the pack is treated as approved.

### The article depth standard is now enforced

The server still rejects articles shorter than 200 characters, but a length
check alone is not a quality gate. Submission, approval and publication now also
require `evaluateArticleDepth` to pass:

- at least **1,000 words** of teaching text;
- at least **4 section headings** (`##`–`####`);
- a **practical exercise / application** heading;
- a **self-check / assessment** heading.

The model A04 lesson is 1,599 words with ten sections, a practical assignment and
a self-check, so it clears the floor comfortably. Every supplied article is
53–106 words (442–756 characters), so **0 / 72 meet the depth standard**. The
check is implemented in
`frontend-web/src/server/services/academy/topics/types.ts` and is re-evaluated
server-side on every submit, approve and publish. It is a mechanical floor, not
faculty approval: faculty must still expand, review and approve each article.

### Practical assessments are content too

The practical workflow (brief, rubric, pass mark, attempt cap, grading) is
software. The bundled pack contains **0 practical assessment definitions**: 0 / 72
topics have an authored brief or rubric. The gate is per-topic and opt-in, so until
the academy authors and opens an assessment, a quiz pass can still reach
`MASTERED` for that topic. Authoring is a faculty/academic decision, not an import
output, and nothing was generated during implementation.

---

## 2. Question bank coverage

| Metric | Value |
|---|---|
| Total questions | **336** (all `single_select`) |
| Statuses | 240 `DRAFT — SME REVIEW`; 96 `DRAFT — REWRITE BEFORE USE` |
| Approved | **0** |
| Topics covered | 72 / 72 |
| Per-topic count | min **2**, max **10**, average **4.67** |
| Topics with ≥20 approved items | **0 / 72** |
| Approved items needed at 20/topic | **1,440** minimum |
| Additional items required | **at least 1,104** beyond the entire supplied bank |

Distribution:

- **ACT (24 acting topics):** 10 questions each = 240 items. Still **half** the
  required 20.
- **C01–C12 (48 craft topics):** 2 questions each = 96 items. **18 short** per topic.

A question cannot be approved automatically; import sets draft and `scores:manage`
must review each item. Even if every one of the 336 items were approved, no topic
would be publishable.

### The authoring path now binds questions to topics

The original bank importer is module-coded and does not write `film_topic_id`, so
rows imported through it could never be drawn by a topic quiz. The new
**Question pool** workflow closes that software gap:

- CSV columns: `Question ID, Topic ID, Objective ID, Question, Option A–D,
  Correct Option, Correct Answer, Rationale, Points, Difficulty, Cognitive Level,
  Version`. Objective is optional; when supplied it must be declared on the topic.
- Every accepted row is written as **draft**, bound to `film_topic_id` (and
  `film_objective_id` when supplied). Import never approves, publishes or changes
  status.
- Approved/review/retired items, module-coded items and items already bound to a
  different topic are **locked** and reported, never overwritten.
- Preview is read-only and shows per-topic `approved / required` and the pool
  after import; commit records an import batch and an academic audit event.
- A **Download readiness CSV** button on the publication gates exports one row per
  topic with article depth, draft/review/approved counts, required count,
  shortfall, media state, waiver, readiness and blocker codes — the work queue for
  faculty, SMEs, production and rights.

This is software, not content. The target remains **1,440 approved items**: at
least 1,104 new items authored and approved, plus SME review of the 336 supplied
drafts. No item was generated or approved during implementation.

---

## 3. Media production queue

| Metric | Value |
|---|---|
| Planned media records | **864** (12 per topic) |
| Marked `required` | 864 |
| Produced file URLs | **0** |
| Status | 24 `TEXT DRAFT EXISTS`; 840 `TO PRODUCE` |
| Rights | 864 `NOT REVIEWED` |
| Accessibility | 864 `NOT REVIEWED` |

Media types per topic (8 types, 12 records because comparison/photo counts vary):

| Type | Records | File URL required by gate? |
|---|---|---|
| `teaching_video` | 72 | yes |
| `comparison_clip` | 144 | yes |
| `narration_audio` | 72 | yes |
| `photo_or_diagram` | 288 | yes |
| `article` | 72 | no (text asset) |
| `caption_track` | 72 | no |
| `transcript` | 72 | no |
| `practice_rubric` | 72 | no |

Gate consequence: every topic is blocked by `MANDATORY_MEDIA_NOT_READY` and
`MEDIA_FILE_MISSING` unless an authorised accessible-equivalent waiver is signed
with a rationale. The waiver is a deliberate academic escape hatch, not a
production substitute — using it across the whole curriculum would mean shipping
a video-led film programme with no video.

---

## 4. Topic publication status on a fresh import

| Gate | Result |
|---|---|
| Article approved | 0 / 72 |
| Article meets depth standard | **0 / 72** |
| Approved questions ≥20 | 0 / 72 |
| Mandatory media published + rights + accessibility + file | 0 / 72 |
| Practical assessment authored and active | **0 / 72** |
| Topic published | **0 / 72** |
| Mastered topics | 0 |
| Open holds | 0 |
| Certificates issuable | **0** |

Every topic starts `draft`, `published = false`, with blockers. There is no path
from import to a passing learner without faculty, SME and media work outside this
software.

---

## 5. Minimum work to make the first topic publishable

For a single topic:

1. Expand the article to meet the enforced depth standard (≥1,000 words, ≥4
   headings, practical/application and self-check sections) and approve it
   (`scores:manage`).
2. Bring its question pool to ≥20 approved items (ACT currently has 10; craft has 2):
   download the readiness CSV for the exact gap, author rows against that topic in
   the **Question pool** tab, import as drafts, then SME-review and approve them.
3. Produce every mandatory asset, set each to `PUBLISHED`, record rights
   `CLEARED`, accessibility `PASSED`, and provide a real file URL for the four
   file-required types — or sign a genuine accessible-equivalent waiver.
4. Publish the topic.

Downloading the readiness CSV before and after each step shows exactly which
gate is still blocking, from the same server-evaluated data the publish action
uses. It is a report, not a re-import format.

Publication does not require a practical assessment, but mastery can depend on
one. If this topic requires practical work, author the assessment in the
**Practical assessments** tab, keep it inactive until the brief and rubric are
reviewed, then open it. Opening backfills `PRACTICAL_PENDING` holds for learners
who already passed the quiz; grade submitted work against the frozen rubric.

For the full programme: 72 articles, **≥1,440 approved questions**, **864 produced
and cleared assets**, **72 authored practical assessments where practical work is
required**, then 72 topic publications and 72 learner masteries plus practical
holds cleared before one certificate can issue.

---

## 6. Content decisions needed from the academy

- **Question bank expansion strategy** — the pack is a starter bank, not an exam
  bank. The topic-targeted import path is now ready, so this is purely a content
  decision: SMEs author ~1,104 more items and review the 336 drafts, or the
  20-item gate is changed by product decision (the gate is currently fixed in
  code and policy).
- **Media production plan** — 864 assets is a production programme, not an import.
  Decide which topics launch first and whether a text-equivalent waiver is
  academically acceptable for the initial cohort.
- **Article depth standard** — now enforced in code at ≥1,000 words, ≥4 section
  headings, a practical/application heading and a self-check/assessment heading.
  The academy should ratify this floor or raise it before launch; the 200-character
  check alone no longer permits approval or publication.
- **Craft pathway** — the 48 C01–C12 topics are explicitly "expansion required";
  do not publish them as-is.

No content was fabricated, generated or auto-approved during implementation.
