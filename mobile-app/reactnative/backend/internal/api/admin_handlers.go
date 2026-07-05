package api

import (
	"encoding/json"
	"io"
	"net/http"

	"paymax/crypto-backend/internal/admin"
)

// adminRole reads the actor's role from the X-Admin-Role header. In production
// this would come from the verified admin JWT's role claim; the header keeps the
// console usable in dev. Empty role → no privileged permissions.
func adminRole(r *http.Request) admin.Role {
	return admin.Role(r.Header.Get("X-Admin-Role"))
}

// adminErr maps a typed admin error to an HTTP status.
func adminErr(w http.ResponseWriter, e *admin.AdminError) {
	status := http.StatusUnprocessableEntity
	switch e.Type {
	case "forbidden":
		status = http.StatusForbidden
	case "not_found":
		status = http.StatusNotFound
	case "invalid":
		status = http.StatusBadRequest
	case "conflict":
		status = http.StatusConflict
	}
	writeErr(w, status, e.Type, e.Message)
}

// body reads + decodes the request body into v; returns false (and writes 400) on error.
func body(w http.ResponseWriter, r *http.Request, v any) bool {
	b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil || json.Unmarshal(b, v) != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "Malformed request body.")
		return false
	}
	return true
}

// ── Reads (ungated) ────────────────────────────────────────────────────────────

func (s *Server) adminDashboard(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Dashboard())
}
func (s *Server) adminUsers(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Users())
}
func (s *Server) adminUser(w http.ResponseWriter, r *http.Request) {
	u, ok := s.Admin.User(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "User not found.")
		return
	}
	writeJSON(w, http.StatusOK, u)
}
func (s *Server) adminKycQueue(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.KycQueue())
}
func (s *Server) adminAssets(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Assets())
}
func (s *Server) adminOrders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Orders(r.URL.Query().Get("filter")))
}
func (s *Server) adminWithdrawalQueue(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.WithdrawalQueue())
}
func (s *Server) adminReconciliation(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Reconciliation())
}
func (s *Server) adminProviders(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Providers())
}
func (s *Server) adminRiskLimits(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.RiskLimits())
}
func (s *Server) adminFees(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Fees())
}
func (s *Server) adminFlags(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.FeatureFlags())
}
func (s *Server) adminApprovals(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Approvals())
}
func (s *Server) adminAudit(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Audit())
}
func (s *Server) adminAdmins(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Admin.Admins())
}

// ── Mutations (RBAC-gated + audited + maker-checker in the service) ────────────

func (s *Server) adminReviewKyc(w http.ResponseWriter, r *http.Request) {
	var b struct{ Decision, Reason string }
	if !body(w, r, &b) {
		return
	}
	if e := s.Admin.ReviewKyc(r.PathValue("id"), b.Decision, adminRole(r), b.Reason); e != nil {
		adminErr(w, e)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) adminUpdateAsset(w http.ResponseWriter, r *http.Request) {
	bts, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	var patch admin.AssetControlPatch
	var meta struct{ Reason string }
	_ = json.Unmarshal(bts, &patch)
	_ = json.Unmarshal(bts, &meta)
	if e := s.Admin.UpdateAssetControl(r.PathValue("id"), patch, adminRole(r), meta.Reason); e != nil {
		adminErr(w, e)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) adminReviewWithdrawal(w http.ResponseWriter, r *http.Request) {
	var b struct{ Decision, Reason string }
	if !body(w, r, &b) {
		return
	}
	if e := s.Admin.ReviewWithdrawal(r.PathValue("ref"), b.Decision, adminRole(r), b.Reason); e != nil {
		adminErr(w, e)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) adminUpdateRiskLimit(w http.ResponseWriter, r *http.Request) {
	var b struct {
		ValueMinor int64  `json:"valueMinor"`
		Reason     string `json:"reason"`
	}
	if !body(w, r, &b) {
		return
	}
	if e := s.Admin.UpdateRiskLimit(r.PathValue("id"), b.ValueMinor, adminRole(r), b.Reason); e != nil {
		adminErr(w, e)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) adminUpdateFee(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Bps    int64  `json:"bps"`
		Reason string `json:"reason"`
	}
	if !body(w, r, &b) {
		return
	}
	if e := s.Admin.UpdateFee(r.PathValue("id"), b.Bps, adminRole(r), b.Reason); e != nil {
		adminErr(w, e)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) adminSetFlag(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Enabled bool   `json:"enabled"`
		Reason  string `json:"reason"`
	}
	if !body(w, r, &b) {
		return
	}
	if e := s.Admin.SetFlag(r.PathValue("key"), b.Enabled, adminRole(r), b.Reason); e != nil {
		adminErr(w, e)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) adminApprove(w http.ResponseWriter, r *http.Request) {
	ap, e := s.Admin.Approve(r.PathValue("id"), adminRole(r))
	if e != nil {
		adminErr(w, e)
		return
	}
	writeJSON(w, http.StatusOK, ap)
}

func (s *Server) adminRejectApproval(w http.ResponseWriter, r *http.Request) {
	var b struct{ Reason string }
	if !body(w, r, &b) {
		return
	}
	ap, e := s.Admin.RejectApproval(r.PathValue("id"), adminRole(r), b.Reason)
	if e != nil {
		adminErr(w, e)
		return
	}
	writeJSON(w, http.StatusOK, ap)
}
