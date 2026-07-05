package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
	"time"
)

func sigFor(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func TestVerify(t *testing.T) {
	secret, body := "whsec_123", []byte(`{"id":"evt_1","type":"order.filled"}`)
	good := sigFor(secret, body)

	if !Verify(secret, body, good) {
		t.Error("valid signature rejected")
	}
	if Verify(secret, body, good[:len(good)-2]+"00") {
		t.Error("tampered signature accepted")
	}
	if Verify("wrong", body, good) {
		t.Error("wrong secret accepted")
	}
	if Verify(secret, []byte(`{"id":"evt_2"}`), good) {
		t.Error("body tamper accepted")
	}
	if Verify("", body, good) || Verify(secret, body, "") {
		t.Error("empty secret/signature accepted")
	}
}

func TestFreshTimestamp(t *testing.T) {
	now := strconv.FormatInt(time.Now().Unix(), 10)
	old := strconv.FormatInt(time.Now().Add(-10*time.Minute).Unix(), 10)

	if !FreshTimestamp(now, 5*time.Minute) {
		t.Error("current timestamp rejected")
	}
	if FreshTimestamp(old, 5*time.Minute) {
		t.Error("stale timestamp accepted")
	}
	if FreshTimestamp("not-a-number", 5*time.Minute) {
		t.Error("garbage timestamp accepted")
	}
}
