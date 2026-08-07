package rtc

import (
	"bytes"
	"compress/zlib"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"time"
)

// agora.go — Agora AccessToken2 builder (the "007…" token format).
//
// Implements Agora's AccessToken2 algorithm using ONLY the Go standard library.
// Reference: Agora's official Go token builder (AgoraDynamicKey / RtcTokenBuilder2)
// and the AccessToken2 wire format documentation.
//
// ── AccessToken2 wire format (field order, citing the spec) ───────────────────
//
// Version prefix: the ASCII string "007".
//
// Signed content (the bytes that the HMAC is computed over), in order:
//   1. appID            : raw bytes of the 32-char hex App ID
//   2. issueTs          : uint32 LE — token issue time (unix seconds)
//   3. expire           : uint32 LE — seconds-from-issue until the whole token expires
//   4. salt             : uint32 LE — random salt
//   5. services map     : uint16 LE service-count, then each service serialized
//
// Each service (here: ServiceRtc, type = 1) serializes as:
//   - serviceType       : uint16 LE (RTC = 1)
//   - privileges map    : uint16 LE privilege-count, then for each:
//                           privilegeId : uint16 LE
//                           expire      : uint32 LE (seconds-from-issue)
//   - channelName       : uint16 LE length + raw bytes
//   - uid               : uint16 LE length + raw bytes (stringified uid; "" = wildcard)
//
// Signing key derivation (Agora AccessToken2 getSign(), two HMAC-SHA256 steps):
//   val     = HMAC-SHA256(key = LE(issueTs), msg = appCertificate)
//   signKey = HMAC-SHA256(key = LE(salt),    msg = val)
// Signature over the message:
//   signature = HMAC-SHA256(key = signKey, msg = message)
// (This matches AgoraIO/Tools AccessToken2.go getSign + the final HMAC over the
//  packed message. The key is the issueTs/salt bytes; the App Certificate is the
//  first message — NOT the other way around.)
//
// Packed token (before the "007" prefix + base64):
//   - signature         : uint16 LE length + raw HMAC bytes
//   - appID             : uint16 LE length + raw bytes
//   - issueTs           : uint32 LE
//   - expire            : uint32 LE
//   - salt              : uint32 LE
//   - services          : uint16 LE count + each service block (as signed above)
// then zlib-compressed, base64-StdEncoding'd, and prefixed with "007".
//
// VALIDATION: agora_test.go builds a token with fixed (issueTs, salt) inputs,
// base64-decodes + zlib-inflates + unpacks every field, and independently
// re-derives the signature from the spec formula above — proving the packing is
// round-trippable and the signing matches the spec as written. To CERTIFY
// byte-for-byte against Agora's servers, fill the known-answer vector in
// agora_test.go (TestAgoraKnownAnswer) with output from the official
// github.com/AgoraIO/Tools builder for the same fixed inputs, or validate a live
// channel join. VideoSDK (videosdk.go) is the high-confidence fallback meanwhile.

const (
	agoraVersion = "007"

	// ServiceRtc is the Agora service type id for RTC.
	agoraServiceRtc uint16 = 1

	// RTC privileges (AccessToken2 privilege ids).
	agoraPrivJoinChannel        uint16 = 1
	agoraPrivPublishAudioStream uint16 = 2
	agoraPrivPublishVideoStream uint16 = 3
	agoraPrivPublishDataStream  uint16 = 4
)

// ErrAgoraMissingCreds is returned when the App ID or Certificate is empty.
var ErrAgoraMissingCreds = errors.New("rtc/agora: app id and certificate required")

// putString writes a uint16 LE length-prefixed string into buf.
func putString(buf *bytes.Buffer, s string) {
	_ = binary.Write(buf, binary.LittleEndian, uint16(len(s)))
	buf.WriteString(s)
}

// putU16 / putU32 write little-endian integers.
func putU16(buf *bytes.Buffer, v uint16) { _ = binary.Write(buf, binary.LittleEndian, v) }
func putU32(buf *bytes.Buffer, v uint32) { _ = binary.Write(buf, binary.LittleEndian, v) }

