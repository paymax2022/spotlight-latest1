package maps

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/strutil"
)

// gazetteer.go — the PrivateGazetteer, our private store of VERIFIED internal
// points checked FIRST in the resolution chain (MAPSERVICE.md §6, MS-2).
// Properties (MS-4 / NDPA):
//   - PII-bearing. Any PII payload is encrypted at rest into encrypted_pii via the
//     injected Encryptor — never persisted in plaintext.
//   - Every READ (Lookup / ReverseLookup) writes an immutable access-log row to
//     map_gazetteer_access_log, recording who accessed which entry and on what basis.
//   - Never uploaded to OSM; results are tagged SourceGazetteer (zero external cost),
//     Confidence 1.0 (these are confirmed points), and Cacheable=true (they are OURS,
//     not third-party-licensed).
// All SQL is parameterized. H3/geog patterns mirror geo.go (PostGIS geography,
// ST_SetSRID/ST_MakePoint, ST_DWithin) and its string cell keys.

// reverseRadiusM is the small radius (metres) within which ReverseLookup accepts a
// verified point as a match for a coordinate. Kept tight: a gazetteer hit must be
// genuinely the same place, not just "nearby" (MAPSERVICE.md §6).
const reverseRadiusM = 75.0

// access-log basis values (map_gazetteer_access_log.basis).
const (
	accessBasisLookup  = "lookup"
	accessBasisReverse = "reverse"
)

// Gazetteer is the pgx-backed GazetteerStore.
type Gazetteer struct {
	pool *pgxpool.Pool
	enc  Encryptor
}

// NewGazetteer builds a PrivateGazetteer over map_gazetteer. If enc is nil a
// NoopEncryptor is used (dev/test only — production MUST inject a real AES key).
func NewGazetteer(pool *pgxpool.Pool, enc Encryptor) *Gazetteer {
	if enc == nil {
		enc = NoopEncryptor{}
	}
	return &Gazetteer{pool: pool, enc: enc}
}

// compile-time interface assertion: Gazetteer implements GazetteerStore EXACTLY.
var _ GazetteerStore = (*Gazetteer)(nil)

// Lookup finds a verified point by normalized address, preferring the same H3
// neighborhood when h3Cell is given, then falling back to a fuzzy (prefix/ILIKE)
// match. The best verified point is returned as a SourceGazetteer GeoResult. Every
// call writes an access-log row (MS-4).
func (g *Gazetteer) Lookup(ctx context.Context, normalizedAddr, h3Cell string) (GeoResult, bool, error) {
	if g == nil || g.pool == nil || normalizedAddr == "" {
		return GeoResult{}, false, nil
	}

	// 1. Exact normalized match. When an H3 cell is supplied, prefer points in the
	//    same coarse neighborhood (left(h3, coveragePrec) prefix), then fall back to
	//    an exact match anywhere. Ordering keeps the in-neighborhood point first.
	//    `verified_at DESC` breaks ties toward the most recently confirmed point.
	const exactQ = `
		SELECT id, lat, lng, normalized_addr, plus_code, h3
		FROM public.map_gazetteer
		WHERE normalized_addr = $1
		ORDER BY
			CASE WHEN $2 <> '' AND left(h3, $3) = left($2, $3) THEN 0 ELSE 1 END,
			verified_at DESC
		LIMIT 1`
	row := g.pool.QueryRow(ctx, exactQ, normalizedAddr, h3Cell, CellPrecisionCoverage)
	if res, id, ok := scanGazetteerPoint(row); ok {
		g.logAccess(ctx, id, accessBasisLookup)
		return res, true, nil
	}

	// 2. Fuzzy fallback: prefix / substring ILIKE. Anchored prefix first (cheap,
	//    index-friendly), and again preferring the same neighborhood when known.
	const fuzzyQ = `
		SELECT id, lat, lng, normalized_addr, plus_code, h3
		FROM public.map_gazetteer
		WHERE normalized_addr ILIKE $1 || '%' OR normalized_addr ILIKE '%' || $1 || '%'
		ORDER BY
			CASE WHEN $2 <> '' AND left(h3, $3) = left($2, $3) THEN 0 ELSE 1 END,
			CASE WHEN normalized_addr ILIKE $1 || '%' THEN 0 ELSE 1 END,
			verified_at DESC
		LIMIT 1`
	row = g.pool.QueryRow(ctx, fuzzyQ, normalizedAddr, h3Cell, CellPrecisionCoverage)
	if res, id, ok := scanGazetteerPoint(row); ok {
		g.logAccess(ctx, id, accessBasisLookup)
		return res, true, nil
	}
	return GeoResult{}, false, nil
}

