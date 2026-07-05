package store

import (
	"testing"

	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/engine"
)

func findPos(ps []domain.Position, symbol string) (domain.Position, bool) {
	for _, p := range ps {
		if p.Symbol == symbol {
			return p, true
		}
	}
	return domain.Position{}, false
}

func TestExecuteBuyUpdatesPositionCashAndHistory(t *testing.T) {
	s := New()
	investBefore := s.Portfolio().InvestableBalance.Amount

	usdc, _ := s.Asset("ast_usdc")
	q := engine.BuildQuote(usdc, "buy", "fiat", 1_000_00, "NGN", true) // ₦1,000

	order, ee := s.ExecuteBuy(q)
	if ee != nil {
		t.Fatalf("ExecuteBuy error: %v", ee)
	}
	if order.Status != "Filled" || order.Side != "buy" {
		t.Fatalf("order = %+v, want Filled buy", order)
	}

	// Cash debited by exactly the total (fees included).
	if got := s.Portfolio().InvestableBalance.Amount; got != investBefore-q.TotalFiat.Amount {
		t.Errorf("investable = %d, want %d", got, investBefore-q.TotalFiat.Amount)
	}
	// New holding created with the bought quantity.
	pos, ok := findPos(s.Positions(), "USDC")
	if !ok || pos.Quantity.Amount != q.Crypto.Amount {
		t.Fatalf("USDC position = %+v ok=%v, want qty %d", pos, ok, q.Crypto.Amount)
	}
	// Recorded in history.
	found := false
	for _, tx := range s.Transactions("") {
		if tx.Reference == order.Reference {
			found = true
		}
	}
	if !found {
		t.Errorf("order %s not in transaction history", order.Reference)
	}
}

func TestExecuteSellCreditsCashAndReducesHolding(t *testing.T) {
	s := New()
	usdt, _ := s.Asset("ast_usdt")
	before, _ := findPos(s.Positions(), "USDT")
	investBefore := s.Portfolio().InvestableBalance.Amount

	q := engine.BuildQuote(usdt, "sell", "crypto", 100_000_000, "NGN", true) // 100 USDT (6dp)
	order, ee := s.ExecuteSell(q)
	if ee != nil {
		t.Fatalf("ExecuteSell error: %v", ee)
	}
	if got := s.Portfolio().InvestableBalance.Amount; got != investBefore+q.TotalFiat.Amount {
		t.Errorf("investable = %d, want %d", got, investBefore+q.TotalFiat.Amount)
	}
	after, _ := findPos(s.Positions(), "USDT")
	if after.Quantity.Amount != before.Quantity.Amount-100_000_000 {
		t.Errorf("USDT qty = %d, want %d", after.Quantity.Amount, before.Quantity.Amount-100_000_000)
	}
	_ = order
}

func TestExecuteBuyInsufficientBalance(t *testing.T) {
	s := New()
	btc, _ := s.Asset("ast_btc")
	// ₦1,000,000 is within BTC limits but exceeds the ~₦842,500 investable cash.
	q := engine.BuildQuote(btc, "buy", "fiat", 1_000_000_00, "NGN", true)
	_, ee := s.ExecuteBuy(q)
	if ee == nil || ee.Type != "insufficient_balance" {
		t.Fatalf("ee = %v, want insufficient_balance", ee)
	}
}

func TestExecuteBuyLimitExceeded(t *testing.T) {
	s := New()
	sol, _ := s.Asset("ast_sol")
	// ₦11,000,000 exceeds SOL's ₦10,000,000 max order (checked before balance).
	q := engine.BuildQuote(sol, "buy", "fiat", 11_000_000_00, "NGN", true)
	_, ee := s.ExecuteBuy(q)
	if ee == nil || ee.Type != "limit_exceeded" {
		t.Fatalf("ee = %v, want limit_exceeded", ee)
	}
}

