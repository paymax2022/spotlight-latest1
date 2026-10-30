package admin

import (
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"spotlight/backend/go-common/httperr"

	"github.com/gin-gonic/gin"
)

// hotelierRolePermissions maps each stays hotelier role to the capabilities the
// extranet actually gates on. The extranet checks OWNER and MANAGER for property
// and staff management (see extranet service HasPropertyRole); the other roles
// hold no management capability.
var hotelierRolePermissions = map[string][]string{
	"OWNER":   {"stays.hotelier.manage_property", "stays.hotelier.manage_staff"},
	"MANAGER": {"stays.hotelier.manage_property", "stays.hotelier.manage_staff"},
}

// AdminUserRow is one person holding at least one stays hotelier grant, shaped
// for the admin RBAC console. Names and emails are masked, as in the other
// admin surfaces.
type AdminUserRow struct {
	ID          string    `json:"id"`
	UserMasked  string    `json:"user_masked"`
	EmailMasked string    `json:"email_masked"`
	Roles       []string  `json:"roles"`
	Permissions []string  `json:"permissions"`
	LastActive  time.Time `json:"last_active"`
	Status      string    `json:"status"`
}

type userAccumulator struct {
	row   AdminUserRow
	roles map[string]bool
	perms map[string]bool
}

// ListUsers: GET /api/stays/admin/users[?status=active|disabled]
//
// One row per user with a stays hotelier grant. A user's roles are the distinct
// roles across all their property grants. The user is "active" while any grant is
// ACTIVE, otherwise "disabled". last_active is the most recent grant change.
func (h *Handler) ListUsers(c *gin.Context) {
	status := strings.ToLower(strings.TrimSpace(c.Query("status")))
	rows, err := h.db.Query(c.Request.Context(), `
		SELECT hp.user_id::text, COALESCE(up.full_name, ''), COALESCE(u.email, ''),
		       hp.role, hp.status, hp.updated_at
		FROM public.stays_hotelier_profile hp
		JOIN auth.users u ON u.id = hp.user_id
		LEFT JOIN public.user_profiles up ON up.id = hp.user_id`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	defer rows.Close()

	byUser := map[string]*userAccumulator{}
	for rows.Next() {
		var userID, fullName, email, role, grantStatus string
		var updatedAt time.Time
		if err := rows.Scan(&userID, &fullName, &email, &role, &grantStatus, &updatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		acc, ok := byUser[userID]
		if !ok {
			acc = &userAccumulator{
				row: AdminUserRow{
					ID:          userID,
					UserMasked:  maskName(fullName, email),
					EmailMasked: maskEmail(email),
					Status:      "disabled",
				},
				roles: map[string]bool{},
				perms: map[string]bool{},
			}
			byUser[userID] = acc
		}
		acc.roles[role] = true
		for _, p := range hotelierRolePermissions[role] {
			acc.perms[p] = true
		}
		if grantStatus == "ACTIVE" {
			acc.row.Status = "active"
		}
		if updatedAt.After(acc.row.LastActive) {
			acc.row.LastActive = updatedAt
		}
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}

	out := make([]AdminUserRow, 0, len(byUser))
	for _, acc := range byUser {
		if status != "" && acc.row.Status != status {
			continue
		}
		acc.row.Roles = sortedKeys(acc.roles)
		acc.row.Permissions = sortedKeys(acc.perms)
		out = append(out, acc.row)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].EmailMasked < out[j].EmailMasked })
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func sortedKeys(set map[string]bool) []string {
	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// maskName shows the first name and the initial of the last name, then a mask.
// Falls back to the email's local part when the profile has no name.
func maskName(fullName, email string) string {
	parts := strings.Fields(fullName)
	if len(parts) == 0 {
		local := email
		if i := strings.Index(email, "@"); i > 0 {
			local = email[:i]
		}
		return firstRune(local) + "••••"
	}
	if len(parts) == 1 {
		return parts[0] + "••••"
	}
	return parts[0] + " " + firstRune(parts[len(parts)-1]) + "••••"
}

// maskEmail keeps the first character of the local part and the domain.
func maskEmail(email string) string {
	at := strings.Index(email, "@")
	if at <= 0 {
		return ""
	}
	return firstRune(email[:at]) + "••@" + email[at+1:]
}

func firstRune(s string) string {
	if s == "" {
		return ""
	}
	r, _ := utf8.DecodeRuneInString(s)
	return string(r)
}
