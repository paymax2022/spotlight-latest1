package savings

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/scheduler"
)

// Auditor is the immutable-audit slice the savings module needs (NL-12). nil-safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// AutoSaveJobType is the scheduler handler key for recurring vault auto-save.
const AutoSaveJobType = "savings.autosave"

// VaultService owns the Vault sub-balance. The dedicated sub-balance is an
// append-only ledger (savings_vault_ledger): balance is the SUM of its entries
// (NL-8). Deposits move real money out of the user's main wallet (finance
// ledger) into the shared escrow standing account, then credit the vault ledger;
// withdrawals reverse. NL-1: a withdrawal can never exceed the derived balance;
// NL-2: no yield is ever credited.
type VaultService struct {
	db         *pgxpool.Pool
	led        *ledger.Service
	sched      *scheduler.Service
	audit      Auditor
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
}

func NewVaultService(db *pgxpool.Pool, led *ledger.Service, sched *scheduler.Service, audit Auditor) *VaultService {
	return &VaultService{db: db, led: led, sched: sched, audit: audit}
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module. app-wiring injects a thin adapter over the finance commission service;
// when the commission feature is off (or no recorder is wired) the field is nil and
// recording is a silent no-op. Modeled as a LOCAL interface so savings never imports
// the commission package at compile time (mirrors transport/service.go).
//
// This records realized profit ONLY; it never moves money. The savings module's own
// money movements (the early-break penalty debit into paymax_revenue) are unchanged,
// and the injected recorder is deliberately constructed WITHOUT a ledger so RecordFor
// never re-posts to the ledger — it appends the immutable earning row only. It is
// wired on VaultService ONLY: the ONLY Spotlight-earned fee in savings is the
// early-withdrawal penalty (deposits, normal withdrawals, target/Ajo flows are all
// fee-free — NL-2, no yield — so those services record nothing).
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
	RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *VaultService) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a completed early-
// withdrawal that incurred a penalty. Best-effort + MUST NEVER affect the caller: a
// nil recorder is a no-op, and any error is logged and swallowed so a profit-registry
// failure can never fail or reverse the withdrawal. The module's ACTUAL earning is the
// exact penalty already computed and debited into paymax_revenue, NOT a % of the
// principal, so we record the EXACT penaltyKobo via RecordExact (grossKobo = the
// withdrawal principal is passed for context). source ref + idempotency key = the
// per-penalty idempotency token so replays never double-count.
func (s *VaultService) recordCommissionSafe(ctx context.Context, grossKobo, penaltyKobo int64, sourceRef string, userID *string) {
	if s.commission == nil || penaltyKobo <= 0 {
		return
	}
	if err := s.commission.RecordExact(ctx, "Finance", "Savings", "", grossKobo, penaltyKobo,
		"savings", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[savings] commission record (source=%s gross=%d penalty=%d) failed, continuing: %v", sourceRef, grossKobo, penaltyKobo, err)
	}
}

// RegisterAutoSave wires the recurring auto-save handler into the scheduler. The
// handler debits the user's wallet by the configured amount with a per-run
// idempotency key (NL-9), so a retried poll never double-saves.
func (s *VaultService) RegisterAutoSave() {
	if s.sched == nil {
		return
	}
	s.sched.RegisterJobType(AutoSaveJobType, s.autoSaveRunner())
}

// autoSaveRunner performs one auto-save occurrence.
func (s *VaultService) autoSaveRunner() scheduler.HandlerFunc {
	return func(jc scheduler.HandlerCtx) error {
		vaultID := jc.Job().EntityRef()
		amtF, _ := jc.Job().PayloadValue("amount_kobo")
		amt := toInt64(amtF)
		if amt <= 0 {
			return fmt.Errorf("savings: autosave amount missing for vault %s", vaultID)
		}
		_, err := s.Deposit(jc.Context(), jc.Job().OwnerUserID(), vaultID, amt, jc.IdemKey())
		return err
	}
}

