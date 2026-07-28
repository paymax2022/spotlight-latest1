# Curriculum (Versioned)

**Curriculum is data, never code.** Subject/trade/stream lists change with policy; model them as
versioned records so a rollout is a data edit, not a deploy.

## Versions
- `NERDC-2025` — new national curriculum, effective Sept 2025; rolls out at **entry classes only**
  (P1, P4, JSS1, SS1) on three-year cycles.
- `LEGACY` — prior curriculum; maintained for classes still mid-cycle (P2–3, P5–6, JSS2–3, SS2–3).
- A learner is bound to a version by **class + entry year** (auto-detected at onboarding, A9).

## Structure
```
CurriculumVersion
 └─ Phase (ECCE | LowerPrimary P1–3 | UpperPrimary P4–6 | JSS 1–3 | SSS 1–3)
     └─ Class
         └─ Subject (core | elective | optional)   ── tagged exam-relevance
             └─ Topic
                 └─ LearningObjective  ←─ Lessons & QuestionItems attach here
```

## NERDC-2025 notes (verify against official NERDC docs before content lock)
- **Lower Primary (P1–3):** ~9–10 subjects (English, Maths, one Nigerian Language, Basic Science,
  PHE, CRS/IS, Nigerian History, Social & Citizenship Studies; Arabic optional).
- **Upper Primary (P4–6):** ~11–13 (adds Basic Science & Technology, Basic Digital Literacy, CCA,
  Pre-vocational; French optional). → **Common Entrance**.
- **JSS (1–3):** ~12–14 (adds Intermediate Science, Digital Technologies, Business Studies, and
  **one mandatory Trade subject**). → **BECE**.
- **SSS (1–3):** 5 cores (incl. English, Maths, Civic) + **Stream** (Science / Humanities /
  Commercial); **trade subject continues as core**. → **WASSCE/NECO** + **UTME**.

## Trade tracks (JSS→SSS, carried through)
`solar_pv` · `fashion_garment` · `livestock` · `beauty_cosmetology` · `computer_gsm_repair` ·
`horticulture` (extendable). Each maps to an `EarningOpportunity` set — see `gamification-rewards.md`
and `state-machines.md#6`. This mapping is the learn-to-earn moat.

## Rules
- Never hardcode the above; load from `CurriculumVersion`.
- Exam relevance is a **tag on Topic/Objective**, enabling the same content to power both the
  school spine and the exam arenas without duplication.
- Stream/trade changes by a learner are guarded edits (Z2) that re-scope their subject set.