// ReverseLookup finds the nearest verified point within reverseRadiusM of a
// coordinate, using ST_DWithin on the geography index (true metres). Access-logged.
func (g *Gazetteer) ReverseLookup(ctx context.Context, h3Cell string, lat, lng float64) (GeoResult, bool, error) {
	if g == nil || g.pool == nil {
		return GeoResult{}, false, nil
	}
	// $1=lat $2=lng $3=radius. ST_MakePoint takes (lng, lat) — mirrors .
	const q = `
		SELECT id, lat, lng, normalized_addr, plus_code, h3
		FROM public.map_gazetteer
		WHERE ST_DWithin(geog, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
		ORDER BY ST_Distance(geog, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) ASC
		LIMIT 1`
	row := g.pool.QueryRow(ctx, q, lat, lng, reverseRadiusM)
	if res, id, ok := scanGazetteerPoint(row); ok {
		g.logAccess(ctx, id, accessBasisReverse)
		return res, true, nil
	}
	return GeoResult{}, false, nil
}

// Upsert records a confirmed verified point (courier pin, saved place, …). The PII
// payload (the human address + JSON components) is encrypted into encrypted_pii;
// the H3 cell and plus code are derived/stored for proximity + display. On conflict
// of the same normalized address at the same point cell, the row is refreshed.
func (g *Gazetteer) Upsert(ctx context.Context, e GazetteerEntry) error {
	if g == nil || g.pool == nil {
		return nil
	}

	// Derive the spatial point cell if the caller didn't supply one.
	h3 := e.H3Cell
	if h3 == "" {
		h3 = PointCellKey(e.Lat, e.Lng)
	}

	// Encrypt the PII payload (normalized address + JSON components). Components are
	// already JSON text; we encrypt them together so the plaintext address never
	// rests unencrypted outside the indexed normalized_addr lookup key.
	encrypted, err := g.enc.Encrypt(gazetteerPII(e))
	if err != nil {
		return err
	}

	components := e.Components
	if components == "" {
		components = "{}"
	}

	// $1 h3, $2 lng, $3 lat, $4 normalized_addr, $5 components(jsonb),
	// $6 plus_code, $7 source, $8 verified_by(uuid|null), $9 verified_at, $10 encrypted_pii.
	// ST_MakePoint(lng, lat) per PostGIS convention (see ).
	const q = `
		INSERT INTO public.map_gazetteer
			(h3, geog, lat, lng, normalized_addr, components, plus_code, source, verified_by, verified_at, encrypted_pii)
		VALUES (
			$1,
			ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
			$3, $2, $4, $5::jsonb, NULLIF($6, ''), $7, $8, COALESCE($9, now()), $10
		)
		ON CONFLICT DO NOTHING`

	_, err = g.pool.Exec(ctx, q,
		h3,
		e.Lng, e.Lat,
		e.NormalizedAddr,
		components,
		e.PlusCode,
		nzSource(e.Source),
		nullUUID(e.VerifiedBy),
		nullableTime(e.VerifiedAt),
		encrypted,
	)
	return err
}