// CreateVault opens a new vault (OPEN). Lock vaults require a maturity date.
func (s *VaultService) CreateVault(ctx context.Context, ownerID, name string, kind VaultKind, targetKobo int64, maturesAt *time.Time) (*Vault, error) {
	if ownerID == "" || name == "" {
		return nil, fmt.Errorf("savings: owner and name required")
	}
	if kind == VaultLock && maturesAt == nil {
		return nil, fmt.Errorf("savings: lock vault requires a maturity date")
	}
	v := &Vault{
		ID: uuid.New().String(), OwnerUserID: ownerID, Name: name, Kind: kind,
		State: VaultOpen, TargetKobo: targetKobo, ConfigVersion: 1,
		MaturesAt: maturesAt, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	const q = `INSERT INTO savings_vaults (id, owner_user_id, name, kind, state, target_kobo, config_version, matures_at)
	           VALUES ($1,$2,$3,$4,'OPEN',$5,$6,$7)`
	if _, err := s.db.Exec(ctx, q, v.ID, v.OwnerUserID, v.Name, string(v.Kind), v.TargetKobo, v.ConfigVersion, v.MaturesAt); err != nil {
		return nil, fmt.Errorf("savings: insert vault: %w", err)
	}
	s.log(ownerID, "savings.vault.create", "savings_vault", v.ID, nil, map[string]any{"kind": kind})
	return v, nil
}

// Balance returns the derived vault sub-balance in kobo (NL-8).
func (s *VaultService) Balance(ctx context.Context, vaultID string) (int64, error) {
	const q = `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END),0)
	           FROM savings_vault_ledger WHERE vault_id=$1`
	var bal int64
	if err := s.db.QueryRow(ctx, q, vaultID).Scan(&bal); err != nil {
		return 0, fmt.Errorf("savings: vault balance: %w", err)
	}
	return bal, nil
}

// Deposit moves money from the owner's main wallet into the vault sub-balance.
// idemKey makes the whole flow replay-safe.
func (s *VaultService) Deposit(ctx context.Context, ownerID, vaultID string, amountKobo int64, idemKey string) (int64, error) {
	if amountKobo <= 0 {
		return 0, fmt.Errorf("savings: deposit must be positive")
	}
	v, err := s.getVault(ctx, vaultID)
	if err != nil {
		return 0, err
	}
	if v.OwnerUserID != ownerID {
		return 0, ErrForbidden // object-level authZ
	}
	if v.State != VaultOpen {
		return 0, fmt.Errorf("savings: cannot deposit to %s vault", v.State)
	}
	// Real money leaves the main wallet into the shared escrow/savings hold.
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return 0, err
	}
	if err := s.led.Debit(ctx, ownerID, "savings:deposit:"+vaultID, idemKey+":wallet", escrowAcc.ID, amountKobo); err != nil {
		return 0, fmt.Errorf("savings: wallet debit: %w", err)
	}
	if err := s.appendVaultEntry(ctx, vaultID, "CREDIT", amountKobo, "deposit", idemKey+":vault"); err != nil {
		return 0, err
	}
	s.log(ownerID, "savings.vault.deposit", "savings_vault", vaultID, nil, map[string]any{"amount_kobo": amountKobo})
	return s.Balance(ctx, vaultID)
}

// Withdraw moves money from the vault sub-balance back to the main wallet.
// Lock vaults reject early withdrawal before maturity (guarded). NL-1: cannot
// exceed the derived balance.
func (s *VaultService) Withdraw(ctx context.Context, ownerID, vaultID string, amountKobo int64, idemKey string) (int64, error) {
	if amountKobo <= 0 {
		return 0, fmt.Errorf("savings: withdraw must be positive")
	}
	v, err := s.getVault(ctx, vaultID)
	if err != nil {
		return 0, err
	}
	if v.OwnerUserID != ownerID {
		return 0, ErrForbidden
	}
	if v.Kind == VaultLock && v.State == VaultOpen {
		if v.MaturesAt == nil || time.Now().Before(*v.MaturesAt) {
			return 0, ErrLockedVault // early-break guarded
		}
	}
	bal, err := s.Balance(ctx, vaultID)
	if err != nil {
		return 0, err
	}
	if amountKobo > bal {
		return 0, ErrInsufficientVault
	}
	// Debit the vault ledger, then return funds from escrow hold to the wallet.
	if err := s.appendVaultEntry(ctx, vaultID, "DEBIT", amountKobo, "withdraw", idemKey+":vault"); err != nil {
		return 0, err
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return 0, err
	}
	if err := s.led.Credit(ctx, ownerID, "savings:withdraw:"+vaultID, idemKey+":wallet", escrowAcc.ID, amountKobo); err != nil {
		return 0, fmt.Errorf("savings: wallet credit: %w", err)
	}
	s.log(ownerID, "savings.vault.withdraw", "savings_vault", vaultID, nil, map[string]any{"amount_kobo": amountKobo})
	return s.Balance(ctx, vaultID)
}

// EnableAutoSave schedules a recurring auto-save job for the vault (NL-9 idempotent).
func (s *VaultService) EnableAutoSave(ctx context.Context, ownerID, vaultID string, amountKobo, intervalSecs int64) (string, error) {
	v, err := s.getVault(ctx, vaultID)
	if err != nil {
		return "", err
	}
	if v.OwnerUserID != ownerID {
		return "", ErrForbidden
	}
	if s.sched == nil {
		return "", fmt.Errorf("savings: scheduler unavailable")
	}
	job, err := s.sched.Schedule(ctx, scheduler.Job{
		JobType:      AutoSaveJobType,
		OwnerUserID:  ownerID,
		EntityRef:    vaultID,
		Payload:      map[string]any{"amount_kobo": amountKobo},
		IntervalSecs: intervalSecs,
		NextRunAt:    time.Now().Add(time.Duration(intervalSecs) * time.Second),
	})
	if err != nil {
		return "", err
	}
	const upd = `UPDATE savings_vaults SET autosave_job_id=$2, updated_at=now() WHERE id=$1`
	_, _ = s.db.Exec(ctx, upd, vaultID, job.ID)
	s.log(ownerID, "savings.vault.autosave_on", "savings_vault", vaultID, nil, map[string]any{"job_id": job.ID})
	return job.ID, nil
}

