package admin

// Permission constants are coarse capability strings checked at every mutation
// (and a few sensitive reads). Keep them stable: the HTTP layer's RBAC
// middleware references the same strings.
const (
	PermUserView          = "user:view"
	PermKycReview         = "kyc:review"
	PermAssetConfig       = "asset:config"
	PermOrderView         = "order:view"
	PermWithdrawalApprove = "withdrawal:approve"
	PermRiskConfig        = "risk:config"
	PermFeeConfig         = "fee:config"
	PermFlagToggle        = "flag:toggle"
	PermProviderView      = "provider:view"
	PermApprovalAct       = "approval:act"
	PermAudit             = "audit:view"
)

// allPerms is the full capability set (used to grant SuperAdmin everything and
// to keep the matrix below honest).
var allPerms = []string{
	PermUserView, PermKycReview, PermAssetConfig, PermOrderView,
	PermWithdrawalApprove, PermRiskConfig, PermFeeConfig, PermFlagToggle,
	PermProviderView, PermApprovalAct, PermAudit,
}

// rolePerms maps each role to the set of permissions it holds. SuperAdmin is
// granted everything in init().
var rolePerms = map[Role]map[string]bool{
	RoleComplianceAdmin: set(PermUserView, PermKycReview, PermWithdrawalApprove, PermApprovalAct, PermAudit, PermProviderView),
	RoleTradingOpsAdmin: set(PermUserView, PermOrderView, PermAssetConfig, PermProviderView, PermAudit),
	RoleProductAdmin:    set(PermUserView, PermAssetConfig, PermFlagToggle, PermOrderView, PermProviderView),
	RoleFinanceAdmin:    set(PermUserView, PermFeeConfig, PermOrderView, PermApprovalAct, PermAudit, PermProviderView),
	RoleSupportAdmin:    set(PermUserView, PermOrderView, PermProviderView),
	RoleRiskAdmin:       set(PermUserView, PermRiskConfig, PermWithdrawalApprove, PermApprovalAct, PermAudit, PermProviderView),
	RoleContentAdmin:    set(PermUserView, PermFlagToggle),
}

func init() {
	all := map[string]bool{}
	for _, p := range allPerms {
		all[p] = true
	}
	rolePerms[RoleSuperAdmin] = all
}

// set builds a permission lookup from a list.
func set(perms ...string) map[string]bool {
	m := make(map[string]bool, len(perms))
	for _, p := range perms {
		m[p] = true
	}
	return m
}

// Can reports whether role holds perm. Unknown roles hold nothing.
func Can(role Role, perm string) bool {
	if m, ok := rolePerms[role]; ok {
		return m[perm]
	}
	return false
}

// Permissions returns the sorted-by-declaration permission list for a role
// (handy for an HTTP `whoami` endpoint). Returns a fresh slice.
func Permissions(role Role) []string {
	m := rolePerms[role]
	if m == nil {
		return []string{}
	}
	out := make([]string, 0, len(m))
	for _, p := range allPerms {
		if m[p] {
			out = append(out, p)
		}
	}
	return out
}
