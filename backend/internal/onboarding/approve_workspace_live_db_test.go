package onboarding_test

// LIVE-DB test for the onboarding → workspace seam.
//
// Approval is what turns a customer into a merchant: it grants the role, activates
// the profile, and writes the workspace_route the app navigates to. Nothing tested
// any of that — no existing test referenced Approve or workspace_route — and the
// route it writes turned out to point at a screen the app did not have
// (`/merchant/<slug>`, while app/(merchant) is a route GROUP, not a path). Every
// approved merchant tapped their capability and went nowhere.
//
// The app side now serves `/merchant/[slug]` and resolves the slug against the
// caller's capabilities. This pins the CONTRACT between the two halves: the route
// must stay `/merchant/<merchant-type-slug>`, because the app parses that slug
// back out to decide which workspace to open.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/onboarding"
)

func TestLiveDB_ApprovalWritesAResolvableWorkspaceRoute(t *testing.T) {
	pool := liveOnbPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := onboarding.NewService(pool)

	tok := uuid.New().String()[:8]
	modID := "mod-ws-" + tok
	typeID := "mt-ws-" + tok
	schemaID := "fs-ws-" + tok
	// The slug is the part the app parses back out of the route.
	slug := "restaurant"
	userID := uuid.New().String()
	reviewer := uuid.New().String()

	// Approval grants an RBAC role, and public.user_roles has an FK to auth.users,
	// so the applicant has to be a real account.
	for _, u := range []string{userID, reviewer} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO onb_module (id,slug,name,description,icon,icon_color,bg_color,status,sort_order)
		 VALUES ($1,$1,'WS Test','t','X','#000000','#000000','open',99)`, modID); err != nil {
		t.Fatalf("seed module: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO onb_merchant_type (id,module_id,slug,name,description,icon,requirements_summary,
		    expected_review_label,required_kyc_tier,role_to_grant,current_form_schema_id,status)
		 VALUES ($1,$2,$3,'WS Restaurant','t','X','[]'::jsonb,'x',0,'restaurant_merchant',$4,'open')`,
		typeID, modID, slug, schemaID); err != nil {
		t.Fatalf("seed type: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM onb_merchant_profile WHERE merchant_type_id=$1`, typeID)
		pool.Exec(bg, `DELETE FROM onb_application WHERE merchant_type_id=$1`, typeID)
		// Schema BEFORE type: onb_form_schema.merchant_type_id has an FK to
		// onb_merchant_type, so deleting the type first fails, and because these
		// Execs ignore their error the row silently survives — as an OPEN merchant
		// type visible to real users in the live onboarding list.
		pool.Exec(bg, `DELETE FROM onb_form_schema WHERE merchant_type_id=$1`, typeID)
		pool.Exec(bg, `DELETE FROM onb_merchant_type WHERE id=$1`, typeID)
		pool.Exec(bg, `DELETE FROM onb_module WHERE id=$1`, modID)
	})


	// The submit path resolves the type's OWN published schema
	// (GetPublishedSchemaForType is scoped by merchant_type_id), so seed one.
	// No steps: this test is about the approval seam, not form validation.
	if _, err := pool.Exec(ctx,
		`INSERT INTO onb_form_schema (id, merchant_type_id, version, status, steps)
		 VALUES ($1,$2,1,'published','[]'::jsonb)`, schemaID, typeID); err != nil {
		t.Fatalf("seed form schema: %v", err)
	}

	app, err := svc.CreateApplication(ctx, userID, onboarding.CreateApplicationRequest{MerchantTypeID: typeID})
	if err != nil {
		t.Fatalf("create application: %v", err)
	}
	if _, err := svc.Submit(ctx, userID, app.ID, "idem-"+tok); err != nil {
		t.Fatalf("submit: %v", err)
	}

	approved, err := svc.Approve(ctx, reviewer, app.ID)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if approved.Status != "APPROVED" {
		t.Errorf("status = %s, want APPROVED", approved.Status)
	}

	// --- The seam. ---
	var route, status, role string
	if err := pool.QueryRow(ctx,
		`SELECT workspace_route, status, role_granted FROM onb_merchant_profile
		  WHERE user_id=$1 AND merchant_type_id=$2`, userID, typeID).
		Scan(&route, &status, &role); err != nil {
		t.Fatalf("read activated profile: %v", err)
	}

	if status != "ACTIVE" {
		t.Errorf("profile status = %s, want ACTIVE — the app grants a workspace only to ACTIVE", status)
	}
	if role != "restaurant_merchant" {
		t.Errorf("role_granted = %s, want restaurant_merchant", role)
	}

	// The contract the app depends on. If this format changes, app/merchant/[slug]
	// can no longer work out which workspace to open and every approved merchant
	// silently loses access to their tools.
	want := fmt.Sprintf("/merchant/%s", slug)
	if route != want {
		t.Errorf("workspace_route = %q, want %q — the app parses the slug back out of this route", route, want)
	}
	if route == "" {
		t.Error("workspace_route is empty — the capability row would link nowhere")
	}
}

