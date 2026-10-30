// Package portal answers "which provider portals may this caller open?" for the
// mobile provider portal. It is a read-only view over rows the caller OWNS; it
// never accepts an identity from the client and never reads another user's rows.
// It is a UX gate: every provider-side route still enforces ownership and
// approval itself (ADR-PR915 provider-portal-capabilities).
package portal

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
)

// Capability is one provider record the caller owns.
type Capability struct {
	Type        string `json:"type"` // doctor|vet|pharmacy|lab|restaurant|rider|driver|marketplace_seller|event_organiser|estate_manager|property_manager|association_creator|crowdfunding_creator|bus_owner
	ProviderID  string `json:"provider_id"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	Approved    bool   `json:"approved"`
}

// existingTables returns the subset of names that resolve to a table, so a
// module whose migrations have not run in this environment is skipped rather
// than failing the whole endpoint.
func existingTables(ctx context.Context, db *pgxpool.Pool, names []string) (map[string]bool, error) {
	rows, err := db.Query(ctx, `
		SELECT n FROM unnest($1::text[]) AS n WHERE to_regclass(n) IS NOT NULL`, names)
	if err != nil {
		return nil, fmt.Errorf("portal: table probe: %w", err)
	}
	defer rows.Close()
	out := make(map[string]bool, len(names))
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out[n] = true
	}
	return out, rows.Err()
}

func approvedStatus(raw string) (status string, approved bool) {
	s := strings.ToUpper(strings.TrimSpace(raw))
	if s == "" {
		return "ACTIVE", true
	}
	return s, s == "APPROVED" || s == "VERIFIED"
}

// Capabilities lists the provider records owned by userID. The result is never
// nil: a non-provider gets an empty slice.
func Capabilities(ctx context.Context, db *pgxpool.Pool, userID string) ([]Capability, error) {
	out := []Capability{}

	have, err := existingTables(ctx, db, []string{
		"health_providers", "doctor_profiles", "restaurants", "restaurant_kyb",
		"drivers", "mkt_listings", "events", "estates",
		"property_role_profiles", "assoc_organisations",
		"campaigns", "bus_providers", "user_profiles",
	})
	if err != nil {
		return nil, err
	}

	// vet / pharmacy / lab — one row per owned OWNER record. provider_type is
	// filtered to the types the server itself gates owner actions on; staff rows
	// (pharmacist, lab_scientist, phlebotomist) are not a business to manage.
	if have["health_providers"] {
		rows, err := db.Query(ctx, `
			SELECT id::text, lower(domain), display_name, status
			FROM health_providers
			WHERE owner_user_id = $1
			  AND provider_type IN ('vet','pharmacy','lab')
			ORDER BY created_at`, userID)
		if err != nil {
			return nil, fmt.Errorf("portal: health providers: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var c Capability
			if err := rows.Scan(&c.ProviderID, &c.Type, &c.DisplayName, &c.Status); err != nil {
				return nil, err
			}
			c.Approved = c.Status == "APPROVED"
			out = append(out, c)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// doctor — doctor_profiles.verification is the approval state.
	if have["doctor_profiles"] {
		drows, err := db.Query(ctx, `
			SELECT id::text, COALESCE(NULLIF(name,''), 'Doctor'), COALESCE(verification,'')
			FROM doctor_profiles
			WHERE user_id = $1
			ORDER BY created_at`, userID)
		if err != nil {
			return nil, fmt.Errorf("portal: doctor profiles: %w", err)
		}
		defer drows.Close()
		for drows.Next() {
			c := Capability{Type: "doctor"}
			var verification string
			if err := drows.Scan(&c.ProviderID, &c.DisplayName, &verification); err != nil {
				return nil, err
			}
			c.Approved = verification == "approved"
			switch verification {
			case "approved":
				c.Status = "APPROVED"
			case "suspended":
				c.Status = "SUSPENDED"
			default:
				c.Status = "PENDING"
			}
			out = append(out, c)
		}
		if err := drows.Err(); err != nil {
			return nil, err
		}
	}

	// restaurant — one row per outlet. KYB is the approval state where the module
	// has one; an outlet with no KYB row yet is usable (onboarding runs from the
	// manage screen), so it is not treated as unapproved.
	if have["restaurants"] {
		join, statusSel := "", "''"
		if have["restaurant_kyb"] {
			join = "LEFT JOIN restaurant_kyb k ON k.restaurant_id = r.id"
			statusSel = "COALESCE(k.status,'')"
		}
		rows, err := db.Query(ctx, `
			SELECT r.id::text, COALESCE(NULLIF(r.name,''),'Restaurant'), `+statusSel+`
			FROM restaurants r `+join+`
			WHERE r.owner_id = $1
			ORDER BY r.created_at`, userID)
		if err != nil {
			return nil, fmt.Errorf("portal: restaurants: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			c := Capability{Type: "restaurant"}
			var raw string
			if err := rows.Scan(&c.ProviderID, &c.DisplayName, &raw); err != nil {
				return nil, err
			}
			c.Status, c.Approved = approvedStatus(raw)
			out = append(out, c)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// driver / rider — one `drivers` row is one driver identity (the mobility
	// driver API and food dispatch both read this table). The two consoles are
	// separate businesses — ride-hailing on one, delivery offers on the other —
	// so an owned row opens both. Dispatch already refuses non-approved drivers,
	// so the portal mirrors that state exactly.
	if have["drivers"] {
		rows, err := db.Query(ctx, `
			SELECT id::text, COALESCE(NULLIF(name,''),'Driver'), COALESCE(verification_status,'')
			FROM drivers
			WHERE user_id = $1
			ORDER BY created_at`, userID)
		if err != nil {
			return nil, fmt.Errorf("portal: drivers: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			c := Capability{}
			var raw string
			if err := rows.Scan(&c.ProviderID, &c.DisplayName, &raw); err != nil {
				return nil, err
			}
			c.Status, c.Approved = approvedStatus(raw)
			driver, rider := c, c
			driver.Type, rider.Type = "driver", "rider"
			out = append(out, driver, rider)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// marketplace seller — there is no seller profile table; the business exists
	// once the user has at least one listing. One aggregate entry.
	if have["mkt_listings"] {
		name := "'Marketplace seller'"
		if have["user_profiles"] {
			name = "COALESCE(NULLIF((SELECT full_name FROM user_profiles WHERE id=$1),''),'Marketplace seller')"
		}
		var display string
		err := db.QueryRow(ctx, `
			SELECT `+name+`
			WHERE EXISTS (SELECT 1 FROM mkt_listings WHERE seller_id=$1)`, userID).Scan(&display)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("portal: marketplace sellers: %w", err)
		}
		if err == nil {
			out = append(out, Capability{
				Type: "marketplace_seller", ProviderID: userID, DisplayName: display,
				Status: "ACTIVE", Approved: true,
			})
		}
	}

	// event organiser — likewise derived from owning at least one event.
	if have["events"] {
		name := "'Event organiser'"
		if have["user_profiles"] {
			name = "COALESCE(NULLIF((SELECT full_name FROM user_profiles WHERE id=$1),''),'Event organiser')"
		}
		var display string
		err := db.QueryRow(ctx, `
			SELECT `+name+`
			WHERE EXISTS (SELECT 1 FROM events WHERE organizer_id=$1 OR organiser_id=$1)`, userID).Scan(&display)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("portal: event organisers: %w", err)
		}
		if err == nil {
			out = append(out, Capability{
				Type: "event_organiser", ProviderID: userID, DisplayName: display,
				Status: "ACTIVE", Approved: true,
			})
		}
	}

	// estate manager — the estate's admin. Delegated staff roles are operational
	// grants, not ownership of the estate.
	if have["estates"] {
		rows, err := db.Query(ctx, `
			SELECT id::text, COALESCE(NULLIF(name,''),'Estate')
			FROM estates
			WHERE admin_id = $1
			ORDER BY created_at`, userID)
		if err != nil {
			return nil, fmt.Errorf("portal: estates: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			c := Capability{Type: "estate_manager", Status: "ACTIVE", Approved: true}
			if err := rows.Scan(&c.ProviderID, &c.DisplayName); err != nil {
				return nil, err
			}
			out = append(out, c)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// property manager — the registered property role profile. Activation and
	// verification are separate states; only both settled true unlock the tools.
	if have["property_role_profiles"] {
		rows, err := db.Query(ctx, `
			SELECT id::text, COALESCE(NULLIF(display_name,''),'Property manager'),
			       status, verification_status
			FROM property_role_profiles
			WHERE user_id = $1 AND role = 'estate_manager'
			ORDER BY created_at`, userID)
		if err != nil {
			return nil, fmt.Errorf("portal: property managers: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			c := Capability{Type: "property_manager"}
			var status, verification string
			if err := rows.Scan(&c.ProviderID, &c.DisplayName, &status, &verification); err != nil {
				return nil, err
			}
			if verification != "verified" {
				c.Status = strings.ToUpper(verification)
				c.Approved = false
			} else {
				c.Status = strings.ToUpper(status)
				c.Approved = status == "active"
			}
			out = append(out, c)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// association creator — the organisation row records who created it.
	if have["assoc_organisations"] {
		rows, err := db.Query(ctx, `
			SELECT id::text, COALESCE(NULLIF(name,''),'Association'), verified
			FROM assoc_organisations
			WHERE created_by = $1
			ORDER BY created_at`, userID)
		if err != nil {
			return nil, fmt.Errorf("portal: associations: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			c := Capability{Type: "association_creator", Approved: true}
			var verified bool
			if err := rows.Scan(&c.ProviderID, &c.DisplayName, &verified); err != nil {
				return nil, err
			}
			if verified {
				c.Status = "VERIFIED"
			} else {
				c.Status = "ACTIVE"
			}
			out = append(out, c)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// crowdfunding creator — one row per campaign the user created. A draft is
	// still the creator's to manage, so ownership (not campaign state) approves.
	if have["campaigns"] {
		rows, err := db.Query(ctx, `
			SELECT id::text, COALESCE(NULLIF(title,''),'Campaign'), status
			FROM campaigns
			WHERE creator_id = $1
			ORDER BY created_at`, userID)
		if err != nil {
			return nil, fmt.Errorf("portal: campaigns: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			c := Capability{Type: "crowdfunding_creator", Approved: true}
			var status string
			if err := rows.Scan(&c.ProviderID, &c.DisplayName, &status); err != nil {
				return nil, err
			}
			c.Status = strings.ToUpper(status)
			out = append(out, c)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// bus owner — verified operators only; an operator is verified by ops.
	if have["bus_providers"] {
		rows, err := db.Query(ctx, `
			SELECT id::text, COALESCE(NULLIF(business_name,''),'Bus operator'), verification_status
			FROM bus_providers
			WHERE owner_user_id = $1
			ORDER BY created_at`, userID)
		if err != nil {
			return nil, fmt.Errorf("portal: bus providers: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			c := Capability{Type: "bus_owner"}
			var raw string
			if err := rows.Scan(&c.ProviderID, &c.DisplayName, &raw); err != nil {
				return nil, err
			}
			c.Status, c.Approved = approvedStatus(raw)
			out = append(out, c)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	return out, nil
}

// Register mounts GET /health/provider-portal/me on the member group. With the
// feature off the route still exists and answers 503, as the spec promises, so a
// client can tell "off" from "no such route".
func Register(member *gin.RouterGroup, db *pgxpool.Pool, enabled bool) {
	member.GET("/health/provider-portal/me", func(c *gin.Context) {
		if !enabled {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": "provider portal disabled"})
			return
		}
		uid := ginutil.UserID(c)
		if uid == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
			return
		}
		caps, err := Capabilities(c.Request.Context(), db, uid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load provider capabilities"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "capabilities": caps})
	})
}