func TestExecuteSwapMovesBetweenAssets(t *testing.T) {
	s := New()
	usdt, _ := s.Asset("ast_usdt")
	usdc, _ := s.Asset("ast_usdc")
	beforeFrom, _ := findPos(s.Positions(), "USDT")

	q := engine.BuildSwapQuote(usdt, usdc, 100_000_000) // 100 USDT
	res, ee := s.ExecuteSwap(q)
	if ee != nil {
		t.Fatalf("ExecuteSwap error: %v", ee)
	}
	if res.Status != "Filled" {
		t.Fatalf("res status = %q, want Filled", res.Status)
	}
	afterFrom, _ := findPos(s.Positions(), "USDT")
	if afterFrom.Quantity.Amount != beforeFrom.Quantity.Amount-100_000_000 {
		t.Errorf("USDT qty = %d, want %d", afterFrom.Quantity.Amount, beforeFrom.Quantity.Amount-100_000_000)
	}
	toPos, ok := findPos(s.Positions(), "USDC")
	if !ok || toPos.Quantity.Amount != q.To.Amount {
		t.Errorf("USDC qty = %+v, want %d", toPos, q.To.Amount)
	}
}

func TestUpdateTransactionStatus(t *testing.T) {
	s := New()
	usdc, _ := s.Asset("ast_usdc")
	order, ee := s.ExecuteBuy(engine.BuildQuote(usdc, "buy", "fiat", 1_000_00, "NGN", true))
	if ee != nil {
		t.Fatalf("ExecuteBuy error: %v", ee)
	}

	if !s.UpdateTransactionStatus(order.Reference, "Reversed") {
		t.Fatal("UpdateTransactionStatus returned false for a real reference")
	}
	tx, ok := s.Transaction(order.Reference)
	if !ok || tx.Status != "Reversed" {
		t.Fatalf("status = %q ok=%v, want Reversed", tx.Status, ok)
	}
	last := tx.StatusHistory[len(tx.StatusHistory)-1]
	if last.Status != "Reversed" {
		t.Errorf("last status event = %q, want Reversed", last.Status)
	}
	if s.UpdateTransactionStatus("PMX-CR-does-not-exist", "Filled") {
		t.Error("expected false for unknown reference")
	}
}

func TestWithdrawalAndReversal(t *testing.T) {
	s := New()
	usdt, _ := s.Asset("ast_usdt")
	before, _ := findPos(s.Positions(), "USDT")

	res, ee := s.RecordWithdrawal("USDT", "Tron (TRC-20)", "TXyz", 100_000_000, 50_000, 160_500_00)
	if ee != nil {
		t.Fatalf("RecordWithdrawal error: %v", ee)
	}
	afterWd, _ := findPos(s.Positions(), "USDT")
	if afterWd.Quantity.Amount != before.Quantity.Amount-100_000_000 {
		t.Fatalf("post-withdraw qty = %d, want %d", afterWd.Quantity.Amount, before.Quantity.Amount-100_000_000)
	}

	if !s.ReverseWithdrawal(res.Reference) {
		t.Fatal("ReverseWithdrawal returned false")
	}
	afterRev, _ := findPos(s.Positions(), "USDT")
	if afterRev.Quantity.Amount != before.Quantity.Amount {
		t.Errorf("post-reversal qty = %d, want restored %d", afterRev.Quantity.Amount, before.Quantity.Amount)
	}
	tx, _ := s.Transaction(res.Reference)
	if tx.Status != "WithdrawalFailed" {
		t.Errorf("status = %q, want WithdrawalFailed", tx.Status)
	}
	if s.ReverseWithdrawal(res.Reference) {
		t.Error("double reversal should be rejected")
	}
}

func TestPortfolioAggregationConsistent(t *testing.T) {
	s := New()
	p := s.Portfolio()
	var sumValue, sumCost int64
	for _, pos := range p.Positions {
		sumValue += pos.MarketValue.Amount
		sumCost += pos.CostBasis.Amount
	}
	if p.TotalValue.Amount != sumValue {
		t.Errorf("totalValue = %d, want %d", p.TotalValue.Amount, sumValue)
	}
	if p.TotalCostBasis.Amount != sumCost {
		t.Errorf("totalCost = %d, want %d", p.TotalCostBasis.Amount, sumCost)
	}
	if p.TotalGainLoss.Amount != sumValue-sumCost {
		t.Errorf("gain = %d, want %d", p.TotalGainLoss.Amount, sumValue-sumCost)
	}
}