// scanGazetteerPoint scans one verified point into a SourceGazetteer GeoResult.
// It returns the entry id (for access logging) and ok=false on miss/scan error.
// Gazetteer points are OURS: Confidence 1.0, Cacheable true (not third-party).
func scanGazetteerPoint(row pgx.Row) (GeoResult, string, bool) {
	var (
		id       string
		lat, lng float64
		addr     string
		plusCode *string
		h3       string
	)
	if err := row.Scan(&id, &lat, &lng, &addr, &plusCode, &h3); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[maps] gazetteer scan: %v", err)
		}
		return GeoResult{}, "", false
	}
	pc := ""
	if plusCode != nil {
		pc = *plusCode
	}
	return GeoResult{
		Lat:        lat,
		Lng:        lng,
		Address:    addr,
		PlusCode:   pc,
		Provider:   string(SourceGazetteer),
		Source:     SourceGazetteer,
		Cacheable:  true, // ours, not third-party-licensed
		Confidence: 1.0,  // a confirmed/verified point
		H3Cell:     h3,
	}, id, true
}

// logAccess writes an immutable access-log row for a gazetteer READ (MS-4, NDPA).
// Best-effort: an audit-write failure is logged but never blocks the resolution
// (the data has already been read; failing the request would not un-read it).
func (g *Gazetteer) logAccess(ctx context.Context, entryID, basis string) {
	if g == nil || g.pool == nil || entryID == "" {
		return
	}
	accessor := userIDFromCtx(ctx)
	const q = `
		INSERT INTO public.map_gazetteer_access_log (entry_id, accessor_id, basis, accessed_at)
		VALUES ($1, $2, $3, now())`
	if _, err := g.pool.Exec(ctx, q, entryID, nullUUID(accessor), basis); err != nil {
		log.Printf("[maps] gazetteer access-log (entry=%s basis=%s): %v", entryID, basis, err)
	}
}

// gazetteerPII assembles the PII payload encrypted at rest: the human-readable
// normalized address plus its JSON components. Newline-separated, address first.
func gazetteerPII(e GazetteerEntry) []byte {
	if e.NormalizedAddr == "" && e.Components == "" {
		return nil
	}
	return []byte(e.NormalizedAddr + "\n" + e.Components)
}

// nullUUID maps an empty string to a typed SQL NULL so empty accessor/verified-by
// ids do not fail uuid parsing on insert. Non-empty values pass through verbatim.
func nullUUID(s string) any { return dbutil.NullUUID(s) }

// nzSource defaults an empty gazetteer source to a safe sentinel (the column is
// NOT NULL). Confirmed pins normally arrive with a real source.
func nzSource(s string) string { return strutil.Or(s, "user_saved") }

// nullableTime maps a zero time.Time to SQL NULL so the column default (now())
// applies; a set VerifiedAt is passed through. Paired with COALESCE($9, now()).
func nullableTime(t time.Time) any { return dbutil.NullTime(t) }

// GeoRepo is the PostGIS-backed "our own records" access used by findNearbyOwn
// and isInZone. These NEVER call a maps API — proximity and geofencing run on
// our data with GiST indexes (ST_DWithin / ST_Contains). It is an interface so
// the service can be unit-tested with an in-memory fake.
type GeoRepo interface {
	NearbyOwn(ctx context.Context, entityType string, p Point, radiusM float64, limit int) ([]OwnEntity, error)
	InZone(ctx context.Context, p Point, zoneID string) (bool, error)
	UpsertLocation(ctx context.Context, e OwnEntity, entityType, plusCode string) error
}

// PostGISRepo implements GeoRepo against merchant_locations + service_areas.
type PostGISRepo struct {
	pool *pgxpool.Pool
}

// NewPostGISRepo builds a PostGIS GeoRepo.
func NewPostGISRepo(pool *pgxpool.Pool) *PostGISRepo { return &PostGISRepo{pool: pool} }

