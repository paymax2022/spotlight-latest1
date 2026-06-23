# Visitor Module — Screen & Flow Map

13 screens across two role flows. Each screen's states are noted as **L**oading / **E**mpty / **R**error / **S**uccess.

## Entry points
`src/constants/modules.ts` → "Visitors" tile → `/visitor`; "Gate (Guard)" tile → `/guard`.

---

## A. Resident flow (Section E) — `app/visitor/*`

```
/visitor  (dashboard)
  ├─ RestrictionBanner (only if not in good standing) ─► /visitor/restricted
  ├─ Quick actions / CTA ─► /visitor/create        (blocked → /visitor/restricted if hard-banned)
  ├─ "See all" active ────► /visitor/active
  └─ "See all" activity ──► /visitor/history

/visitor/create  ──(generate)──►  /visitor/code/[id]
   (hard-ban guard: redirects to /visitor/restricted)

/visitor/code/[id]
   ├─ Share via WhatsApp / SMS / Email (Linking)
   ├─ Copy numeric code
   ├─ Revoke ──► (stays, status flips to revoked)
   └─ (if inactive) "Create a new code" ──► /visitor/create

/visitor/active   segmented: Active | Expired | Revoked ──► tap ──► /visitor/code/[id]
/visitor/history  full gate activity (read-only)
/visitor/restricted  Pay to restore → restoration_pending → access_restored → /visitor
```

| Screen | Route | States |
|---|---|---|
| Visitor dashboard | `/visitor` | L,E,R,S (codes list); restriction + activity conditional |
| Create access code | `/visitor/create` | S; inline validation error; submit loading; redirect on hard-ban |
| Code detail (QR + numeric + share) | `/visitor/code/[id]` | L,R,S; inactive-code variant (QR disabled) |
| Active / Expired / Revoked codes | `/visitor/active` | L,E,R,S (per filter) |
| Visitor history | `/visitor/history` | L,E,R,S |
| Payment restriction | `/visitor/restricted` | L,R,S; renders by restriction state (soft/hard/pending/restored) |

**Key journey (PRD §7.1):** dashboard → create → pick type + details + validity → generate → code screen → share via WhatsApp → appears under Active. **Restricted journey (§7.5):** create tap → restriction screen → pay → restoration pending → restored.

---

## B. Guard flow (Section F) — `app/guard/*`

```
/guard  (dashboard: gate session, expected count, pending-sync badge, panic)
  ├─ Scan CTA ─────► /guard/scan
  ├─ Expected tile ► /guard/expected ──► tap ──► /guard/confirm/[code]
  ├─ Gate log tile ► /guard/log
  └─ Sync pending logs (header button)

/guard/scan
  ├─ Simulate scan chips (valid / delivery / expired / used / revoked / blacklisted / unknown)
  └─ Manual code entry ──► /guard/confirm/[code]

/guard/confirm/[code]   (state machine)
  ├─ looking (L)
  ├─ failure → expired / used / revoked / not_found  (R + "look up another")
  ├─ blacklisted → security alert ──► Deny & escalate ──► denied
  ├─ ok → details + capture(photo/ID/plate) ──► Approve ──► approved
  │                                          └─► Deny (reason required) ──► denied
  ├─ approved (S) ──► Done /guard  |  Scan next /guard/scan
  └─ denied   (S) ──► Done /guard
```

| Screen | Route | States |
|---|---|---|
| Guard dashboard | `/guard` | L,R,S; pending-sync badge; panic |
| Scan / manual entry | `/guard/scan` | S (input); demo + manual |
| Visitor confirmation | `/guard/confirm/[code]` | L, R (session + 4 failure kinds), blacklist alert, S (approved/denied) |
| Expected visitors | `/guard/expected` | L,E,R,S |
| Gate activity log | `/guard/log` | L,E,R,S + pending-sync banner/sync |

**Key journey (PRD §7.2):** scan → details confirmation → optional capture → approve → check-in success → resident notified + log entry. **Offline (§7.3):** mock events carry `syncStatus:'pending'`; the gate log + dashboard surface the pending count and a Sync action.

---

## Cross-cutting states
- **Loading / Empty / Error** are rendered by the shared `StateView` everywhere.
- **Success** screens: code generated (code detail), entry approved/denied (guard confirm), access restored (restricted).
- **Restriction gating** (PRD §10) is read on dashboard load and at code-creation time, fail-closed.
