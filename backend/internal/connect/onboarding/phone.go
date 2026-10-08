package connectonboarding

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/otp"
)

// SOC-039: connect_onboarding gates `complete` on phone_verified, which had no
// write path — onboarding could never finish. These endpoints close the loop:
// request stores the (pending) number and SMSes an OTP via Termii, verify
// checks it through the shared otp.Service (pepper-hashed codes, resend
// cooldown, per-address + per-IP budgets) and flips phone_verified.

var (
	ErrInvalidPhone           = errors.New("connect: invalid phone number")
	ErrNoPhonePending         = errors.New("connect: request a verification code first")
	ErrPhoneVerifyUnavailable = errors.New("connect: phone verification is not configured")
)

// E.164-lite: optional + followed by 7–15 digits. Termii accepts both
// international (+234…) and local (08…) formats, so we normalise, not
// restructure, and leave provider-side number validation to Termii.
var phoneRe = regexp.MustCompile(`^\+?\d{7,15}$`)

func normalizePhone(s string) (string, error) {
	s = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(strings.TrimSpace(s))
	if !phoneRe.MatchString(s) {
		return "", ErrInvalidPhone
	}
	return s, nil
}

// RequestPhoneVerification stores the number (resetting phone_verified when it
// changes) and sends an SMS code.
func (s *Service) RequestPhoneVerification(ctx context.Context, userID, phone, ip string, otpSvc *otp.Service) error {
	if otpSvc == nil {
		return ErrPhoneVerifyUnavailable
	}
	p, err := normalizePhone(phone)
	if err != nil {
		return err
	}

	// A number change must un-verify — otherwise swapping to a new number would
	// keep the old verification standing.
	if _, err := s.db.Exec(ctx,
		`INSERT INTO connect_onboarding (user_id, phone) VALUES ($1, $2)
		 ON CONFLICT (user_id) DO UPDATE
		 SET phone = EXCLUDED.phone,
		     phone_verified = CASE WHEN connect_onboarding.phone = EXCLUDED.phone
		                           THEN connect_onboarding.phone_verified ELSE false END`,
		userID, p); err != nil {
		return fmt.Errorf("connect: store phone: %w", err)
	}

	if err := otpSvc.Issue(ctx, p, "", otp.PurposePhoneVerify, ip); err != nil {
		return err
	}
	// Issue succeeded but a previously-verified different number may have just
	// been reset — recompute so status reflects the pending state.
	if _, err := s.db.Exec(ctx, recomputeStatus, userID); err != nil {
		return err
	}
	return nil
}

// ConfirmPhoneVerification checks the submitted code against the stored number
// and flips phone_verified on success.
func (s *Service) ConfirmPhoneVerification(ctx context.Context, userID, code, ip string, otpSvc *otp.Service) (OnboardingStatus, error) {
	if otpSvc == nil {
		return OnboardingStatus{}, ErrPhoneVerifyUnavailable
	}
	var phone string
	err := s.db.QueryRow(ctx,
		`SELECT phone FROM connect_onboarding WHERE user_id = $1 AND phone IS NOT NULL`, userID).Scan(&phone)
	if errors.Is(err, pgx.ErrNoRows) {
		return OnboardingStatus{}, ErrNoPhonePending
	}
	if err != nil {
		return OnboardingStatus{}, fmt.Errorf("connect: read phone: %w", err)
	}
	if err := otpSvc.Verify(ctx, phone, otp.PurposePhoneVerify, code, ip); err != nil {
		return OnboardingStatus{}, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return OnboardingStatus{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`UPDATE connect_onboarding SET phone_verified = true WHERE user_id = $1`, userID); err != nil {
		return OnboardingStatus{}, fmt.Errorf("connect: mark phone_verified: %w", err)
	}
	if _, err := tx.Exec(ctx, recomputeStatus, userID); err != nil {
		return OnboardingStatus{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OnboardingStatus{}, err
	}

	_ = s.audit(ctx, userID, "connect.phone.verified", ip, map[string]any{"phone": maskPhone(phone)})
	return s.GetStatus(ctx, userID)
}

// maskPhone keeps the audit row useful without storing the full number.
func maskPhone(p string) string {
	if len(p) <= 4 {
		return "****"
	}
	return strings.Repeat("*", len(p)-4) + p[len(p)-4:]
}

// WithPhoneOTP attaches the SMS-delivering OTP service; without it the phone
// endpoints answer 503.
func (h *Handler) WithPhoneOTP(svc *otp.Service) *Handler {
	h.phoneOTP = svc
	return h
}

// RequestPhoneCode — POST /api/v1/connect/onboarding/phone/request
// (authenticated). Body: {"phone": "+234…"}.
func (h *Handler) RequestPhoneCode(c *gin.Context) {
	var req struct {
		Phone string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Phone) == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "phone is required"})
		return
	}
	err := h.svc.RequestPhoneVerification(c.Request.Context(), ginutil.UserID(c), req.Phone, c.ClientIP(), h.phoneOTP)
	if err != nil {
		writePhoneErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"sent": true})
}

// VerifyPhoneCode — POST /api/v1/connect/onboarding/phone/verify
// (authenticated). Body: {"code": "123456"}.
func (h *Handler) VerifyPhoneCode(c *gin.Context) {
	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Code) == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "code is required"})
		return
	}
	st, err := h.svc.ConfirmPhoneVerification(c.Request.Context(), ginutil.UserID(c), req.Code, c.ClientIP(), h.phoneOTP)
	if err != nil {
		writePhoneErr(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

func writePhoneErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrPhoneVerifyUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{keyError: "phone verification unavailable"})
	case errors.Is(err, ErrInvalidPhone):
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid phone number"})
	case errors.Is(err, ErrNoPhonePending):
		c.JSON(http.StatusBadRequest, gin.H{keyError: "request a verification code first"})
	case errors.Is(err, otp.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, gin.H{keyError: "too many attempts — try again later"})
	case errors.Is(err, otp.ErrExpired), errors.Is(err, otp.ErrTooManyAttempts):
		c.JSON(http.StatusBadRequest, gin.H{keyError: "code expired — request a new one"})
	case errors.Is(err, otp.ErrInvalidCode):
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid code"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}
