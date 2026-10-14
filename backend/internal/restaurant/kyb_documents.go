package restaurant

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// kyb_documents.go — backend-owned presigned uploads for KYB documents.
//
// Before this, restaurant_kyb_documents.file_url held whatever string the client
// sent, so an owner could only paste a link to a file hosted elsewhere, and the
// reviewer console never listed documents at all (AdminListApplications returned
// an empty array). Now:
//  1. The owner asks POST /restaurant/:id/kyb/documents/presign for an upload URL.
//     The backend verifies the caller may manage banking for that outlet, chooses
//     the object key (restaurant/<id>/kyb/<doc_type>/<rand><ext>) and binds the
//     Content-Type into the signature, so the client cannot pick where a file
//     lands or smuggle another type.
//  2. The client PUTs straight to R2, then records the returned key through the
//     existing POST /kyb/documents. AddKYBDocument only accepts a key under THIS
//     restaurant's prefix, so one outlet cannot attach another's object.
//  3. The reviewer console receives short-lived signed GET URLs for stored keys
//     (the bucket is private); pasted http(s) links pass through untouched.
//
// file_url keeps holding both shapes, exactly like association.logo_url: a value
// with a scheme is a link, a value without one is an object key we minted.

const (
	// kybPresignTTL bounds how long an issued upload URL is valid.
	kybPresignTTL = 10 * time.Minute
	// kybViewTTL bounds a reviewer download URL (same window as estate documents).
	kybViewTTL = 60 * time.Minute
)

// ErrKYBUploadsUnavailable means R2 is unset or failed its write probe. Callers
// map it to 503 so the app can offer the paste-a-link fallback instead of a retry
// loop that cannot succeed.
var ErrKYBUploadsUnavailable = errors.New("restaurant: document uploads are not configured")

// kybDocTypeRE keeps doc_type safe to use as an object-key path segment. It is
// narrower than the column's CHECK (2-64 chars) on purpose: a lowercase slug.
var kybDocTypeRE = regexp.MustCompile(`^[a-z][a-z0-9_]{1,63}$`)

// kybContentTypeByExt is both the extension allowlist and the extension→type
// binding: the declared Content-Type must match the file's extension, so a
// ".pdf" cannot be signed as image/png or the reverse.
var kybContentTypeByExt = map[string]string{
	".pdf":  "application/pdf",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
}

// errKYBBadFileRef is returned for a document reference that is neither an
// http(s) link nor a key minted for this restaurant.
var errKYBBadFileRef = errors.New("restaurant: file_url must be an http(s) link or a document uploaded for this restaurant")

// canonicalRestaurantID lower-cases and validates a restaurant id so a key minted
// from the URL parameter always matches the id Postgres returns (restaurant_id::text
// is canonical lower-case) when the reviewer console later resolves it.
func canonicalRestaurantID(id string) (string, error) {
	u, err := uuid.Parse(strings.TrimSpace(id))
	if err != nil {
		return "", errors.New("restaurant: invalid restaurant id")
	}
	return u.String(), nil
}

// kybKeyPrefix is the object-key prefix every document key for a restaurant starts with.
func kybKeyPrefix(restaurantID string) string {
	return "restaurant/" + restaurantID + "/kyb/"
}

// classifyKYBFileRef validates a submitted document reference for restaurantID and
// reports whether it is an object key (true) or an external link (false).
func classifyKYBFileRef(restaurantID, ref string) (isKey bool, err error) {
	ref = strings.TrimSpace(ref)
	if u, perr := url.Parse(ref); perr == nil && u.Scheme != "" {
		// A scheme means a link. Only web links are allowed: the reviewer console
		// renders this as an <a href>, so javascript:/data:/r2:// must never get in.
		if (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" {
			return false, nil
		}
		return false, errKYBBadFileRef
	}
	if !strings.HasPrefix(ref, kybKeyPrefix(restaurantID)) || strings.Contains(ref, "..") {
		return false, errKYBBadFileRef
	}
	return true, nil
}

// kybDocKey builds the server-controlled object key for an upload.
func kybDocKey(restaurantID, docType, ext string) string {
	return kybKeyPrefix(restaurantID) + docType + "/" + cryptox.RandHex(16) + ext
}

// KYBDocumentPresign is what the client needs to PUT a document to R2.
type KYBDocumentPresign struct {
	UploadURL   string `json:"upload_url"`   // presigned PUT URL (short-lived)
	ObjectKey   string `json:"object_key"`   // send back as file_url when recording the document
	ContentType string `json:"content_type"` // the client MUST send this exact header on the PUT
	ExpiresIn   int    `json:"expires_in"`   // seconds
	Method      string `json:"method"`       // always "PUT"
}

