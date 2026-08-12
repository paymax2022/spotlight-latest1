package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// Test that all admin console endpoints are accessible and return valid responses.

func setupAdminConsoleRouter() *gin.Engine {
	r := gin.New()
	handler := NewAdminConsoleHandler()

	// Simulate the middleware that validates X-Admin-Role
	r.Use(func(c *gin.Context) {
		role := c.GetHeader("X-Admin-Role")
		if role == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing X-Admin-Role"})
			c.Abort()
			return
		}
		c.Set("adminRole", role)
		c.Next()
	})

	// Register all routes
	admin := r.Group("/api/v1/admin")
	admin.GET("/dashboard", handler.Dashboard)
	admin.GET("/users", handler.GetUsers)
	admin.GET("/users/:id", handler.GetUser)
	admin.GET("/kyc", handler.GetKycQueue)
	admin.POST("/kyc/:id/review", handler.ReviewKyc)
	admin.GET("/assets", handler.GetAssetControls)
	admin.PATCH("/assets/:id", handler.UpdateAssetControl)
	admin.GET("/orders", handler.GetOrders)
	admin.GET("/withdrawals", handler.GetWithdrawalQueue)
	admin.POST("/withdrawals/:ref/review", handler.ReviewWithdrawal)
	admin.GET("/reconciliation", handler.GetReconciliation)
	admin.GET("/providers", handler.GetProviders)
	admin.GET("/risk-limits", handler.GetRiskLimits)
	admin.PATCH("/risk-limits/:id", handler.UpdateRiskLimit)
	admin.GET("/fees", handler.GetFees)
	admin.PATCH("/fees/:id", handler.UpdateFee)
	admin.GET("/feature-flags", handler.GetFeatureFlags)
	admin.PATCH("/feature-flags/:key", handler.SetFeatureFlag)
	admin.GET("/approvals", handler.GetApprovals)
	admin.POST("/approvals/:id/approve", handler.Approve)
	admin.POST("/approvals/:id/reject", handler.RejectApproval)
	admin.GET("/audit", handler.GetAudit)
	admin.GET("/admins", handler.GetAdmins)

	return r
}

func TestAdminConsole_Dashboard(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/dashboard", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var data map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &data)
	assert.NoError(t, err)
	assert.Contains(t, data, "users")
	assert.Contains(t, data, "openKyc")
	assert.Contains(t, data, "revenueToday")
}

func TestAdminConsole_GetUsers(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/users", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var users []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &users)
	assert.NoError(t, err)
	assert.Len(t, users, 3) // We return 3 mock users
	assert.Equal(t, "alice@example.com", users[0]["email"])
}

func TestAdminConsole_GetUser(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/users/usr_001", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var user map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &user)
	assert.NoError(t, err)
	assert.Equal(t, "usr_001", user["id"])
	assert.Equal(t, "Alice Johnson", user["name"])
}

