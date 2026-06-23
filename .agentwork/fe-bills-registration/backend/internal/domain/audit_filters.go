package domain

type AuditFilter struct {
	Limit      int
	ActorUser  string
	TargetUser string
	Module     string
	Action     string
	Severity   string
	DateFrom   string
	DateTo     string
	Status     string
	Email      string
}
