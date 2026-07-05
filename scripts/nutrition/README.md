# Nutrition Resolution Engine — composition ingestion

This directory documents how the **full FAO/INFOODS food-composition import** is run
for the Nutrition Resolution Engine (NRE). It turns an official food-composition
table CSV (WAFCT 2019, NFCT 2017, etc.) into **idempotent, versioned**
`composition_reference` SQL INSERTs.

The DB migration (`supabase/migrations/20260817000000_nutrition_engine_core.sql`)
ships only a small **representative seed** (~11 composition rows, 8 dish-library
entries) so the engine runs end-to-end. The real corpus is a **data task** run
with the official CSVs via `ingest_composition.py` — this README is the runbook.

## Why a scaffold (not the data)

The official tables are licensed/large and are NOT checked into the repo. This
scaffold ships:

- `sample_wafct.csv` — a tiny example file showing the **expected column shape**.
- `ingest_composition.py` — the transformer (pure stdlib; no deps).

Point the transformer at the real CSV once you have it.

## Expected CSV columns

The transformer reads a header row and maps these columns (case-insensitive,
extra columns ignored). Per-100g-edible-portion values.

| Column         | Required | Meaning                                              |
|----------------|----------|------------------------------------------------------|
| `food_code`    | yes      | Stable source code (e.g. `WAFCT-0042`)               |
| `name`         | yes      | Food/dish name                                       |
| `source`       | yes      | One of `WAFCT`,`NFCT`,`OFF`,`FALLBACK`,`CUSTOM`      |
| `prep_method`  | no       | `raw`(default)/`boiled`/`grilled`/`stewed`/`fried`/`baked`/`roasted` |
| `energy_kcal`  | no       | kcal per 100 g                                        |
| `protein_g`    | no       | g per 100 g                                           |
| `carb_g`       | no       | g per 100 g                                           |
| `sugar_g`      | no       | g per 100 g                                           |
| `fat_g`        | no       | g per 100 g                                           |
| `sat_fat_g`    | no       | g per 100 g                                           |
| `fiber_g`      | no       | g per 100 g                                           |
| `sodium_mg`    | no       | mg per 100 g                                          |

Missing numeric cells are emitted as `NULL`.

## Versioning + idempotency

- Every emitted row is tagged with `--version N` (default `1`).
- INSERTs use `ON CONFLICT (food_code, source, prep_method, version) DO NOTHING`,
  matching the table's UNIQUE constraint — so **re-running the same import is a
  no-op**, and a corrected import is shipped as a **new `--version`** (additive;
  the resolver always pins the highest version, never mutating prior rows).

This honours the iron rule: migrations/data are additive-only — no in-place edits
to reference rows.

## Usage

```bash
# Emit SQL to stdout from the sample file (version 1):
python3 ingest_composition.py sample_wafct.csv > seed_wafct_v1.sql

# Real import, bumping the version (e.g. a 2024 correction pass):
python3 ingest_composition.py /path/to/WAFCT_2019.csv --version 2 > wafct_v2.sql

# Apply via psql / supabase:
psql "$DATABASE_URL" -f seed_wafct_v1.sql
# or: supabase db execute --file seed_wafct_v1.sql
```

## Safety note

This scaffold ingests **nutrition reference data only**. It never writes allergen
declarations — those are SAFETY-CRITICAL and are vendor-attested at runtime
through the NRE API (an AI/import path may only ever suggest `MAY_CONTAIN`, never
`CONTAINS`/`FREE_FROM`, enforced by DB CHECK constraints + app code).
