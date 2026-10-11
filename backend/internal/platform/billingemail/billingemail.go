// Package billingemail decides which email address a Paystack payment is made
// against, and answers the request when there is none that Paystack will take.
//
// Paystack requires a routable email on every transaction. The rule, on every
// card-checkout rail:
//
//  1. the email the user registered with, if it passes IsBillable;
//  2. otherwise the email supplied with this checkout request, if it passes;
//  3. otherwise the request is answered 422 {"error":"email_required"} and the
//     client asks the user for one. There is no placeholder address.
//
// IsBillable mirrors frontend-web's isBillableEmail (src/server/wallet) so the
// Go and Next.js planes agree on what a usable address is.
package billingemail

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

// ErrEmailRequired means neither the account nor the request supplied an email
// Paystack will accept.
var ErrEmailRequired = errors.New("billingemail: a valid email address is required")

// CodeEmailRequired is the machine-readable error code clients key their
// "enter your email" prompt off.
const CodeEmailRequired = "email_required"

const messageEmailRequired = "A valid email address is needed to pay. Enter one to continue."

var shape = regexp.MustCompile(`^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$`)

// nonRoutableTLDs are addresses the platform itself generates for fixtures and
// placeholders; Paystack answers them with a generic 400.
var nonRoutableTLDs = map[string]bool{
	"internal": true, "local": true, "localhost": true, "test": true, "invalid": true, "example": true,
}

// IsBillable reports whether Paystack will accept email as a customer address.
func IsBillable(email string) bool {
	email = strings.TrimSpace(email)
	if email == "" || !shape.MatchString(email) {
		return false
	}
	tld := email[strings.LastIndex(email, ".")+1:]
	return !nonRoutableTLDs[strings.ToLower(tld)]
}

// Resolve applies the rule: the account's email if billable, else the supplied
// one if billable, else ErrEmailRequired. The result is trimmed.
func Resolve(accountEmail, supplied string) (string, error) {
	if e := strings.TrimSpace(accountEmail); IsBillable(e) {
		return e, nil
	}
	if e := strings.TrimSpace(supplied); IsBillable(e) {
		return e, nil
	}
	return "", ErrEmailRequired
}

// Require resolves the billing email for an authenticated request (the account
// email is the "user_email" the auth middleware stores on the context). When
// none is usable it writes the 422 email_required response and returns false;
// the caller must return without writing anything else. Call it BEFORE any
// quote, intent or ledger work so a missing email never leaves a half-started
// payment behind.
func Require(c *gin.Context, supplied string) (string, bool) {
	email, err := Resolve(c.GetString("user_email"), supplied)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": CodeEmailRequired, "message": messageEmailRequired})
		return "", false
	}
	return email, true
}
