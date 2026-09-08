package handlers

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/otp"
	"spotlight/backend/internal/services"
)

// OTPHandler exposes the server-issued email OTP surface.
//
// The service is nil whenever the feature is off OR its configuration is
// incomplete (no pepper, no Brevo key). Both cases answer 503 rather than
// degrading: an OTP endpoint that half-works is a login system that half-works.
type OTPHandler struct {
	svc *otp.Service
	// reason is surfaced in the 503 body so an operator can tell "flag is off"
	// from "flag is on but the pepper is missing" without reading the logs of a
	// process they may not have access to.
	reason string
	// verifier confirms the account behind an address once a verify_email code is
	// redeemed. Nil means codes still verify but nothing is activated — which is
	// the correct behaviour for the login and password-reset purposes, and a
	// misconfiguration for verify_email (reported, never silent).
	verifier services.EmailVerifier
}

func NewOTPHandler(svc *otp.Service, reason string) *OTPHandler {
	return &OTPHandler{svc: svc, reason: reason}
}

// WithEmailVerifier wires account confirmation into the verify_email purpose.
func (h *OTPHandler) WithEmailVerifier(v services.EmailVerifier) *OTPHandler {
	h.verifier = v
	return h
}

func (h *OTPHandler) guard(c *gin.Context) bool {
	if h.svc == nil {
		reason := h.reason
		if reason == "" {
			reason = "feature_disabled"
		}
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
			"success": false, "error": reason, "feature": "otp_email",
		})
		return false
	}
	return true
}

// Deliberately permissive. This is a shape check to reject obvious junk before
// it costs a send, not an attempt to decide deliverability — RFC 5322 in a regex
// is a well-known way to reject valid addresses, and the provider is the real
// authority on whether an address exists.
var emailShape = regexp.MustCompile(`^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$`)

type otpRequestBody struct {
	Email   string `json:"email"`
	Name    string `json:"name"`
	Purpose string `json:"purpose"`
}

// RequestOTP — POST /api/auth/otp/request
//
// The response is IDENTICAL whether or not an account exists for the address,
// and the work done is identical too. Answering differently — or faster — for an
// unregistered address turns this endpoint into a user-enumeration oracle that
// hands over the whole user list to anyone willing to iterate. That is the most
// commonly shipped defect in OTP endpoints, and it is why this handler never
// looks the user up.
//
// The same reasoning covers errors: a rate-limited caller is told to wait
// (they need that, and they already know they asked), but a send failure
// returns the same 200 as a success. Reporting "delivery failed" would confirm
// the address is real and routable.
func (h *OTPHandler) RequestOTP(c *gin.Context) {
	if !h.guard(c) {
		return
	}
	var body otpRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	purpose := strings.TrimSpace(body.Purpose)
	if !emailShape.MatchString(email) || !otp.IsAllowedPurpose(purpose) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request"})
		return
	}

	const accepted = "if an account exists for that address, a code has been sent"

	err := h.svc.Issue(c.Request.Context(), email, strings.TrimSpace(body.Name), purpose, c.ClientIP())
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"success": true, "message": accepted,
			"expiresInSeconds": int(h.svc.TTL().Seconds())})
	case errors.Is(err, otp.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, gin.H{
			"success": false, "error": "please wait before requesting another code"})
	default:
		// Logged for operators, generic for the caller. The error never contains
		// the code — see email/brevo.go.
		logOTPFailure("issue", purpose, err)
		c.JSON(http.StatusOK, gin.H{"success": true, "message": accepted,
			"expiresInSeconds": int(h.svc.TTL().Seconds())})
	}
}

type otpVerifyBody struct {
	Email   string `json:"email"`
	Code    string `json:"code"`
	Purpose string `json:"purpose"`
}

// VerifyOTP — POST /api/auth/otp/verify
//
// A successful verification here proves control of the mailbox. It does NOT by
// itself sign anyone in: this endpoint reports the proof and nothing more.
// Session issue, email confirmation and password reset all live behind their own
// flows, and wiring them to consume this proof is a separate, deliberate change
// — see the note in app/otp_routes.go.
func (h *OTPHandler) VerifyOTP(c *gin.Context) {
	if !h.guard(c) {
		return
	}
	var body otpVerifyBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request"})
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	code := strings.TrimSpace(body.Code)
	purpose := strings.TrimSpace(body.Purpose)
	if email == "" || code == "" || purpose == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request"})
		return
	}

	err := h.svc.Verify(c.Request.Context(), email, purpose, code, c.ClientIP())
	switch {
	case err == nil:
		// The code is already consumed at this point. For verify_email that is
		// only half the job: the account still has to be confirmed in GoTrue, or
		// the user has proved control of their mailbox and still cannot log in.
		if purpose == otp.PurposeVerifyEmail {
			if h.verifier == nil {
				// The code was spent and nothing can act on it. Refusing loudly
				// beats a cheerful 200 that leaves the account unusable.
				logOTPFailure("verify", purpose, errors.New("no email verifier is wired"))
				c.JSON(http.StatusInternalServerError, gin.H{
					"success": false, "error": "could not activate your account, please request a new code"})
				return
			}
			confirmed, cErr := h.verifier.ConfirmEmail(c.Request.Context(), email)
			if cErr != nil {
				// The code is gone and the account is not confirmed. Say so: the
				// user's next step is a new code, and pretending this succeeded
				// would leave them unable to log in with no explanation.
				logOTPFailure("verify.confirm", purpose, cErr)
				c.JSON(http.StatusInternalServerError, gin.H{
					"success": false, "error": "could not activate your account, please request a new code"})
				return
			}
			// confirmed == false means there is no account for this address. That
			// fact is NOT returned. The request endpoint accepts any address on
			// purpose, so surfacing "there was nothing to confirm" would put the
			// enumeration oracle straight back — weakened by needing a valid code,
			// but there is no reason to hand it over. A client that just
			// registered knows what to do next; one that did not, does not need
			// to be told.
			_ = confirmed
			c.JSON(http.StatusOK, gin.H{"success": true, "verified": true, "purpose": purpose})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "verified": true, "purpose": purpose})
	case errors.Is(err, otp.ErrTooManyAttempts):
		c.JSON(http.StatusTooManyRequests, gin.H{
			"success": false, "error": "too many attempts, request a new code"})
	case errors.Is(err, otp.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, gin.H{
			"success": false, "error": "too many attempts, try again later"})
	case errors.Is(err, otp.ErrExpired):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "code expired, request a new code"})
	case errors.Is(err, otp.ErrInvalidCode):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid code"})
	default:
		logOTPFailure("verify", purpose, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "something went wrong"})
	}
}
