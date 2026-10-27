package top5events

// SetPayoutLegFault injects a failure into the organiser payout ledger legs
// ("net" / "fee") so the live-DB suite can drive the failed / partially-applied
// paths. Test-only: compiled into the package's test binary, never production.
func (s *Service) SetPayoutLegFault(f func(leg string) error) { s.payouts.legFault = f }
