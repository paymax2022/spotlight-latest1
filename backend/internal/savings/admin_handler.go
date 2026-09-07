package savings

// Read-only admin endpoints for the savings ops console.
//
// Every handler here is a READ. The console's two mutations — force-unlocking a
// vault and acting on a default — move money and are deliberately NOT
// implemented: they need failing tests first and a ledger-auditor review per
// CLAUDE.md, and the client already refuses them honestly rather than reporting a
// success it did not perform. A read-only console that tells the truth is worth
// more than a complete one that does not.

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// defaultLimit caps every list so a console page cannot pull the whole book.
const (
	defaultAdminLimit = 100
	maxAdminLimit     = 500
)

type AdminHandler struct{ repo *AdminRepository }

func NewAdminHandler(repo *AdminRepository) *AdminHandler { return &AdminHandler{repo: repo} }

func adminLimit(c *gin.Context) int {
	n, err := strconv.Atoi(c.Query("limit"))
	if err != nil || n <= 0 {
		return defaultAdminLimit
	}
	if n > maxAdminLimit {
		return maxAdminLimit
	}
	return n
}

// adminState narrows a list to one state. Anything unrecognised is rejected
// rather than ignored: silently returning the unfiltered book for a typo'd
// filter shows an operator more than they asked for and calls it a filtered view.
func adminState(c *gin.Context, allowed map[string]bool) (string, bool) {
	s := c.Query("state")
	if s == "" {
		return "", true
	}
	if !allowed[s] {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "unknown state filter: " + s,
		})
		return "", false
	}
	return s, true
}

var (
	vaultStates  = map[string]bool{"OPEN": true, "MATURED": true, "CLOSED": true}
	circleStates = map[string]bool{"FORMING": true, "ACTIVE": true, "COMPLETED": true, "CANCELLED": true}
)

func (h *AdminHandler) Dashboard(c *gin.Context) {
	d, err := h.repo.Dashboard(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "dashboard": d})
}

func (h *AdminHandler) Vaults(c *gin.Context) {
	state, ok := adminState(c, vaultStates)
	if !ok {
		return
	}
	v, err := h.repo.Vaults(c.Request.Context(), state, adminLimit(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "vaults": v})
}

func (h *AdminHandler) Circles(c *gin.Context) {
	state, ok := adminState(c, circleStates)
	if !ok {
		return
	}
	circles, err := h.repo.Circles(c.Request.Context(), state, adminLimit(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "circles": circles})
}

func (h *AdminHandler) Defaults(c *gin.Context) {
	d, err := h.repo.Defaults(c.Request.Context(), adminLimit(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "defaults": d})
}
