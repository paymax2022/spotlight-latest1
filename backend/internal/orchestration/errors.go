package orchestration

import "net/http"

// ErrorType is the normalized error taxonomy from the spec (§5.1, Appendix C).
type ErrorType string

const (
	ErrInvalidRequest      ErrorType = "invalid_request"
	ErrAuthentication      ErrorType = "authentication"
	ErrRateExpired         ErrorType = "rate_expired"
	ErrInsufficientFloat   ErrorType = "insufficient_float"
	ErrInsufficientBalance ErrorType = "insufficient_balance"
	ErrRoutingUnavailable  ErrorType = "routing_unavailable"
	ErrProviderError       ErrorType = "provider_error"
	ErrComplianceBlock     ErrorType = "compliance_block"
	ErrConflict            ErrorType = "conflict"
	ErrRateLimited         ErrorType = "rate_limited"
	ErrLimitExceeded       ErrorType = "limit_exceeded"
	ErrInternal            ErrorType = "internal"
)

// APIError is the normalized error envelope returned on all 4xx/5xx (§5.1).
type APIError struct {
	Type        ErrorType `json:"type"`
	Code        string    `json:"code"`
	Message     string    `json:"message"`
	Param       *string   `json:"param,omitempty"`
	ProviderRef *string   `json:"providerRef,omitempty"`
	RequestID   string    `json:"requestId,omitempty"`
}

func (e *APIError) Error() string { return e.Message }

// NewError builds an APIError.
func NewError(t ErrorType, code, message string) *APIError {
	return &APIError{Type: t, Code: code, Message: message}
}

// WithParam attaches the offending field name.
func (e *APIError) WithParam(p string) *APIError { e.Param = &p; return e }

// WithProviderRef attaches the upstream provider reference.
func (e *APIError) WithProviderRef(r string) *APIError { e.ProviderRef = &r; return e }

// HTTPStatus maps the normalized error type to an HTTP status code.
func (e *APIError) HTTPStatus() int {
	switch e.Type {
	case ErrInvalidRequest:
		return http.StatusBadRequest
	case ErrAuthentication:
		return http.StatusUnauthorized
	case ErrRateExpired, ErrConflict:
		return http.StatusConflict
	case ErrInsufficientFloat, ErrInsufficientBalance, ErrComplianceBlock, ErrRoutingUnavailable, ErrLimitExceeded:
		return http.StatusUnprocessableEntity
	case ErrRateLimited:
		return http.StatusTooManyRequests
	case ErrProviderError:
		return http.StatusBadGateway
	default:
		return http.StatusInternalServerError
	}
}

// asAPIError coerces any error into an APIError (internal by default).
func asAPIError(err error) *APIError {
	if err == nil {
		return nil
	}
	if ae, ok := err.(*APIError); ok {
		return ae
	}
	return NewError(ErrInternal, "internal_error", err.Error())
}