// PresignKYBDocument mints a presigned upload URL for one KYB document (owner only).
func (s *Service) PresignKYBDocument(ctx context.Context, restaurantID, userID, docType, fileName, contentType string) (*KYBDocumentPresign, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageBanking); err != nil {
		return nil, err
	}
	docType = strings.TrimSpace(docType)
	if !kybDocTypeRE.MatchString(docType) {
		return nil, errors.New("restaurant: invalid doc_type")
	}
	ext := strings.ToLower(path.Ext(strings.TrimSpace(fileName)))
	want, ok := kybContentTypeByExt[ext]
	if !ok {
		return nil, errors.New("restaurant: unsupported file extension (use PDF, PNG, JPG or WEBP)")
	}
	if ct := strings.ToLower(strings.TrimSpace(contentType)); ct != want {
		return nil, errors.New("restaurant: content type does not match the file extension")
	}
	cur, _, err := s.loadKYB(ctx, restaurantID)
	if err != nil {
		return nil, err
	}
	if !editableKYB(cur.Status) {
		return nil, fmt.Errorf("restaurant: KYB cannot be edited while %s", cur.Status)
	}

	if s.kybPresigner == nil || !s.kybPresigner.Configured() {
		return nil, ErrKYBUploadsUnavailable
	}
	// Configured() only proves the variables are non-empty; a wrong bucket or a
	// read-only token still signs and then fails at the client's PUT. The probe is
	// cached, and the precise cause goes to the log, never to the client.
	if err := s.kybPresigner.Healthy(ctx); err != nil {
		log.Printf("[restaurant] R2 write probe failed, KYB document uploads disabled until R2_* config is fixed: %v", err)
		return nil, ErrKYBUploadsUnavailable
	}

	rid, err := canonicalRestaurantID(restaurantID)
	if err != nil {
		return nil, err
	}
	key := kybDocKey(rid, docType, ext)
	u, err := s.kybPresigner.PresignPut(key, want, kybPresignTTL)
	if err != nil {
		return nil, ErrKYBUploadsUnavailable
	}
	return &KYBDocumentPresign{
		UploadURL:   u,
		ObjectKey:   key,
		ContentType: want,
		ExpiresIn:   int(kybPresignTTL.Seconds()),
		Method:      "PUT",
	}, nil
}

// PresignKYBDocument → POST /restaurant/:id/kyb/documents/presign (owner).
func (h *Handler) PresignKYBDocument(c *gin.Context) {
	userID := ginutil.UserID(c)
	var body struct {
		DocType     string `json:"doc_type" binding:"required"`
		FileName    string `json:"file_name" binding:"required"`
		ContentType string `json:"content_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.PresignKYBDocument(c.Request.Context(), c.Param("id"), userID, body.DocType, body.FileName, body.ContentType)
	if err != nil {
		if errors.Is(err, ErrKYBUploadsUnavailable) {
			// httperr.Msg masks 5xx text; the app keys its paste-a-link fallback off
			// this status, and the wording is safe to show.
			c.JSON(http.StatusServiceUnavailable, gin.H{keyError: "document uploads are not configured"})
			return
		}
		c.JSON(kybErrCode(err), gin.H{keyError: httperr.Msg(c, kybErrCode(err), err)})
		return
	}
	c.JSON(http.StatusOK, p)
}

// AdminApplicationDoc is one KYB document as the reviewer console lists it. The
// JSON shape matches frontend-admin's OnboardingDoc.
type AdminApplicationDoc struct {
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	URL      string `json:"url"`
	Verified bool   `json:"verified"` // no per-document verification store yet; always false
}

var kybDocLabels = map[string]struct{ kind, label string }{
	"cac_certificate":  {"cac", "CAC certificate"},
	"director_id":      {"id", "Director ID"},
	"proof_of_address": {"other", "Proof of address"},
	"utility_bill":     {"other", "Utility bill"},
}

// kybDocPresentation maps a doc_type onto the console's kind enum and a readable label.
func kybDocPresentation(docType string) (kind, label string) {
	if m, ok := kybDocLabels[docType]; ok {
		return m.kind, m.label
	}
	l := strings.ReplaceAll(docType, "_", " ")
	if l != "" {
		l = strings.ToUpper(l[:1]) + l[1:]
	}
	return "other", l
}

// kybDocsByRestaurant returns every restaurant's KYB documents with reviewer-usable
// URLs: stored keys become short-lived signed GETs, pasted links pass through. A
// document whose reference cannot be turned into a usable URL is skipped and logged
// rather than rendered as a dead link.
func (s *Service) kybDocsByRestaurant(ctx context.Context) (map[string][]AdminApplicationDoc, error) {
	rows, err := s.db.Query(ctx,
		`SELECT restaurant_id::text, doc_type, file_url FROM restaurant_kyb_documents ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]AdminApplicationDoc{}
	for rows.Next() {
		var restaurantID, docType, ref string
		if err := rows.Scan(&restaurantID, &docType, &ref); err != nil {
			return nil, err
		}
		isKey, cerr := classifyKYBFileRef(restaurantID, ref)
		if cerr != nil {
			log.Printf("[restaurant] skipping KYB document %s/%s: unusable reference", restaurantID, docType)
			continue
		}
		href := ref
		if isKey {
			if s.kybPresigner == nil || !s.kybPresigner.Configured() {
				log.Printf("[restaurant] cannot sign KYB document %s/%s: R2 not configured", restaurantID, docType)
				continue
			}
			signed, serr := s.kybPresigner.PresignGet(ref, kybViewTTL)
			if serr != nil {
				log.Printf("[restaurant] cannot sign KYB document %s/%s: %v", restaurantID, docType, serr)
				continue
			}
			href = signed
		}
		kind, label := kybDocPresentation(docType)
		out[restaurantID] = append(out[restaurantID], AdminApplicationDoc{Kind: kind, Label: label, URL: href})
	}
	return out, rows.Err()
}