// packService serializes the RTC service block (privileges + channel + uid).
func packAgoraService(channel, uid string, expire uint32) []byte {
	var b bytes.Buffer
	putU16(&b, agoraServiceRtc)

	// Privilege map: join + publish audio/video/data, each valid until `expire`.
	privs := []uint16{
		agoraPrivJoinChannel,
		agoraPrivPublishAudioStream,
		agoraPrivPublishVideoStream,
		agoraPrivPublishDataStream,
	}
	putU16(&b, uint16(len(privs)))
	for _, p := range privs {
		putU16(&b, p)
		putU32(&b, expire)
	}
	putString(&b, channel)
	putString(&b, uid)
	return b.Bytes()
}

// agoraSign derives the signing key from the App Certificate via Agora's two-step
// HMAC (keyed by issueTs then salt) and signs the message. Matches AccessToken2
// getSign():
//
//	val     = HMAC-SHA256(key = LE(issueTs), msg = appCert)
//	signKey = HMAC-SHA256(key = LE(salt),    msg = val)
//	sig     = HMAC-SHA256(key = signKey,     msg = message)
func agoraSign(appCert string, issueTs, salt uint32, msg []byte) []byte {
	tsBuf := new(bytes.Buffer)
	putU32(tsBuf, issueTs)
	mac1 := hmac.New(sha256.New, tsBuf.Bytes()) // key = issueTs bytes
	mac1.Write([]byte(appCert))                 // msg = appCert
	val := mac1.Sum(nil)

	saltBuf := new(bytes.Buffer)
	putU32(saltBuf, salt)
	mac2 := hmac.New(sha256.New, saltBuf.Bytes()) // key = salt bytes
	mac2.Write(val)                               // msg = val
	signKey := mac2.Sum(nil)

	mac3 := hmac.New(sha256.New, signKey) // key = signKey
	mac3.Write(msg)                       // msg = packed message
	return mac3.Sum(nil)
}

// BuildAgoraRTCToken builds an AccessToken2 "007…" RTC token granting join +
// publish (audio/video/data) on `channel` for `uid` (stringified; "" = wildcard),
// valid for ttl. stdlib only.
func BuildAgoraRTCToken(appID, appCertificate, channel, uid string, ttl time.Duration) (string, error) {
	if appID == "" || appCertificate == "" {
		return "", ErrAgoraMissingCreds
	}
	issueTs := uint32(time.Now().Unix())
	expire := uint32(ttl.Seconds())

	// Random salt (uint32).
	var saltBytes [4]byte
	if _, err := rand.Read(saltBytes[:]); err != nil {
		return "", err
	}
	salt := binary.LittleEndian.Uint32(saltBytes[:])

	return buildAgoraRTCTokenAt(appID, appCertificate, channel, uid, issueTs, expire, salt)
}

// buildAgoraRTCTokenAt is the deterministic core (issueTs/expire/salt injected) so
// it can be exercised by a known-answer / round-trip test. Callers that need a live
// token use BuildAgoraRTCToken, which supplies now() + a random salt.
func buildAgoraRTCTokenAt(appID, appCertificate, channel, uid string, issueTs, expire, salt uint32) (string, error) {
	if appID == "" || appCertificate == "" {
		return "", ErrAgoraMissingCreds
	}
	service := packAgoraService(channel, uid, expire)

	// Signed message: appID, issueTs, expire, salt, service-count + services.
	var msg bytes.Buffer
	putString(&msg, appID)
	putU32(&msg, issueTs)
	putU32(&msg, expire)
	putU32(&msg, salt)
	putU16(&msg, 1) // one service (RTC)
	msg.Write(service)

	signature := agoraSign(appCertificate, issueTs, salt, msg.Bytes())

	// Packed token: signature (uint16-len-prefixed) then the signed message.
	var packed bytes.Buffer
	putString(&packed, string(signature))
	packed.Write(msg.Bytes())

	// zlib compress then base64-StdEncoding, prefixed with the version.
	var zbuf bytes.Buffer
	zw := zlib.NewWriter(&zbuf)
	if _, err := zw.Write(packed.Bytes()); err != nil {
		_ = zw.Close()
		return "", err
	}
	if err := zw.Close(); err != nil {
		return "", err
	}
	return agoraVersion + base64.StdEncoding.EncodeToString(zbuf.Bytes()), nil
}
