package arena

// The four firewalled rails (ADR-014 §3, NDC-1). Each rail declares its write
// target; only MERIT writes to the Merit ledger, and only via a signed adapter.

// Rail is an engagement/scoring channel.
type Rail string

const (
	RailMerit    Rail = "MERIT"     // signed judging → Merit ledger (the crown)
	RailSupport  Rail = "SUPPORT"   // real-Naira gifting → wallet ledger + pot
	RailPlayAlong Rail = "PLAYALONG" // free quiz → engagement ledger + credential
	RailSponsor  Rail = "SPONSOR"   // branded → engagement + Featured Placement
)

// WriteTarget names where a rail is permitted to write.
type WriteTarget string

const (
	TargetMeritLedger      WriteTarget = "merit_ledger"
	TargetWalletLedger     WriteTarget = "wallet_ledger"
	TargetEngagementLedger WriteTarget = "engagement_ledger"
	TargetFeaturedPlacement WriteTarget = "featured_placement"
)

// railTargets is the fixed, non-editable rail→target policy. The crown/merit is
// reachable only through RailMerit.
var railTargets = map[Rail]WriteTarget{
	RailMerit:     TargetMeritLedger,
	RailSupport:   TargetWalletLedger,
	RailPlayAlong: TargetEngagementLedger,
	RailSponsor:   TargetFeaturedPlacement,
}

// TargetFor returns the permitted write target for a rail.
func TargetFor(r Rail) WriteTarget { return railTargets[r] }

// WritesMerit reports whether a rail may write to the Merit ledger. Only MERIT.
func WritesMerit(r Rail) bool { return railTargets[r] == TargetMeritLedger }

// AwardType is a computed outcome; each declares which rails feed it.
type AwardType string

const (
	AwardNaijaDriverCrown AwardType = "NAIJA_DRIVER_CROWN"
	AwardPeoplesChampion  AwardType = "PEOPLES_CHAMPION"
	AwardStatePrideWinner AwardType = "STATE_PRIDE_WINNER"
	AwardCertifiedDriver  AwardType = "CERTIFIED_SAFE_DRIVER"
)

// awardRails is the fixed award→feeding-rail policy. The crown is fed ONLY by
// Merit (NDC-1) and this cannot be reconfigured to accept another rail.
var awardRails = map[AwardType][]Rail{
	AwardNaijaDriverCrown: {RailMerit},
	AwardPeoplesChampion:  {RailSupport},
	AwardStatePrideWinner: {RailSupport},
	AwardCertifiedDriver:  {RailPlayAlong},
}

// RailsFor returns the rails that feed an award.
func RailsFor(a AwardType) []Rail { return awardRails[a] }

// AwardFedByMeritOnly reports whether an award is a pure function of Merit.
func AwardFedByMeritOnly(a AwardType) bool {
	rs := awardRails[a]
	return len(rs) == 1 && rs[0] == RailMerit
}
