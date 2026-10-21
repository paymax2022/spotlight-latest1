package restaurant

// LIVE-DB regression for FOOD-011 / C-005: modifier groups on the menu wire shape,
// the on-demand re-fetch, admin CRUD, and client/server price agreement.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func modReq(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestLiveDB_ModifierGroupsWireAndAdminCRUD(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Wire Kitchen", 400_000)

	_, sizeOpts := addGroup(t, ctx, f, f.itemID, "Size", true, 1, 1, 0, 60_000)
	_, extraOpts := addGroup(t, ctx, f, f.itemID, "Extras", false, 0, 3, 25_000, 15_000)

	h := NewHandler(f.svc)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/restaurant/menu/items/:itemId/modifier-groups", h.ListModifierGroups)
	r.GET("/admin/menu-items/:itemId/modifier-groups", h.AdminListModifierGroups)
	r.POST("/admin/menu-items/:itemId/modifier-groups", h.AdminCreateModifierGroup)
	r.PATCH("/admin/modifier-groups/:groupId", h.AdminUpdateModifierGroup)
	r.DELETE("/admin/modifier-groups/:groupId", h.AdminDeleteModifierGroup)
	r.POST("/admin/modifier-groups/:groupId/options", h.AdminCreateModifierOption)
	r.PATCH("/admin/modifier-groups/:groupId/options/:optionId", h.AdminUpdateModifierOption)
	r.DELETE("/admin/modifier-groups/:groupId/options/:optionId", h.AdminDeleteModifierOption)

	// 1. Menu detail carries both groups with option prices.
	detail, err := f.svc.GetRestaurantDetail(ctx, f.restID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	withEmptyMenuShape(detail)
	var item *MenuItem
	for ci := range detail.Categories {
		for ii := range detail.Categories[ci].Items {
			if detail.Categories[ci].Items[ii].ID == f.itemID {
				item = &detail.Categories[ci].Items[ii]
			}
		}
	}
	if item == nil {
		t.Skip("fixture item has no category; detail grouping needs one")
	}
	if len(item.ModifierGroups) != 2 {
		t.Fatalf("menu item has %d groups, want 2", len(item.ModifierGroups))
	}
	if g := item.ModifierGroups[0]; g.Kind != "required_single" || len(g.Options) != 2 || g.Options[1].PriceDeltaKobo != 60_000 || !g.Options[1].Available {
		t.Errorf("size group wrong: %+v", g)
	}
	if g := item.ModifierGroups[1]; g.Kind != "optional_multi" || g.MaxSelect != 3 || g.Options[0].PriceDeltaKobo != 25_000 {
		t.Errorf("extras group wrong: %+v", g)
	}

	// 2. On-demand route.
	w := modReq(t, r, "GET", "/restaurant/menu/items/"+f.itemID+"/modifier-groups", "")
	var listed struct {
		Groups []ModifierGroupWire `json:"modifier_groups"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &listed) != nil || len(listed.Groups) != 2 {
		t.Fatalf("on-demand route: %d %s", w.Code, w.Body.String())
	}
	if w := modReq(t, r, "GET", "/restaurant/menu/items/"+uuid.New().String()+"/modifier-groups", ""); w.Code != 404 {
		t.Errorf("unknown item = %d, want 404", w.Code)
	}

	// 3. Admin create -> list -> option CRUD -> delete.
	w = modReq(t, r, "POST", "/admin/menu-items/"+f.itemID+"/modifier-groups", `{"name":"Sauce","kind":"optional_single"}`)
	var created ModifierGroupWire
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &created) != nil || created.Kind != "optional_single" {
		t.Fatalf("create group: %d %s", w.Code, w.Body.String())
	}
	if w := modReq(t, r, "POST", "/admin/menu-items/"+f.itemID+"/modifier-groups", `{"name":"Bad","min_select":3,"max_select":1}`); w.Code != 400 {
		t.Errorf("invalid rule = %d, want 400", w.Code)
	}
	w = modReq(t, r, "POST", "/admin/modifier-groups/"+created.ID+"/options", `{"name":"Chili","price_delta_kobo":5000}`)
	var opt ModifierOptionWire
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &opt) != nil || opt.PriceDeltaKobo != 5000 {
		t.Fatalf("create option: %d %s", w.Code, w.Body.String())
	}
	if w := modReq(t, r, "POST", "/admin/modifier-groups/"+created.ID+"/options", `{"name":"Neg","price_delta_kobo":-1}`); w.Code != 400 {
		t.Errorf("negative delta = %d, want 400", w.Code)
	}
	if w := modReq(t, r, "PATCH", "/admin/modifier-groups/"+created.ID+"/options/"+opt.ID, `{"available":false,"price_delta_kobo":7000}`); w.Code != 200 {
		t.Fatalf("patch option: %d %s", w.Code, w.Body.String())
	}
	if w := modReq(t, r, "PATCH", "/admin/modifier-groups/"+created.ID, `{"kind":"required_multi","max_select":2}`); w.Code != 200 {
		t.Fatalf("patch group: %d %s", w.Code, w.Body.String())
	}
	w = modReq(t, r, "GET", "/admin/menu-items/"+f.itemID+"/modifier-groups", "")
	_ = json.Unmarshal(w.Body.Bytes(), &listed)
	var found *ModifierGroupWire
	for i := range listed.Groups {
		if listed.Groups[i].ID == created.ID {
			found = &listed.Groups[i]
		}
	}
	if found == nil || found.Kind != "required_multi" || found.MinSelect != 1 || len(found.Options) != 1 || found.Options[0].Available || found.Options[0].PriceDeltaKobo != 7000 {
		t.Fatalf("admin list after patch: %+v", found)
	}
	if w := modReq(t, r, "DELETE", "/admin/modifier-groups/"+created.ID+"/options/"+opt.ID, ""); w.Code != 204 {
		t.Errorf("delete option = %d", w.Code)
	}
	if w := modReq(t, r, "DELETE", "/admin/modifier-groups/"+created.ID, ""); w.Code != 204 {
		t.Errorf("delete group = %d", w.Code)
	}
	if w := modReq(t, r, "DELETE", "/admin/modifier-groups/"+created.ID, ""); w.Code != 404 {
		t.Errorf("re-delete = %d, want 404", w.Code)
	}
	w = modReq(t, r, "GET", "/admin/menu-items/"+f.itemID+"/modifier-groups", "")
	_ = json.Unmarshal(w.Body.Bytes(), &listed)
	if len(listed.Groups) != 2 {
		t.Errorf("after delete %d groups, want 2", len(listed.Groups))
	}

	// 4. Pricing: order subtotal equals what a client computes from the wire shape.
	chosen := []string{sizeOpts[1], extraOpts[0]}
	var perUnit int64
	for _, g := range item.ModifierGroups {
		for _, o := range g.Options {
			for _, id := range chosen {
				if o.ID == id {
					perUnit += o.PriceDeltaKobo
				}
			}
		}
	}
	const qty = 2
	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: qty, ModifierIDs: chosen}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "wire-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}
	if want := (item.PriceKobo + perUnit) * qty; order.SubtotalKobo != want {
		t.Errorf("subtotal %d != client-computed %d", order.SubtotalKobo, want)
	}
}
