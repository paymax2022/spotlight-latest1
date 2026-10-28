package finance

// BankAccountMasked is the only form of a bank account this API returns: the
// full account number and tax_info never leave the database.
type BankAccountMasked struct {
	BankName   *string `json:"bank_name"`
	Last4      *string `json:"account_last4"`
	IsVerified bool    `json:"is_verified"`
}

// last4 returns the final four characters of an account number (the whole value
// when shorter than four). Empty or nil input yields nil.
func last4(account *string) *string {
	if account == nil || *account == "" {
		return nil
	}
	r := []rune(*account)
	if len(r) > 4 {
		r = r[len(r)-4:]
	}
	s := string(r)
	return &s
}
