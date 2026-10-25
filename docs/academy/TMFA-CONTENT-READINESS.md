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
| Lesson length | **442–756 characters** (median in the low hundreds) |
| Topic content status in pack | 24 `DRAFT — FACULTY REVIEW`; 48 `TOPIC BRIEF — EXPANSION REQUIRED` |
| Stage labels | ACT stages L1–L4/survey; craft topics L1–L4 survey/specialization |

The import normalises every article to `content_status = 'draft'` and every topic
to unpublished. Nothing in the pack is treated as approved.

### Why the article gate alone is not a quality gate

The server rejects articles shorter than 200 characters. Every supplied article
is between 442 and 756 characters — so the *mechanical* check passes, while the
text is explicitly a brief awaiting expansion. Publication therefore depends on
faculty review rejecting insufficient articles, not on the length check. The
console shows the article in full before approval; reviewers must treat
"expansion required" as unpublishable regardless of character count.

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
| Approved questions ≥20 | 0 / 72 |
| Mandatory media published + rights + accessibility + file | 0 / 72 |
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

1. Expand the article to teachable depth and approve it (`scores:manage`).
2. Bring its question pool to ≥20 approved items (ACT currently has 10; craft has 2).
3. Produce every mandatory asset, set each to `PUBLISHED`, record rights
   `CLEARED`, accessibility `PASSED`, and provide a real file URL for the four
   file-required types — or sign a genuine accessible-equivalent waiver.
4. Publish the topic.

For the full programme: 72 articles, **≥1,440 approved questions**, **864 produced
and cleared assets**, then 72 topic publications and 72 learner masteries plus
practical holds cleared before one certificate can issue.

---

## 6. Content decisions needed from the academy

- **Question bank expansion strategy** — the pack is a starter bank, not an exam
  bank. Decide whether SMEs author ~1,104 more items or the 20-item gate is
  changed by product decision (the gate is currently fixed in code and policy).
- **Media production plan** — 864 assets is a production programme, not an import.
  Decide which topics launch first and whether a text-equivalent waiver is
  academically acceptable for the initial cohort.
- **Article depth standard** — set a reviewer checklist beyond the 200-character
  floor; the current drafts are briefs.
- **Craft pathway** — the 48 C01–C12 topics are explicitly "expansion required";
  do not publish them as-is.

No content was fabricated, generated or auto-approved during implementation.
