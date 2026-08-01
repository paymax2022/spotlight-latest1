#!/usr/bin/env bash
# Read-only classifier for pending Supabase migrations vs a remote DB.
# Picks ONE primary "sentinel" object per migration (table > column > index >
# type), batch-probes the remote for existence, and buckets each migration:
#   APPLIED   sentinel exists on remote  -> repair --status applied (skip DDL)
#   MISSING   sentinel absent on remote  -> genuinely needs applying
#   REVIEW    no reliable sentinel        -> inspect by hand
# Usage: classify.sh <DBURL> <migrations_dir>
# NB: no `-e` — grep sentinel-extraction returns 1 on no-match, which as a
# standalone `x=$(grep …)` assignment would abort under set -e.
set -uo pipefail
DBURL="$1"; MIG="$2"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

# 1) pending = local file with no remote history row
supabase migration list --db-url "$DBURL" 2>/dev/null \
  | awk -F'|' '$1 ~ /[0-9]{14}/ && $2 !~ /[0-9]/ {gsub(/ /,"",$1); print $1}' > "$work/pending.txt"

# 2) per migration, extract primary sentinel  ->  version<TAB>kind<TAB>key
: > "$work/sent.tsv"
while IFS= read -r v; do
  f=$(ls "$MIG"/${v}_*.sql 2>/dev/null | head -1); [ -z "$f" ] && continue
  # Normalise the whole file to one lowercase, space-squeezed line so multi-line
  # DDL (CREATE TABLE … \n … name) is matchable. Then extract first sentinel.
  # Normalise to one lowercase line AND strip the ambiguous guard keywords
  # ("if not exists"/"if exists"/"concurrently") so the identifier sits directly
  # after the DDL verb — sidesteps BSD grep's non-POSIX optional-group matching.
  blob=$(sed -E 's/--.*$//' "$f" | tr '\n' ' ' | tr 'A-Z' 'a-z' | tr -s ' \t' ' ' \
        | sed -E 's/ if not exists / /g; s/ if exists / /g; s/ concurrently / /g')
  ex1(){ grep -oE "$1" <<<"$blob" | head -1; }
  tbl=$(ex1 'create table (public\.)?[a-z0-9_]+' | sed -E 's/create table (public\.)?//')
  if [ -n "$tbl" ]; then printf '%s\ttable\t%s\n' "$v" "$tbl" >> "$work/sent.tsv"; continue; fi
  col=$(ex1 'add column [a-z0-9_]+' | sed -E 's/add column //')
  ctb=$(ex1 'alter table (only )?(public\.)?[a-z0-9_]+' | sed -E 's/alter table (only )?(public\.)?//')
  if [ -n "$col" ] && [ -n "$ctb" ]; then printf '%s\tcolumn\t%s.%s\n' "$v" "$ctb" "$col" >> "$work/sent.tsv"; continue; fi
  idx=$(ex1 'create (unique )?index [a-z0-9_]+' | sed -E 's/create (unique )?index //')
  if [ -n "$idx" ]; then printf '%s\tindex\t%s\n' "$v" "$idx" >> "$work/sent.tsv"; continue; fi
  typ=$(ex1 'create type (public\.)?[a-z0-9_]+' | sed -E 's/create type (public\.)?//')
  if [ -n "$typ" ]; then printf '%s\ttype\t%s\n' "$v" "$typ" >> "$work/sent.tsv"; continue; fi
  printf '%s\treview\t-\n' "$v" >> "$work/sent.tsv"
done < "$work/pending.txt"

arr(){ awk -F'\t' -v k="$1" '$2==k{print $3}' "$work/sent.tsv" | sort -u | sed "s/'/''/g" | paste -sd, - | sed "s/[^,]*/'&'/g"; }

TB=$(arr table); CO=$(arr column); IX=$(arr index); TY=$(arr type)
: > "$work/exists_table.txt"; : > "$work/exists_column.txt"; : > "$work/exists_index.txt"; : > "$work/exists_type.txt"
[ -n "$TB" ] && psql "$DBURL" -tAc "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and relname in ($TB);" > "$work/exists_table.txt" 2>/dev/null || true
[ -n "$CO" ] && psql "$DBURL" -tAc "select table_name||'.'||column_name from information_schema.columns where table_schema='public' and (table_name||'.'||column_name) in ($CO);" > "$work/exists_column.txt" 2>/dev/null || true
[ -n "$IX" ] && psql "$DBURL" -tAc "select indexname from pg_indexes where schemaname='public' and indexname in ($IX);" > "$work/exists_index.txt" 2>/dev/null || true
[ -n "$TY" ] && psql "$DBURL" -tAc "select typname from pg_type where typname in ($TY);" > "$work/exists_type.txt" 2>/dev/null || true

# 3) join -> bucket (bare-key membership per kind — no tab hacks)
echo -e "version\tbucket\tkind\tsentinel"
while IFS=$'\t' read -r v k key; do
  if [ "$k" = "review" ]; then echo -e "$v\tREVIEW\t$k\t$key"; continue; fi
  if grep -qxF "$key" "$work/exists_$k.txt" 2>/dev/null; then echo -e "$v\tAPPLIED\t$k\t$key";
  else echo -e "$v\tMISSING\t$k\t$key"; fi
done < "$work/sent.tsv"
