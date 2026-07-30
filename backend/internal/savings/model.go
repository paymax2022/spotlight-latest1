package savings

import "time"

// ──────────────────────────────────────────────────────────────────────────
// VAULT — a wallet sub-balance held as a dedicated append-only ledger
// (savings_vault_ledger). Balance is ALWAYS derived (NL-8). Lock/Flex config is
// versioned (config-driven variation). NL-2: vaults earn ZERO yield.
// State machine: OPEN → (LOCKED|FLEX implied by config) → MATURED | CLOSED.
// ──────────────────────────────────────────────────────────────────────────

type VaultState string

const (
	VaultOpen    VaultState = "OPEN"
	VaultMatured VaultState = "MATURED"
	VaultClosed  VaultState = "CLOSED"
)

type VaultKind string

const (
	VaultFlex VaultKind = "FLEX" // withdraw anytime
	VaultLock VaultKind = "LOCK" // locked until maturity; early break guarded
)

var vaultTransitions = map[VaultState]map[VaultState]bool{
	VaultOpen:    {VaultMatured: true, VaultClosed: true},
	VaultMatured: {VaultClosed: true},
	VaultClosed:  {},
}

type Vault struct {
	ID            string     `json:"id"`
	OwnerUserID   string     `json:"owner_user_id"`
	Name          string     `json:"name"`
	Kind          VaultKind  `json:"kind"`
	State         VaultState `json:"state"`
	TargetKobo    int64      `json:"target_kobo"`    // optional goal
	ConfigVersion int        `json:"config_version"` // versioned lock/flex config
	MaturesAt     *time.Time `json:"matures_at,omitempty"`
	AutoSaveJobID *string    `json:"autosave_job_id,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// ──────────────────────────────────────────────────────────────────────────
// AJO / ESUSU CIRCLE — peer rotation savings. NL-7: members fund EACH OTHER;
// Paymax is ledger + escrow only, never guarantor / never advances capital
// (NL-1). NL-2: no yield. Each cycle every active member auto-debits the
// contribution; the pooled total pays out to the scheduled recipient for that
// cycle, then the rotation order advances.
// Circle: FORMING → ACTIVE → (CYCLE×n) → COMPLETED.
// Member:  INVITED → ACTIVE → DEFAULTED | EXITED.
// ──────────────────────────────────────────────────────────────────────────

type CircleState string

const (
	CircleForming   CircleState = "FORMING"
	CircleActive    CircleState = "ACTIVE"
	CircleCompleted CircleState = "COMPLETED"
	CircleCancelled CircleState = "CANCELLED"
)

var circleTransitions = map[CircleState]map[CircleState]bool{
	CircleForming:   {CircleActive: true, CircleCancelled: true},
	CircleActive:    {CircleCompleted: true, CircleCancelled: true},
	CircleCompleted: {},
	CircleCancelled: {},
}

type MemberState string

const (
	MemberInvited   MemberState = "INVITED"
	MemberActive    MemberState = "ACTIVE"
	MemberDefaulted MemberState = "DEFAULTED"
	MemberExited    MemberState = "EXITED"
)

var memberTransitions = map[MemberState]map[MemberState]bool{
	MemberInvited:   {MemberActive: true, MemberExited: true},
	MemberActive:    {MemberDefaulted: true, MemberExited: true},
	MemberDefaulted: {MemberActive: true, MemberExited: true}, // make-good restores
	MemberExited:    {},
}

type Circle struct {
	ID               string      `json:"id"`
	CreatorUserID    string      `json:"creator_user_id"`
	Name             string      `json:"name"`
	ContributionKobo int64       `json:"contribution_kobo"` // per member per cycle
	IntervalSecs     int64       `json:"interval_secs"`     // cycle cadence
	State            CircleState `json:"state"`
	CurrentCycle     int         `json:"current_cycle"`
	TotalCycles      int         `json:"total_cycles"` // == active member count at activation
	CycleJobID       *string     `json:"cycle_job_id,omitempty"`
	CreatedAt        time.Time   `json:"created_at"`
	UpdatedAt        time.Time   `json:"updated_at"`
}

type CircleMember struct {
	ID            string      `json:"id"`
	CircleID      string      `json:"circle_id"`
	UserID        string      `json:"user_id"`
	RotationOrder int         `json:"rotation_order"` // 0-based payout position
	State         MemberState `json:"state"`
	MissedCount   int         `json:"missed_count"`
	JoinedAt      time.Time   `json:"joined_at"`
}

type CycleStatus string

const (
	CyclePending CycleStatus = "PENDING"
	CycleRunning CycleStatus = "RUNNING"
	CyclePaid    CycleStatus = "PAID"
)

type Cycle struct {
	ID            string      `json:"id"`
	CircleID      string      `json:"circle_id"`
	CycleNumber   int         `json:"cycle_number"`
	RecipientID   string      `json:"recipient_id"`
	CollectedKobo int64       `json:"collected_kobo"`
	PayoutKobo    int64       `json:"payout_kobo"`
	Status        CycleStatus `json:"status"`
	ScheduledFor  time.Time   `json:"scheduled_for"`
	PaidAt        *time.Time  `json:"paid_at,omitempty"`
}

// ──────────────────────────────────────────────────────────────────────────
// GROUP TARGET — a shared goal pot. Balance is ledger-derived (NL-8). NL-2: no
// yield. Withdrawal rule is config: ON_DATE (after target_date) or MAJORITY
// (member approval threshold).
// ──────────────────────────────────────────────────────────────────────────

type TargetState string

const (
	TargetOpen     TargetState = "OPEN"
	TargetReached  TargetState = "REACHED"
	TargetReleased TargetState = "RELEASED"
	TargetClosed   TargetState = "CLOSED"
)

var targetTransitions = map[TargetState]map[TargetState]bool{
	TargetOpen:     {TargetReached: true, TargetReleased: true, TargetClosed: true},
	TargetReached:  {TargetReleased: true, TargetClosed: true},
	TargetReleased: {TargetClosed: true},
	TargetClosed:   {},
}

type WithdrawalRule string

const (
	RuleOnDate   WithdrawalRule = "ON_DATE"
	RuleMajority WithdrawalRule = "MAJORITY"
)

type GroupTarget struct {
	ID            string         `json:"id"`
	CreatorUserID string         `json:"creator_user_id"`
	Name          string         `json:"name"`
	TargetKobo    int64          `json:"target_kobo"`
	Rule          WithdrawalRule `json:"withdrawal_rule"`
	TargetDate    *time.Time     `json:"target_date,omitempty"`
	State         TargetState    `json:"state"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

type GroupTargetMember struct {
	ID       string    `json:"id"`
	TargetID string    `json:"target_id"`
	UserID   string    `json:"user_id"`
	Approved bool      `json:"approved"` // for MAJORITY release vote
	JoinedAt time.Time `json:"joined_at"`
}

func canVault(from, to VaultState) bool   { return vaultTransitions[from][to] }
func canCircle(from, to CircleState) bool { return circleTransitions[from][to] }
func canMember(from, to MemberState) bool { return memberTransitions[from][to] }
func canTarget(from, to TargetState) bool { return targetTransitions[from][to] }