// NearbyOwn returns OUR records of entityType within radiusM of p, nearest first.
// Uses geography ST_DWithin (true metres) against the GiST index — not a maps API.
func (r *PostGISRepo) NearbyOwn(ctx context.Context, entityType string, p Point, radiusM float64, limit int) ([]OwnEntity, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT entity_id, entity_type,
		       ST_Y(geog::geometry) AS lat,
		       ST_X(geog::geometry) AS lng,
		       COALESCE(plus_code, ''),
		       ST_Distance(geog, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS dist_m
		FROM merchant_locations
		WHERE entity_type = $3
		  AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $4)
		ORDER BY dist_m ASC
		LIMIT $5`
	rows, err := r.pool.Query(ctx, q, p.Lat, p.Lng, entityType, radiusM, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OwnEntity{}
	for rows.Next() {
		var e OwnEntity
		if err := rows.Scan(&e.EntityID, &e.EntityType, &e.Lat, &e.Lng, &e.PlusCode, &e.DistanceM); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// InZone reports whether p falls inside the service_areas polygon zoneID.
// Uses ST_Contains on the GiST-indexed geography — not a maps API.
func (r *PostGISRepo) InZone(ctx context.Context, p Point, zoneID string) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM service_areas
			WHERE id = $1
			  AND ST_Contains(geog::geometry, ST_SetSRID(ST_MakePoint($3, $2), 4326))
		)`
	var inside bool
	if err := r.pool.QueryRow(ctx, q, zoneID, p.Lat, p.Lng).Scan(&inside); err != nil {
		return false, err
	}
	return inside, nil
}

// UpsertLocation writes/updates one of our records' pin (source of truth) and
// its Plus Code. Callers pass the confirmed map pin captured at address entry.
func (r *PostGISRepo) UpsertLocation(ctx context.Context, e OwnEntity, entityType, plusCode string) error {
	const q = `
		INSERT INTO merchant_locations (entity_id, entity_type, geog, plus_code, updated_at)
		VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, NOW())
		ON CONFLICT (entity_id, entity_type)
		DO UPDATE SET geog = EXCLUDED.geog, plus_code = EXCLUDED.plus_code, updated_at = NOW()`
	_, err := r.pool.Exec(ctx, q, e.EntityID, entityType, e.Lat, e.Lng, plusCode)
	return err
}

// OwnerZoneChecker answers "does this delivery point fall inside any service area
// owned by this owner?" against the PostGIS service_areas table. It is the concrete
// implementation behind restaurant.DeliveryZoneChecker (the restaurant package
// declares the interface with plain scalar types so it need not import maps).
// Like GeoRepo.InZone this runs entirely on OUR own geofence data (ST_Contains over
// the GiST-indexed geography) — it NEVER calls a maps API.
type OwnerZoneChecker struct {
	pool *pgxpool.Pool
}

// NewOwnerZoneChecker builds an OwnerZoneChecker over the given pool.
func NewOwnerZoneChecker(pool *pgxpool.Pool) *OwnerZoneChecker {
	return &OwnerZoneChecker{pool: pool}
}

// InAnyOwnerZone reports whether (lat,lng) is inside any of ownerID's service areas,
// and whether the owner has drawn any zones at all. A single round-trip returns both:
//   - hasZones == false  → the owner defined no service areas (caller should NOT gate).
//   - inZone   == true   → the point is inside at least one of the owner's areas.
//
// The same ST_Contains + ST_SetSRID(ST_MakePoint(lng,lat),4326) expression as
// GeoRepo.InZone is used, so behavior matches the existing single-zone check.
func (c *OwnerZoneChecker) InAnyOwnerZone(ctx context.Context, lat, lng float64, ownerID string) (bool, bool, error) {
	var err error

	const q = `
		SELECT
			count(*) AS total,
			count(*) FILTER (
				WHERE ST_Contains(geog::geometry, ST_SetSRID(ST_MakePoint($3, $2), 4326))
			) AS inside
		FROM service_areas
		WHERE owner_id = $1`
	var total, inside int64
	if err = c.pool.QueryRow(ctx, q, ownerID, lat, lng).Scan(&total, &inside); err != nil {
		return false, false, err
	}
	return inside > 0, total > 0, nil
}