// TransitionState applies a guarded vault state change (OPEN→MATURED|CLOSED…).
func (s *VaultService) TransitionState(ctx context.Context, ownerID, vaultID string, to VaultState) error {
	v, err := s.getVault(ctx, vaultID)
	if err != nil {
		return err
	}
	if v.OwnerUserID != ownerID {
		return ErrForbidden
	}
	if !canVault(v.State, to) {
		return fmt.Errorf("savings: illegal vault transition %s -> %s", v.State, to)
	}
	const q = `UPDATE savings_vaults SET state=$2, updated_at=now() WHERE id=$1 AND state=$3`
	ct, err := s.db.Exec(ctx, q, vaultID, string(to), string(v.State))
	if err != nil || ct.RowsAffected() == 0 {
		return fmt.Errorf("savings: vault transition failed")
	}
	s.log(ownerID, "savings.vault.transition", "savings_vault", vaultID,
		map[string]any{"state": string(v.State)}, map[string]any{"state": string(to)})
	return nil
}

// ListVaults returns the owner's vaults (object-level: owner only).
func (s *VaultService) ListVaults(ctx context.Context, ownerID string) ([]Vault, error) {
	// The balance is projected from the append-only ledger in the same pass
	// (NL-8: never a stored column). Without it every vault in a list read
	// carried 0, so funded vaults rendered as ₦0 on the list screens. Same
	// expression as BuildSummary's per-vault subquery, kept in one round trip
	// rather than N+1 Balance() calls.
	const q = `SELECT v.id, v.owner_user_id, v.name, v.kind, v.state, v.target_kobo, v.config_version,
	                  v.matures_at, v.autosave_job_id, v.created_at, v.updated_at,
	                  COALESCE((SELECT SUM(CASE WHEN l.direction='CREDIT' THEN l.amount_kobo ELSE -l.amount_kobo END)
	                            FROM savings_vault_ledger l WHERE l.vault_id=v.id),0) AS balance_kobo
	           FROM savings_vaults v WHERE v.owner_user_id=$1 ORDER BY v.created_at DESC`
	rows, err := s.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Vault
	for rows.Next() {
		var v Vault
		var kind, state string
		if err := rows.Scan(&v.ID, &v.OwnerUserID, &v.Name, &kind, &state, &v.TargetKobo,
			&v.ConfigVersion, &v.MaturesAt, &v.AutoSaveJobID, &v.CreatedAt, &v.UpdatedAt,
			&v.BalanceKobo); err != nil {
			return nil, err
		}
		v.Kind = VaultKind(kind)
		v.State = VaultState(state)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *VaultService) getVault(ctx context.Context, vaultID string) (*Vault, error) {
	const q = `SELECT id, owner_user_id, name, kind, state, target_kobo, config_version, matures_at, autosave_job_id
	           FROM savings_vaults WHERE id=$1`
	var v Vault
	var kind, state string
	if err := s.db.QueryRow(ctx, q, vaultID).Scan(&v.ID, &v.OwnerUserID, &v.Name, &kind,
		&state, &v.TargetKobo, &v.ConfigVersion, &v.MaturesAt, &v.AutoSaveJobID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	v.Kind = VaultKind(kind)
	v.State = VaultState(state)
	return &v, nil
}

// appendVaultEntry writes an immutable sub-balance ledger row. UNIQUE(idem_key)
// makes a replay a no-op (NL-9). NL-2 is enforced here: direction is only ever
// the explicit deposit/withdraw — no "interest"/"yield" reason is permitted.
func (s *VaultService) appendVaultEntry(ctx context.Context, vaultID, direction string, amountKobo int64, reason, idemKey string) error {
	if reason == "interest" || reason == "yield" {
		return fmt.Errorf("savings: yield is forbidden (NL-2)")
	}
	const q = `INSERT INTO savings_vault_ledger (id, vault_id, direction, amount_kobo, reason, idempotency_key)
	           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`
	_, err := s.db.Exec(ctx, q, uuid.New().String(), vaultID, direction, amountKobo, reason, idemKey)
	if err != nil {
		return fmt.Errorf("savings: append vault entry: %w", err)
	}
	return nil
}

func (s *VaultService) log(actor, action, resType, resID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "savings", resType, resID, oldV, newV, "", "", "info")
}

func toInt64(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

// Sentinel errors.
var (
	ErrNotFound          = fmt.Errorf("savings: not found")
	ErrForbidden         = fmt.Errorf("savings: forbidden")
	ErrLockedVault       = fmt.Errorf("savings: lock vault not yet matured")
	ErrInsufficientVault = fmt.Errorf("savings: insufficient vault balance")
)
