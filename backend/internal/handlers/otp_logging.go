package handlers

import "log"

// logOTPFailure records an OTP failure WITHOUT the address or the code.
//
// The code never appears in a log line, an error string or a span — not at debug
// either. A code in a log is a credential in a log, readable by everyone with
// log access for as long as retention lasts, and log pipelines are not built to
// hold credentials.
//
// The address is omitted for the same reason the endpoint refuses to confirm
// account existence: an access log full of "otp issue failed for x@y.com" is a
// user list.
func logOTPFailure(op, purpose string, err error) {
	log.Printf("[otp] %s failed (purpose=%s): %v", op, purpose, err)
}
