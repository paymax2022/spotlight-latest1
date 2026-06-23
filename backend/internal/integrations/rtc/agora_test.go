package rtc

import (
	"bytes"
	"compress/zlib"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"io"
	"strings"
	"testing"
	"time"
)

// Fixed, deterministic inputs for the format/spec validation. The App ID and
// Certificate are throwaway 32-hex test values (NOT real credentials).
const (
	testAppID   = "0123456789abcdef0123456789abcdef"
	testAppCert = "fedcba9876543210fedcba9876543210"
	testChannel = "appt-9F2A41"
	testUID     = "100200300"
	testIssueTs = uint32(1700000000)
	testExpire  = uint32(3600)
	testSalt    = uint32(1)
)

// readString reads a uint16-LE length-prefixed string from r.
func readString(t *testing.T, r *bytes.Reader) []byte {
	t.Helper()
	var n uint16
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		t.Fatalf("read len: %v", err)
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(r, b); err != nil {
		t.Fatalf("read %d bytes: %v", n, err)
	}
	return b
}

func readU16(t *testing.T, r *bytes.Reader) uint16 {
	t.Helper()
	var v uint16
	if err := binary.Read(r, binary.LittleEndian, &v); err != nil {
		t.Fatalf("read u16: %v", err)
	}
	return v
}

func readU32(t *testing.T, r *bytes.Reader) uint32 {
	t.Helper()
	var v uint32
	if err := binary.Read(r, binary.LittleEndian, &v); err != nil {
		t.Fatalf("read u32: %v", err)
	}
	return v
}

// specSignature is an INDEPENDENT re-implementation of the AccessToken2 getSign
// formula (does NOT call agoraSign), so a deviation in the production signing path
// makes the round-trip test fail.
func specSignature(appCert string, issueTs, salt uint32, msg []byte) []byte {
	ts := make([]byte, 4)
	binary.LittleEndian.PutUint32(ts, issueTs)
	m1 := hmac.New(sha256.New, ts)
	m1.Write([]byte(appCert))
	val := m1.Sum(nil)

	s := make([]byte, 4)
	binary.LittleEndian.PutUint32(s, salt)
	m2 := hmac.New(sha256.New, s)
	m2.Write(val)
	signKey := m2.Sum(nil)

	m3 := hmac.New(sha256.New, signKey)
	m3.Write(msg)
	return m3.Sum(nil)
}

// TestAgoraTokenRoundTrip builds a deterministic token, fully unpacks it, asserts
// every field equals the input, and verifies the signature matches the spec
// formula independently. This proves the wire format is round-trippable and the
// signing path matches AccessToken2 getSign.
func TestAgoraTokenRoundTrip(t *testing.T) {
	tok, err := buildAgoraRTCTokenAt(testAppID, testAppCert, testChannel, testUID, testIssueTs, testExpire, testSalt)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if !strings.HasPrefix(tok, "007") {
		t.Fatalf("missing 007 version prefix: %q", tok[:min(6, len(tok))])
	}

	raw, err := base64.StdEncoding.DecodeString(tok[3:])
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	zr, err := zlib.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("zlib reader: %v", err)
	}
	inflated, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("inflate: %v", err)
	}
	_ = zr.Close()

	r := bytes.NewReader(inflated)
	sig := readString(t, r)
	if len(sig) != sha256.Size {
		t.Fatalf("signature length = %d, want %d", len(sig), sha256.Size)
	}
	// The remaining bytes after the signature are the signed message.
	msgStart := 2 + len(sig)
	msg := inflated[msgStart:]

	gotAppID := readString(t, r)
	if string(gotAppID) != testAppID {
		t.Errorf("appID = %q, want %q", gotAppID, testAppID)
	}
	if got := readU32(t, r); got != testIssueTs {
		t.Errorf("issueTs = %d, want %d", got, testIssueTs)
	}
	if got := readU32(t, r); got != testExpire {
		t.Errorf("expire = %d, want %d", got, testExpire)
	}
	if got := readU32(t, r); got != testSalt {
		t.Errorf("salt = %d, want %d", got, testSalt)
	}
	if got := readU16(t, r); got != 1 {
		t.Fatalf("service count = %d, want 1", got)
	}
	if got := readU16(t, r); got != agoraServiceRtc {
		t.Errorf("service type = %d, want %d (RTC)", got, agoraServiceRtc)
	}
	privCount := readU16(t, r)
	if privCount != 4 {
		t.Errorf("privilege count = %d, want 4 (join + publish audio/video/data)", privCount)
	}
	for i := uint16(0); i < privCount; i++ {
		_ = readU16(t, r) // privilege id
		if got := readU32(t, r); got != testExpire {
			t.Errorf("privilege[%d] expire = %d, want %d", i, got, testExpire)
		}
	}
	if got := readString(t, r); string(got) != testChannel {
		t.Errorf("channel = %q, want %q", got, testChannel)
	}
	if got := readString(t, r); string(got) != testUID {
		t.Errorf("uid = %q, want %q", got, testUID)
	}

	// Independent spec-formula signature must equal the embedded signature.
	want := specSignature(testAppCert, testIssueTs, testSalt, msg)
	if !hmac.Equal(sig, want) {
		t.Errorf("embedded signature does not match the AccessToken2 spec formula\n got=%x\nwant=%x", sig, want)
	}
}