// at-rest encryption for PII-bearing gazetteer payloads (MS-4, NDPA).
// Addresses (and the raw components captured with a confirmed pin) are PII. The
// PrivateGazetteer stores any such payload ONLY in the encrypted_pii bytea column,
// never in plaintext. This file defines the Encryptor seam the Gazetteer depends
// on, an AES-256-GCM implementation, and a Noop impl for DB-free/dev paths.
// No existing crypto helper was found under internal/platform or internal/finance,
// so AES-256-GCM is implemented here with a random per-message nonce prefixed to
// the ciphertext (standard authenticated-encryption layout).

// Encryptor encrypts/decrypts a PII payload at rest. Implementations MUST be safe
// for concurrent use (the Gazetteer shares one instance across requests).
type Encryptor interface {
	Encrypt(plaintext []byte) ([]byte, error)
	Decrypt(ciphertext []byte) ([]byte, error)
}

// Crypto errors surfaced by the AES implementation.
var (
	// ErrEncryptorKeySize is returned by NewAESEncryptor for a key that is not a
	// valid AES key length (16/24/32 bytes). We require 32 (AES-256) in prod.
	ErrEncryptorKeySize = errors.New("maps: AES key must be 16, 24, or 32 bytes (32 = AES-256)")
	// ErrCiphertextTooShort is returned by Decrypt when the blob cannot hold a nonce.
	ErrCiphertextTooShort = errors.New("maps: ciphertext too short")
)

// aesEncryptor is an AES-GCM Encryptor. The nonce is randomly generated per call
// and prefixed to the returned ciphertext: layout = nonce || gcmSeal(plaintext).
type aesEncryptor struct {
	gcm cipher.AEAD
}

// NewAESEncryptor builds an AES-GCM Encryptor from a raw key. A 32-byte key
// selects AES-256 (the production default). Returns ErrEncryptorKeySize otherwise.
func NewAESEncryptor(key []byte) (Encryptor, error) {
	switch len(key) {
	case 16, 24, 32:
	default:
		return nil, fmt.Errorf("%w (got %d bytes)", ErrEncryptorKeySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("maps: aes new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("maps: aes new gcm: %w", err)
	}
	return &aesEncryptor{gcm: gcm}, nil
}

// Encrypt returns nonce||ciphertext. Empty input yields empty output (nothing to
// store) so callers can pass a nil/empty PII payload without branching.
func (e *aesEncryptor) Encrypt(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 {
		return nil, nil
	}
	nonce := make([]byte, e.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("maps: nonce gen: %w", err)
	}
	// Seal appends the ciphertext to nonce, so the nonce prefixes the result.
	return e.gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt reverses Encrypt: it splits the nonce prefix and authenticates+decrypts.
// Empty input yields empty output (no stored PII).
func (e *aesEncryptor) Decrypt(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, nil
	}
	ns := e.gcm.NonceSize()
	if len(ciphertext) < ns {
		return nil, ErrCiphertextTooShort
	}
	nonce, body := ciphertext[:ns], ciphertext[ns:]
	plaintext, err := e.gcm.Open(nil, nonce, body, nil)
	if err != nil {
		return nil, fmt.Errorf("maps: aes open: %w", err)
	}
	return plaintext, nil
}

// NoopEncryptor is a pass-through Encryptor for tests and for environments where
// no key is configured. It NEVER protects PII — production wiring MUST inject a
// real AES key. It exists only so the Gazetteer is non-nil-fragile in dev/tests.
type NoopEncryptor struct{}

// Encrypt returns the input unchanged.
func (NoopEncryptor) Encrypt(plaintext []byte) ([]byte, error) { return plaintext, nil }

// Decrypt returns the input unchanged.
func (NoopEncryptor) Decrypt(ciphertext []byte) ([]byte, error) { return ciphertext, nil }

// compile-time interface assertions.
var (
	_ Encryptor = (*aesEncryptor)(nil)
	_ Encryptor = NoopEncryptor{}
)