func TestAdminConsole_GetKycQueue(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/kyc", nil)
	req.Header.Set("X-Admin-Role", "ComplianceAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var cases []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &cases)
	assert.NoError(t, err)
	assert.Len(t, cases, 2) // We return 2 mock KYC cases
}

func TestAdminConsole_ReviewKyc(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	body := []byte(`{"decision":"approve","reason":"All checks passed"}`)
	req, _ := http.NewRequest("POST", "/api/v1/admin/kyc/kyc_001/review", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "ComplianceAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "approve", result["status"])
}

func TestAdminConsole_GetAssets(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/assets", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var assets []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &assets)
	assert.NoError(t, err)
	assert.Len(t, assets, 3) // BTC, ETH, AAPL
	assert.Equal(t, "BTC", assets[0]["symbol"])
}

func TestAdminConsole_UpdateAsset(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	body := []byte(`{"buyEnabled":false,"feeBps":100}`)
	req, _ := http.NewRequest("PATCH", "/api/v1/admin/assets/ast_001", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "RiskAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, false, result["buyEnabled"])
	assert.Equal(t, float64(100), result["feeBps"])
}

func TestAdminConsole_GetOrders(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/orders?filter=failed", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var orders []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &orders)
	assert.NoError(t, err)
	// Only 1 order with status "Failed" in mock data
	assert.Len(t, orders, 1)
	assert.Equal(t, "Failed", orders[0]["status"])
}

func TestAdminConsole_GetWithdrawals(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/withdrawals", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var withdrawals []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &withdrawals)
	assert.NoError(t, err)
	assert.Len(t, withdrawals, 2)
}

func TestAdminConsole_ReviewWithdrawal(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	body := []byte(`{"decision":"approve","reason":"Risk score acceptable"}`)
	req, _ := http.NewRequest("POST", "/api/v1/admin/withdrawals/WD-001-XYZ/review", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "approve", result["status"])
}

func TestAdminConsole_GetReconciliation(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/reconciliation", nil)
	req.Header.Set("X-Admin-Role", "FinanceAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var recon map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &recon)
	assert.NoError(t, err)
	assert.Contains(t, recon, "exceptions")
}

func TestAdminConsole_GetProviders(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/providers", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var providers []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &providers)
	assert.NoError(t, err)
	assert.Len(t, providers, 3)
	assert.Equal(t, "healthy", providers[0]["status"])
}

func TestAdminConsole_GetRiskLimits(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/risk-limits", nil)
	req.Header.Set("X-Admin-Role", "RiskAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var limits []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &limits)
	assert.NoError(t, err)
	assert.Len(t, limits, 3)
}

func TestAdminConsole_UpdateRiskLimit(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	body := []byte(`{"valueMinor":20000000}`)
	req, _ := http.NewRequest("PATCH", "/api/v1/admin/risk-limits/rl_001", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "RiskAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, float64(20000000), result["valueMinor"])
}

func TestAdminConsole_GetFees(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/fees", nil)
	req.Header.Set("X-Admin-Role", "FinanceAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var fees []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &fees)
	assert.NoError(t, err)
	assert.Len(t, fees, 3)
}

func TestAdminConsole_UpdateFee(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	body := []byte(`{"bps":100}`)
	req, _ := http.NewRequest("PATCH", "/api/v1/admin/fees/fee_001", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "FinanceAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, float64(100), result["bps"])
}

func TestAdminConsole_GetFeatureFlags(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/feature-flags", nil)
	req.Header.Set("X-Admin-Role", "ProductAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var flags []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &flags)
	assert.NoError(t, err)
	assert.Len(t, flags, 4)
}

func TestAdminConsole_SetFeatureFlag(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	body := []byte(`{"enabled":true}`)
	req, _ := http.NewRequest("PATCH", "/api/v1/admin/feature-flags/ENABLE_STOCK_TRADING", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "ProductAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, true, result["enabled"])
}

func TestAdminConsole_GetApprovals(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/approvals", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var approvals []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &approvals)
	assert.NoError(t, err)
	assert.Len(t, approvals, 2)
	assert.Equal(t, "pending", approvals[0]["status"])
}

func TestAdminConsole_Approve(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	body := []byte(`{}`)
	req, _ := http.NewRequest("POST", "/api/v1/admin/approvals/app_001/approve", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "approved", result["status"])
}

func TestAdminConsole_RejectApproval(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	body := []byte(`{"reason":"Insufficient supporting documentation"}`)
	req, _ := http.NewRequest("POST", "/api/v1/admin/approvals/app_001/reject", bytes.NewBuffer(body))
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var result map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "rejected", result["status"])
}

func TestAdminConsole_GetAudit(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/audit", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var entries []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &entries)
	assert.NoError(t, err)
	assert.Len(t, entries, 2)
}

func TestAdminConsole_GetAdmins(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/admins", nil)
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var admins []map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &admins)
	assert.NoError(t, err)
	assert.Len(t, admins, 3)
}

func TestAdminConsole_MissingRole(t *testing.T) {
	r := setupAdminConsoleRouter()
	w := httptest.NewRecorder()

	req, _ := http.NewRequest("GET", "/api/v1/admin/dashboard", nil)
	// No X-Admin-Role header
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