// TestAgoraTokenDeterministic confirms identical inputs yield an identical token
// (a property the unit test relies on and a sign the build has no hidden state).
func TestAgoraTokenDeterministic(t *testing.T) {
	a, err := buildAgoraRTCTokenAt(testAppID, testAppCert, testChannel, testUID, testIssueTs, testExpire, testSalt)
	if err != nil {
		t.Fatalf("build a: %v", err)
	}
	b, err := buildAgoraRTCTokenAt(testAppID, testAppCert, testChannel, testUID, testIssueTs, testExpire, testSalt)
	if err != nil {
		t.Fatalf("build b: %v", err)
	}
	if a != b {
		t.Errorf("non-deterministic token for fixed inputs:\n a=%s\n b=%s", a, b)
	}
}

// TestAgoraMissingCreds confirms the disabled path returns the sentinel and never
// a fabricated token.
func TestAgoraMissingCreds(t *testing.T) {
	if _, err := BuildAgoraRTCToken("", testAppCert, testChannel, testUID, time.Hour); err != ErrAgoraMissingCreds {
		t.Errorf("empty appID: err = %v, want ErrAgoraMissingCreds", err)
	}
	if _, err := BuildAgoraRTCToken(testAppID, "", testChannel, testUID, time.Hour); err != ErrAgoraMissingCreds {
		t.Errorf("empty appCert: err = %v, want ErrAgoraMissingCreds", err)
	}
}

// TestAgoraKnownAnswer is the byte-for-byte certification against Agora's official
// builder. It is SKIPPED until the vector is filled: run the official
// github.com/AgoraIO/Tools RtcTokenBuilder2 with EXACTLY the fixed inputs above
// (testAppID/testAppCert/testChannel/testUID, issueTs=1700000000, expire=3600,
// salt=1, privileges join+publish audio/video/data) and paste its output into
// wantToken. Once filled, this asserts our builder is byte-identical to Agora's.
// (Until then, TestAgoraTokenRoundTrip guards the wire format + signing spec.)
func TestAgoraKnownAnswer(t *testing.T) {
	// Generated by github.com/AgoraIO/Tools accesstoken2 (v0.0.0-20250825033728-374cd21f5220)
	// with IssueTs=1700000000, Salt=1, Expire=3600, channel="appt-9F2A41", uid="100200300".
	// Byte-for-byte identical to our buildAgoraRTCTokenAt — certifies wire format parity.
	const wantToken = "007eJxSYNiRu5qp6O5yY/ZkhqaLiWEX1ziELEo6bfufr2oVu8js+PcKDAaGRsYmpmbmFpaJSckpqWnofIaPwakCfAwMjAwgzMjAwsDIAOIzgUlmMMkCJrkZEgsKSnQt3YwcTQw5GQwNDIwMDIwNDAABAAD//2Q3Hxk="
	if wantToken == "" {
		t.Skip("known-answer vector not set — see comment; round-trip test covers format/signing")
	}
	got, err := buildAgoraRTCTokenAt(testAppID, testAppCert, testChannel, testUID, testIssueTs, testExpire, testSalt)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if got != wantToken {
		t.Errorf("token mismatch vs official builder:\n got=%s\nwant=%s", got, wantToken)
	}
}