// TestLiveDB_ApprovalIsIdempotent: approving twice must not create a second
// profile or move the workspace route, since reviewers can double-submit.
func TestLiveDB_ApprovalIsIdempotent(t *testing.T) {
	pool := liveOnbPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := onboarding.NewService(pool)

	tok := uuid.New().String()[:8]
	modID := "mod-idem-" + tok
	typeID := "mt-idem-" + tok
	schemaID := "fs-idem-" + tok
	userID := uuid.New().String()
	reviewer := uuid.New().String()

	// Approval grants an RBAC role, and public.user_roles has an FK to auth.users,
	// so the applicant has to be a real account.
	for _, u := range []string{userID, reviewer} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO onb_module (id,slug,name,description,icon,icon_color,bg_color,status,sort_order)
		 VALUES ($1,$1,'Idem Test','t','X','#000000','#000000','open',99)`, modID); err != nil {
		t.Fatalf("seed module: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO onb_merchant_type (id,module_id,slug,name,description,icon,requirements_summary,
		    expected_review_label,required_kyc_tier,role_to_grant,current_form_schema_id,status)
		 VALUES ($1,$2,'seller','Idem Seller','t','X','[]'::jsonb,'x',0,'marketplace_seller',$3,'open')`,
		typeID, modID, schemaID); err != nil {
		t.Fatalf("seed type: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM onb_merchant_profile WHERE merchant_type_id=$1`, typeID)
		pool.Exec(bg, `DELETE FROM onb_application WHERE merchant_type_id=$1`, typeID)
		// Schema BEFORE type: onb_form_schema.merchant_type_id has an FK to
		// onb_merchant_type, so deleting the type first fails, and because these
		// Execs ignore their error the row silently survives — as an OPEN merchant
		// type visible to real users in the live onboarding list.
		pool.Exec(bg, `DELETE FROM onb_form_schema WHERE merchant_type_id=$1`, typeID)
		pool.Exec(bg, `DELETE FROM onb_merchant_type WHERE id=$1`, typeID)
		pool.Exec(bg, `DELETE FROM onb_module WHERE id=$1`, modID)
	})


	// The submit path resolves the type's OWN published schema
	// (GetPublishedSchemaForType is scoped by merchant_type_id), so seed one.
	// No steps: this test is about the approval seam, not form validation.
	if _, err := pool.Exec(ctx,
		`INSERT INTO onb_form_schema (id, merchant_type_id, version, status, steps)
		 VALUES ($1,$2,1,'published','[]'::jsonb)`, schemaID, typeID); err != nil {
		t.Fatalf("seed form schema: %v", err)
	}

	app, err := svc.CreateApplication(ctx, userID, onboarding.CreateApplicationRequest{MerchantTypeID: typeID})
	if err != nil {
		t.Fatalf("create application: %v", err)
	}
	if _, err := svc.Submit(ctx, userID, app.ID, "idem2-"+tok); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := svc.Approve(ctx, reviewer, app.ID); err != nil {
		t.Fatalf("first approve: %v", err)
	}
	// A second approval may legitimately error (already decided); what must NOT
	// happen is a duplicate or mutated profile.
	_, _ = svc.Approve(ctx, reviewer, app.ID)

	var profiles int
	var route string
	if err := pool.QueryRow(ctx,
		`SELECT count(*), COALESCE(max(workspace_route),'') FROM onb_merchant_profile
		  WHERE user_id=$1 AND merchant_type_id=$2`, userID, typeID).Scan(&profiles, &route); err != nil {
		t.Fatalf("count profiles: %v", err)
	}
	if profiles != 1 {
		t.Errorf("profiles = %d, want exactly 1 after a repeated approval", profiles)
	}
	if route != "/merchant/seller" {
		t.Errorf("workspace_route = %q, want /merchant/seller", route)
	}
}
