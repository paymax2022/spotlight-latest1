package symptomsearch

// Table-driven tests over an in-memory fake Repo — no DB required. Fixtures
// mirror the migration seeds (fever/headache/chest-pain clusters and the
// pregnancy NSAID suppression rule) so the tests exercise the same safety
// invariants that ship.

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// ─── fake repo ───────────────────────────────────────────────────────────────

type fakeRepo struct {
	terms          map[string]Term // key: normalised term text
	concepts       map[string]Concept
	clusters       map[string]Cluster
	clusterMembers map[string][]string // clusterID → concept IDs
	rules          []ClusterRule
	classMap       []ClassMapEntry
	classes        map[string]TherapeuticClass
	skus           []Sku
	disclaimer     string

	events   []SearchEvent
	eventCtx map[string]*SearchEventContext // seeded search-event contexts by id

	cases        map[string]*PharmacyReviewCase
	casesByOrder map[string]string
	caseEvents   map[string][]ReviewStateEvent // evented history per case
	tenantOwner  map[string]string             // providerID → owner user id
}

func (f *fakeRepo) LookupApprovedTerms(_ context.Context, normTerms []string) ([]Term, error) {
	var out []Term
	for _, n := range normTerms {
		if t, ok := f.terms[n]; ok && t.Status == StatusApproved {
			out = append(out, t)
		}
	}
	return out, nil
}

func (f *fakeRepo) ConceptsByIDs(_ context.Context, ids []string) ([]Concept, error) {
	var out []Concept
	for _, id := range ids {
		if c, ok := f.concepts[id]; ok && c.Status == StatusApproved {
			out = append(out, c)
		}
	}
	return out, nil
}

func (f *fakeRepo) ClustersForConcepts(_ context.Context, conceptIDs []string) ([]ClusterConceptMatch, error) {
	want := map[string]bool{}
	for _, id := range conceptIDs {
		want[id] = true
	}
	var out []ClusterConceptMatch
	for clID, members := range f.clusterMembers {
		cl, ok := f.clusters[clID]
		if !ok || cl.Status != StatusApproved {
			continue
		}
		for _, cid := range members {
			if want[cid] {
				out = append(out, ClusterConceptMatch{
					ClusterID: cl.ID, ClusterCode: cl.Code, ClusterName: cl.Name,
					TriageTier: cl.TriageTier, ConceptID: cid,
				})
			}
		}
	}
	return out, nil
}

func (f *fakeRepo) ApprovedRulesForClusters(_ context.Context, clusterIDs []string) ([]ClusterRule, error) {
	want := map[string]bool{}
	for _, id := range clusterIDs {
		want[id] = true
	}
	var out []ClusterRule
	for _, r := range f.rules {
		if r.Status == StatusApproved && want[r.ClusterID] {
			out = append(out, r)
		}
	}
	return out, nil
}

func (f *fakeRepo) ClassMapForClusters(_ context.Context, clusterIDs []string) ([]ClassMapEntry, error) {
	want := map[string]bool{}
	for _, id := range clusterIDs {
		want[id] = true
	}
	var out []ClassMapEntry
	for _, e := range f.classMap {
		cls, ok := f.classes[e.ClassID]
		if !ok || cls.Status != StatusApproved {
			continue
		}
		if want[e.ClusterID] {
			e.ClassName = cls.Name
			e.UsageNote = cls.UsageNote
			out = append(out, e)
		}
	}
	return out, nil
}

func (f *fakeRepo) ApprovedClassByID(_ context.Context, classID string) (*TherapeuticClass, error) {
	if c, ok := f.classes[classID]; ok && c.Status == StatusApproved {
		out := c
		return &out, nil
	}
	return nil, nil
}

func (f *fakeRepo) LiveSkusForClass(_ context.Context, classID, region string, limit, offset int) ([]Sku, error) {
	// Deliberately DOES NOT filter classification — proves the service-level
	// defence-in-depth gate (POM/BLOCKED_ONLINE must never leave the service).
	var out []Sku
	for _, s := range f.skus {
		if s.TherapeuticClassID != classID {
			continue
		}
		if region != "" && s.Region != "" && s.Region != region {
			continue
		}
		out = append(out, s)
	}
	return out, nil
}

func (f *fakeRepo) ActiveDisclaimer(_ context.Context) (string, error) { return f.disclaimer, nil }

func (f *fakeRepo) InsertSearchEvent(_ context.Context, ev SearchEvent) (string, error) {
	f.events = append(f.events, ev)
	return fmt.Sprintf("ev-%d", len(f.events)), nil
}

func (f *fakeRepo) SearchEventContext(_ context.Context, id string) (*SearchEventContext, error) {
	if c, ok := f.eventCtx[id]; ok {
		out := *c
		return &out, nil
	}
	return nil, nil
}

func (f *fakeRepo) ReviewCaseByID(_ context.Context, id string) (*PharmacyReviewCase, error) {
	if rc, ok := f.cases[id]; ok {
		out := *rc
		return &out, nil
	}
	return nil, nil
}

func (f *fakeRepo) ReviewCaseByOrder(_ context.Context, orderID string) (*PharmacyReviewCase, error) {
	if id, ok := f.casesByOrder[orderID]; ok {
		return f.ReviewCaseByID(context.Background(), id)
	}
	return nil, nil
}

func (f *fakeRepo) appendCaseEvent(caseID string, from *ReviewState, to ReviewState, actorID string, note *string) {
	actor := "system"
	if actorID != "" {
		actor = actorID
	}
	f.caseEvents[caseID] = append(f.caseEvents[caseID],
		ReviewStateEvent{FromState: from, State: to, Actor: actor, Note: note})
}

func (f *fakeRepo) InsertReviewCase(_ context.Context, rc *PharmacyReviewCase, actorID string) error {
	if _, dup := f.casesByOrder[rc.OrderID]; dup {
		return fmt.Errorf("unique violation: order_id")
	}
	cp := *rc
	f.cases[rc.ID] = &cp
	f.casesByOrder[rc.OrderID] = rc.ID
	f.appendCaseEvent(rc.ID, nil, rc.State, actorID, nil) // creation event, same "tx"
	return nil
}

func (f *fakeRepo) TransitionReviewCase(_ context.Context, id string, expectedVersion int, from, to ReviewState, actorID string, pharmacistID, note *string) (bool, error) {
	rc, ok := f.cases[id]
	if !ok || rc.Version != expectedVersion {
		return false, nil
	}
	rc.State = to
	rc.Version++
	if pharmacistID != nil {
		rc.PharmacistID = pharmacistID
	}
	if note != nil {
		rc.DecisionNote = note
	}
	fr := from
	f.appendCaseEvent(id, &fr, to, actorID, note) // event in the same "tx" as the CAS
	return true, nil
}

func (f *fakeRepo) ListReviewCaseEvents(_ context.Context, caseID string) ([]ReviewStateEvent, error) {
	out := make([]ReviewStateEvent, len(f.caseEvents[caseID]))
	copy(out, f.caseEvents[caseID])
	return out, nil
}

func (f *fakeRepo) ListReviewCases(_ context.Context, state, providerID string, _ int) ([]PharmacyReviewCase, error) {
	var out []PharmacyReviewCase
	for _, rc := range f.cases {
		if state != "" && string(rc.State) != state {
			continue
		}
		if providerID != "" && rc.PharmacyProviderID != providerID {
			continue
		}
		out = append(out, *rc)
	}
	return out, nil
}

func (f *fakeRepo) IsProviderPharmacist(_ context.Context, userID, providerID string) (bool, error) {
	return f.tenantOwner[providerID] == userID, nil
}

func (f *fakeRepo) UpsertTaxonomyRow(_ context.Context, entity, action, actorID string, payload map[string]any) (map[string]any, error) {
	return map[string]any{"id": "fake", "entity": entity, "action": action}, nil
}

// ─── fixtures (mirror the migration seeds) ───────────────────────────────────

func intPtr(v int) *int { return &v }

func newFakeRepo() *fakeRepo {
	f := &fakeRepo{
		terms:          map[string]Term{},
		concepts:       map[string]Concept{},
		clusters:       map[string]Cluster{},
		clusterMembers: map[string][]string{},
		classes:        map[string]TherapeuticClass{},
		disclaimer:     "These are options for your symptoms, not a diagnosis.",
		eventCtx:       map[string]*SearchEventContext{},
		cases:          map[string]*PharmacyReviewCase{},
		casesByOrder:   map[string]string{},
		caseEvents:     map[string][]ReviewStateEvent{},
		tenantOwner:    map[string]string{"prov-1": "pharm-1"},
	}
	addConcept := func(id, code, name string) {
		f.concepts[id] = Concept{ID: id, Code: code, Name: name, Status: StatusApproved}
	}
	addTerm := func(text, lang, conceptID string) {
		f.terms[normalizeTerm(text)] = Term{ID: "t-" + text, Term: text, Language: lang, ConceptID: conceptID, Status: StatusApproved}
	}
	addConcept("c-fever", "fever", "Fever / high temperature")
	addConcept("c-headache", "headache", "Headache")
	addConcept("c-bodypain", "body_pain", "Body pain / aches")
	addConcept("c-cough", "cough", "Cough")
	addConcept("c-chest", "chest_pain", "Chest pain")
	addConcept("c-orphan", "itchy_eye", "Itchy eye") // no cluster membership
	addTerm("fever", "en", "c-fever")
	addTerm("body dey hot", "pcm", "c-fever")
	addTerm("headache", "en", "c-headache")
	addTerm("body pain", "en", "c-bodypain")
	addTerm("cough", "en", "c-cough")
	addTerm("chest pain", "en", "c-chest")
	addTerm("itchy eye", "en", "c-orphan")

	f.classes["cls-para"] = TherapeuticClass{ID: "cls-para", Code: "analgesic_antipyretic",
		Name: "Pain & fever relief (Paracetamol-based)", UsageNote: "Follow the pack label.", Status: StatusApproved}
	f.classes["cls-nsaid"] = TherapeuticClass{ID: "cls-nsaid", Code: "nsaid",
		Name: "Pain & inflammation relief (Ibuprofen-based)", UsageNote: "Not on an empty stomach.", Status: StatusApproved}

	f.clusters["cl-hbp"] = Cluster{ID: "cl-hbp", Code: "headache_body_pain", Name: "Headache & body pain", TriageTier: TierT1, Status: StatusApproved}
	f.clusters["cl-fever"] = Cluster{ID: "cl-fever", Code: "fever_uncomplicated", Name: "Fever (uncomplicated, short)", TriageTier: TierT2, Status: StatusApproved}
	f.clusters["cl-chest"] = Cluster{ID: "cl-chest", Code: "chest_pain_redflag", Name: "Chest pain (red flag)", TriageTier: TierT4, Status: StatusApproved}
	f.clusterMembers["cl-hbp"] = []string{"c-headache", "c-bodypain"}
	f.clusterMembers["cl-fever"] = []string{"c-fever"}
	f.clusterMembers["cl-chest"] = []string{"c-chest"}

	escT3 := "T3"
	f.rules = []ClusterRule{
		{ID: "r1", ClusterID: "cl-fever", Expression: "duration_days > 3", Priority: 10,
			Effect: EffectEscalate, EscalateToTier: &escT3, Reason: "fever for more than 3 days", Status: StatusApproved},
		{ID: "r2", ClusterID: "cl-fever", Expression: "who:CHILD_UNDER_6", Priority: 20,
			Effect: EffectEscalate, EscalateToTier: &escT3, Reason: "fever in a child under 6", Status: StatusApproved},
		{ID: "r3", ClusterID: "cl-fever", Expression: "who:PREGNANT_OR_BF", Priority: 30,
			Effect: EffectRequireConfirmation, Reason: "fever while pregnant or breastfeeding", Status: StatusApproved},
		{ID: "r4", ClusterID: "cl-hbp", Expression: "who:PREGNANT_OR_BF", Priority: 40,
			Effect: EffectSuppressClass, SuppressClassID: strPtr("cls-nsaid"),
			Reason: "NSAIDs suppressed in pregnancy/breastfeeding", Status: StatusApproved},
	}
	f.classMap = []ClassMapEntry{
		{ClusterID: "cl-hbp", ClassID: "cls-para", Rank: 1},
		{ClusterID: "cl-hbp", ClassID: "cls-nsaid", Rank: 2},
		{ClusterID: "cl-fever", ClassID: "cls-para", Rank: 1},
	}
	f.skus = []Sku{
		{ID: "sku-otc", ProductID: "p1", Name: "Paracemol 500mg", Brand: "Emzor", PackSize: "24 tabs",
			PriceKobo: 55000, NAFDACRegNo: "A4-1234", Classification: ClassificationOTC,
			TherapeuticClassID: "cls-para", InStock: true, PregnancySafe: true},
		{ID: "sku-pharm", ProductID: "p2", Name: "Strong-P", Brand: "Fidson", PackSize: "12 tabs",
			PriceKobo: 90000, NAFDACRegNo: "A4-5678", Classification: ClassificationPharmacyOnly,
			TherapeuticClassID: "cls-para", InStock: true, PregnancySafe: false},
		{ID: "sku-pom", ProductID: "p3", Name: "Rx-Only Codeinol", Brand: "X", PackSize: "1",
			PriceKobo: 120000, NAFDACRegNo: "A4-9999", Classification: ClassificationPOM,
			TherapeuticClassID: "cls-para", InStock: true, PregnancySafe: false},
		{ID: "sku-blocked", ProductID: "p4", Name: "Blocked Online", Brand: "Y", PackSize: "1",
			PriceKobo: 130000, NAFDACRegNo: "A4-0000", Classification: ClassificationBlockedOnline,
			TherapeuticClassID: "cls-para", InStock: true, PregnancySafe: true},
		{ID: "sku-oos", ProductID: "p5", Name: "Out of stock", Brand: "Z", PackSize: "1",
			PriceKobo: 10000, NAFDACRegNo: "A4-1111", Classification: ClassificationOTC,
			TherapeuticClassID: "cls-para", InStock: false, PregnancySafe: true},
		{ID: "sku-adult", ProductID: "p6", Name: "Adult only", Brand: "W", PackSize: "1",
			PriceKobo: 20000, NAFDACRegNo: "A4-2222", Classification: ClassificationOTC,
			TherapeuticClassID: "cls-para", InStock: true, AgeMinYears: intPtr(12), PregnancySafe: true},
	}
	return f
}

func strPtr(s string) *string { return &s }

func newTestService() (*Service, *fakeRepo) {
	f := newFakeRepo()
	return NewService(f, nil), f
}

func resolve(t *testing.T, s *Service, terms []string, who, duration string) *SymptomSearchResult {
	t.Helper()
	res, err := s.Resolve(context.Background(), ResolveInput{
		UserID: "user-1", DeviceHash: "dev-hash", Terms: terms, Who: who, Duration: duration,
	})
	if err != nil {
		t.Fatalf("Resolve(%v, who=%q, dur=%q): %v", terms, who, duration, err)
	}
	return res
}

// ─── tier escalation (seed rules) ────────────────────────────────────────────

func TestResolve_FeverProlonged_EscalatesT3(t *testing.T) {
	s, _ := newTestService()
	res := resolve(t, s, []string{"fever"}, "", "GT_3D")
	if res.Tier != TierT3 {
		t.Fatalf("fever + GT_3D: tier = %s, want T3", res.Tier)
	}
	if res.EscalationCard == nil || res.EscalationCard.Severity != "CONSULT" {
		t.Fatalf("expected a CONSULT escalation card, got %+v", res.EscalationCard)
	}
	if len(res.ClassGroups) != 0 {
		t.Fatalf("T3 must never carry class groups, got %v", res.ClassGroups)
	}
	if len(res.EscalationCard.Actions) == 0 {
		t.Fatal("T3 card must route to care (pharmacist chat / telehealth)")
	}
}

func TestResolve_FeverChildUnder6_EscalatesT3(t *testing.T) {
	s, _ := newTestService()
	res := resolve(t, s, []string{"fever"}, CohortChildUnder6, "")
	if res.Tier != TierT3 {
		t.Fatalf("fever + CHILD_UNDER_6: tier = %s, want T3", res.Tier)
	}
	if res.EscalationCard == nil {
		t.Fatal("expected escalation card")
	}
}

func TestResolve_ChestPain_T4Emergency(t *testing.T) {
	s, _ := newTestService()
	res := resolve(t, s, []string{"chest pain"}, "", "")
	if res.Tier != TierT4 {
		t.Fatalf("chest pain: tier = %s, want T4", res.Tier)
	}
	if res.EscalationCard == nil || res.EscalationCard.Severity != "EMERGENCY" {
		t.Fatalf("expected EMERGENCY card, got %+v", res.EscalationCard)
	}
	if len(res.ClassGroups) != 0 {
		t.Fatal("T4 must never carry commerce (class groups)")
	}
	hasGuidance, hasFacility := false, false
	for _, a := range res.EscalationCard.Actions {
		if a.Type == "EMERGENCY_GUIDANCE" {
			hasGuidance = true
		}
		if a.Type == "NEAREST_FACILITY" {
			hasFacility = true
		}
	}
	if !hasGuidance || !hasFacility {
		t.Fatalf("T4 card must include emergency guidance + nearest facility, got %+v", res.EscalationCard.Actions)
	}
}

// Tier only ever goes UP: a T4 base cluster cannot be lowered by anything.
func TestResolve_MixedClusters_HighestTierWins(t *testing.T) {
	s, _ := newTestService()
	res := resolve(t, s, []string{"headache", "chest pain"}, "", "TODAY")
	if res.Tier != TierT4 {
		t.Fatalf("headache + chest pain: tier = %s, want T4 (highest wins)", res.Tier)
	}
}

// ─── T2 gate & multilingual match ────────────────────────────────────────────

func TestResolve_FeverBase_T2RequiresConfirmation(t *testing.T) {
	s, _ := newTestService()
	res := resolve(t, s, []string{"body dey hot"}, "", "TODAY") // pidgin term → fever
	if res.Tier != TierT2 {
		t.Fatalf("fever base: tier = %s, want T2", res.Tier)
	}
	if !res.PharmacistConfirmationRequired {
		t.Fatal("every T2 result must set pharmacist_confirmation_required")
	}
	if len(res.ClassGroups) == 0 {
		t.Fatal("T2 shows options behind the pharmacist gate — class groups expected")
	}
}

// ─── pregnancy suppression (suppressed, never shown-disabled) ────────────────

func TestResolve_Pregnancy_SuppressesNSAIDGroup(t *testing.T) {
	s, _ := newTestService()
	res := resolve(t, s, []string{"headache"}, CohortPregnantOrBF, "")
	if res.Tier != TierT1 {
		t.Fatalf("headache + pregnancy: tier = %s, want T1 (suppression does not escalate)", res.Tier)
	}
	if len(res.ClassGroups) != 1 {
		t.Fatalf("expected exactly the paracetamol group, got %+v", res.ClassGroups)
	}
	if res.ClassGroups[0].ClassID != "cls-para" {
		t.Fatalf("expected cls-para to survive, got %s", res.ClassGroups[0].ClassID)
	}
	for _, g := range res.ClassGroups {
		if g.ClassID == "cls-nsaid" {
			t.Fatal("NSAID group must be SUPPRESSED for pregnancy — never present")
		}
	}
}

func TestResolve_NoPregnancy_NSAIDPresent(t *testing.T) {
	s, _ := newTestService()
	res := resolve(t, s, []string{"headache"}, "", "")
	if len(res.ClassGroups) != 2 {
		t.Fatalf("expected paracetamol + NSAID groups, got %+v", res.ClassGroups)
	}
	if res.ClassGroups[0].ClassID != "cls-para" || res.ClassGroups[1].ClassID != "cls-nsaid" {
		t.Fatalf("groups must be rank-ordered, got %+v", res.ClassGroups)
	}
	if res.ClassGroups[0].SkusURL == "" || !strings.Contains(res.ClassGroups[0].SkusURL, "/classes/cls-para/skus") {
		t.Fatalf("class group must link to the live SKU endpoint, got %q", res.ClassGroups[0].SkusURL)
	}
}

// ─── fail-closed rule parsing ────────────────────────────────────────────────

func TestResolve_MalformedApprovedRule_FailsClosedToT3(t *testing.T) {
	s, f := newTestService()
	f.rules = append(f.rules, ClusterRule{
		ID: "r-bad", ClusterID: "cl-hbp", Expression: "concept:headache AND AND broken(",
		Priority: 1, Effect: EffectEscalate, EscalateToTier: strPtr("T2"), Status: StatusApproved,
	})
	res := resolve(t, s, []string{"headache"}, "", "")
	if res.Tier != TierT3 {
		t.Fatalf("malformed APPROVED rule must escalate to T3 (fail-closed), got %s", res.Tier)
	}
	if res.EscalationCard == nil {
		t.Fatal("expected escalation card on fail-closed path")
	}
}

// ─── never a dead end ────────────────────────────────────────────────────────

func TestResolve_ConceptWithoutCluster_T3ConsultNotEmpty(t *testing.T) {
	s, _ := newTestService()
	res := resolve(t, s, []string{"itchy eye"}, "", "")
	if res.Tier != TierT3 {
		t.Fatalf("no cluster match: tier = %s, want T3", res.Tier)
	}
	if res.Unmatched {
		t.Fatal("a matched concept without a cluster is NOT an unmatched search")
	}
	if res.EscalationCard == nil || len(res.EscalationCard.Actions) == 0 {
		t.Fatal("no-cluster resolution must still route to care — never a dead end")
	}
}

func TestResolve_NoTermMatch_UnmatchedLoggedForCuration(t *testing.T) {
	s, f := newTestService()
	res := resolve(t, s, []string{"xyzzy nonsense"}, "", "")
	if !res.Unmatched {
		t.Fatal("expected Unmatched=true when no term matches the taxonomy")
	}
	if res.Tier != TierT3 || res.EscalationCard == nil {
		t.Fatal("even a zero-match must carry a T3 consult card (never a dead end)")
	}
	if len(f.events) != 1 {
		t.Fatalf("expected exactly one search event, got %d", len(f.events))
	}
	ev := f.events[0]
	if ev.Matched {
		t.Fatal("event must record matched=false")
	}
	if len(ev.UnmatchedTerms) != 1 || ev.UnmatchedTerms[0] != "xyzzy nonsense" {
		t.Fatalf("unmatched terms must feed the synonym growth loop, got %v", ev.UnmatchedTerms)
	}
}

func TestResolve_EventLoggedWithoutRawRefinerPII(t *testing.T) {
	s, f := newTestService()
	_ = resolve(t, s, []string{"fever"}, CohortPregnantOrBF, "D2_3")
	if len(f.events) != 1 {
		t.Fatalf("expected one event, got %d", len(f.events))
	}
	ev := f.events[0]
	if ev.DeviceHash != "dev-hash" || ev.UserID == nil || *ev.UserID != "user-1" {
		t.Fatalf("event must carry the salted device hash + user id, got %+v", ev)
	}
	if ev.Refiners["who"] != CohortPregnantOrBF || ev.Refiners["duration"] != "D2_3" {
		t.Fatalf("refiners must be recorded as structured values, got %v", ev.Refiners)
	}
}

// ─── SKU surface gates ───────────────────────────────────────────────────────

func TestListClassSkus_POMAndBlockedNeverSurface(t *testing.T) {
	s, _ := newTestService()
	// The fake repo intentionally returns POM + BLOCKED_ONLINE rows; the
	// service must drop them (defence in depth over the SQL filter).
	out, err := s.ListClassSkus(context.Background(), "cls-para", "", "", 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range out {
		if o.Classification != ClassificationOTC && o.Classification != ClassificationPharmacyOnly {
			t.Fatalf("classification %s leaked to the symptom surface (Sev-1)", o.Classification)
		}
		if o.ID == "sku-pom" || o.ID == "sku-blocked" {
			t.Fatalf("SKU %s must never surface", o.ID)
		}
	}
	if len(out) != 3 { // sku-otc, sku-pharm, sku-adult (in stock, legal classes)
		t.Fatalf("expected 3 surfaced SKUs, got %d: %+v", len(out), out)
	}
}

func TestListClassSkus_OutOfStockExcluded(t *testing.T) {
	s, _ := newTestService()
	out, err := s.ListClassSkus(context.Background(), "cls-para", "", "", 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range out {
		if o.ID == "sku-oos" {
			t.Fatal("out-of-stock SKU surfaced")
		}
	}
}

func TestListClassSkus_CohortFilters(t *testing.T) {
	s, _ := newTestService()
	// Pregnant/BF: only pregnancy_safe SKUs (fail-closed default false).
	out, err := s.ListClassSkus(context.Background(), "cls-para", "", CohortPregnantOrBF, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range out {
		if o.ID == "sku-pharm" {
			t.Fatal("non-pregnancy-safe SKU surfaced for PREGNANT_OR_BF")
		}
	}
	// Child under 6: any declared minimum age excludes.
	out, err = s.ListClassSkus(context.Background(), "cls-para", "", CohortChildUnder6, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range out {
		if o.ID == "sku-adult" {
			t.Fatal("age_min 12 SKU surfaced for CHILD_UNDER_6")
		}
	}
}

func TestListClassSkus_UnknownClass404(t *testing.T) {
	s, _ := newTestService()
	_, err := s.ListClassSkus(context.Background(), "cls-ghost", "", "", 20, 0)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected ErrNotFound for unknown class, got %v", err)
	}
}

// ─── review-case state machine ───────────────────────────────────────────────

func TestReviewStateMachine_EdgeMap(t *testing.T) {
	legal := [][2]ReviewState{
		{ReviewSubmitted, ReviewAutoCleared},
		{ReviewSubmitted, ReviewPharmacistReview},
		{ReviewPharmacistReview, ReviewApproved},
		{ReviewPharmacistReview, ReviewRejected},
		{ReviewPharmacistReview, ReviewNeedsInfo},
		{ReviewNeedsInfo, ReviewPharmacistReview},
	}
	for _, e := range legal {
		if !CanTransitionReview(e[0], e[1]) {
			t.Errorf("legal edge %s -> %s rejected", e[0], e[1])
		}
	}
	illegal := [][2]ReviewState{
		{ReviewSubmitted, ReviewApproved}, // must pass through review/auto-clear
		{ReviewSubmitted, ReviewRejected},
		{ReviewAutoCleared, ReviewPharmacistReview}, // terminal
		{ReviewApproved, ReviewRejected},            // terminal
		{ReviewRejected, ReviewApproved},            // terminal
		{ReviewNeedsInfo, ReviewApproved},           // must return to review first
		{ReviewNeedsInfo, ReviewRejected},
	}
	for _, e := range illegal {
		if CanTransitionReview(e[0], e[1]) {
			t.Errorf("illegal edge %s -> %s allowed", e[0], e[1])
		}
	}
}

func TestReviewCase_T1AutoCleared(t *testing.T) {
	s, _ := newTestService()
	rc, err := s.CreateReviewCaseForOrder(context.Background(), "user-1", "order-1", "prov-1", TierT1)
	if err != nil {
		t.Fatal(err)
	}
	if rc.State != ReviewAutoCleared {
		t.Fatalf("T1 order: state = %s, want AUTO_CLEARED", rc.State)
	}
}

func TestReviewCase_T2RoutesToPharmacistAndIsIdempotent(t *testing.T) {
	s, _ := newTestService()
	rc, err := s.CreateReviewCaseForOrder(context.Background(), "user-1", "order-2", "prov-1", TierT2)
	if err != nil {
		t.Fatal(err)
	}
	if rc.State != ReviewPharmacistReview {
		t.Fatalf("T2 order: state = %s, want PHARMACIST_REVIEW", rc.State)
	}
	// Replay: same order → same case, state unchanged.
	again, err := s.CreateReviewCaseForOrder(context.Background(), "user-1", "order-2", "prov-1", TierT2)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != rc.ID || again.State != ReviewPharmacistReview {
		t.Fatalf("replay must return the existing case unchanged, got %+v", again)
	}
}

func TestReviewCase_DecisionFlow(t *testing.T) {
	s, _ := newTestService()
	ctx := context.Background()
	rc, _ := s.CreateReviewCaseForOrder(ctx, "user-1", "order-3", "prov-1", TierT2)

	// NEEDS_INFO without a note → validation error.
	if _, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "NEEDS_INFO", "  ", false); err == nil {
		t.Fatal("NEEDS_INFO without a note must be rejected")
	}
	// NEEDS_INFO with a note → legal.
	got, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "NEEDS_INFO", "please confirm patient age", false)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != ReviewNeedsInfo || got.DecisionNote == nil {
		t.Fatalf("expected NEEDS_INFO with note, got %+v", got)
	}
	// APPROVE straight from NEEDS_INFO → illegal (must resume first).
	if _, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "APPROVE", "", false); err == nil {
		t.Fatal("NEEDS_INFO -> APPROVED must be rejected")
	}
	// Resume the loop: NEEDS_INFO → PHARMACIST_REVIEW.
	if _, err := s.ResumeReviewCase(ctx, "user-1", rc.ID); err != nil {
		t.Fatal(err)
	}
	// APPROVE now legal.
	got, err = s.DecideReviewCase(ctx, "pharm-1", rc.ID, "APPROVE", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != ReviewApproved {
		t.Fatalf("expected APPROVED, got %s", got.State)
	}
	// Replaying the same decision is idempotent.
	got, err = s.DecideReviewCase(ctx, "pharm-1", rc.ID, "APPROVE", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != ReviewApproved {
		t.Fatalf("idempotent replay broke: %s", got.State)
	}
	// APPROVED is terminal — REJECT must fail.
	if _, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "REJECT", "changed my mind", false); err == nil {
		t.Fatal("APPROVED -> REJECTED must be rejected (terminal state)")
	}
}

func TestReviewCase_RejectRequiresNote(t *testing.T) {
	s, _ := newTestService()
	ctx := context.Background()
	rc, _ := s.CreateReviewCaseForOrder(ctx, "user-1", "order-4", "prov-1", TierT2)
	if _, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "REJECT", "", false); err == nil {
		t.Fatal("REJECT without a note must be rejected")
	}
	got, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "REJECT", "interaction risk", false)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != ReviewRejected {
		t.Fatalf("expected REJECTED, got %s", got.State)
	}
}

func TestReviewCase_TenantObjectAuthz(t *testing.T) {
	s, _ := newTestService()
	ctx := context.Background()
	rc, _ := s.CreateReviewCaseForOrder(ctx, "user-1", "order-5", "prov-1", TierT2)
	// A pharmacist from another premises tenant reads not-found.
	if _, err := s.DecideReviewCase(ctx, "other-pharmacist", rc.ID, "APPROVE", "", false); err == nil {
		t.Fatal("foreign-tenant decision must be rejected")
	}
	// Superintendent override may decide across tenants.
	if _, err := s.DecideReviewCase(ctx, "other-pharmacist", rc.ID, "APPROVE", "", true); err != nil {
		t.Fatalf("superintendent override failed: %v", err)
	}
}

func TestReviewCase_InvalidDecision(t *testing.T) {
	s, _ := newTestService()
	ctx := context.Background()
	rc, _ := s.CreateReviewCaseForOrder(ctx, "user-1", "order-6", "prov-1", TierT2)
	if _, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "MAYBE", "", false); err == nil {
		t.Fatal("unknown decision must be rejected")
	}
}

// ─── search-event linking (order seam, PRD §10) ──────────────────────────────

func TestResolve_ReturnsSearchEventID(t *testing.T) {
	s, f := newTestService()
	res := resolve(t, s, []string{"fever"}, "", "TODAY")
	if res.SearchEventID == "" {
		t.Fatal("resolve must return the logged search_event_id for order linking")
	}
	if len(f.events) != 1 {
		t.Fatalf("expected one logged event, got %d", len(f.events))
	}
	ev := f.events[0]
	if len(ev.MatchedConcepts) == 0 {
		t.Fatal("event must snapshot the matched concept names")
	}
	if ev.ClusterName == nil || *ev.ClusterName != "Fever (uncomplicated, short)" {
		t.Fatalf("event must snapshot the primary cluster name, got %v", ev.ClusterName)
	}
}

func TestOrderSeam_POMLineNoContext_PharmacistReview(t *testing.T) {
	s, _ := newTestService()
	rc, err := s.CreateReviewCaseForOrderFromContext(context.Background(), "user-1", "order-pom", "prov-1", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if rc == nil {
		t.Fatal("an rx_required order must ALWAYS open a review case — POM gate regardless of entry path")
	}
	if rc.State != ReviewPharmacistReview || rc.Tier != TierT2 {
		t.Fatalf("POM order without search context: state=%s tier=%s, want PHARMACIST_REVIEW/T2", rc.State, rc.Tier)
	}
	if rc.SearchEventID != nil {
		t.Fatal("no search context ⇒ no search_event_id on the case")
	}
}

func TestOrderSeam_T1Context_AutoCleared(t *testing.T) {
	s, f := newTestService()
	t1 := "T1"
	f.eventCtx["ev-t1"] = &SearchEventContext{ID: "ev-t1", Terms: []string{"headache"}, ResolvedTier: &t1}
	sid := "ev-t1"
	rc, err := s.CreateReviewCaseForOrderFromContext(context.Background(), "user-1", "order-t1", "prov-1", &sid, false)
	if err != nil {
		t.Fatal(err)
	}
	if rc == nil || rc.State != ReviewAutoCleared || rc.Tier != TierT1 {
		t.Fatalf("T1 search context: got %+v, want AUTO_CLEARED/T1", rc)
	}
	if rc.SearchEventID == nil || *rc.SearchEventID != "ev-t1" {
		t.Fatalf("case must link the search event, got %v", rc.SearchEventID)
	}
}

func TestOrderSeam_T2ContextWithPOM_TierNeverLowered(t *testing.T) {
	s, f := newTestService()
	t1 := "T1"
	f.eventCtx["ev-low"] = &SearchEventContext{ID: "ev-low", ResolvedTier: &t1}
	sid := "ev-low"
	// T1 context but an rx_required line: POM gate wins — tier goes UP, never down.
	rc, err := s.CreateReviewCaseForOrderFromContext(context.Background(), "user-1", "order-mix", "prov-1", &sid, true)
	if err != nil {
		t.Fatal(err)
	}
	if rc.State != ReviewPharmacistReview || rc.Tier != TierT2 {
		t.Fatalf("POM line must force at least T2 even with T1 context, got state=%s tier=%s", rc.State, rc.Tier)
	}
}

func TestOrderSeam_NoContextNoPOM_NoCase(t *testing.T) {
	s, f := newTestService()
	rc, err := s.CreateReviewCaseForOrderFromContext(context.Background(), "user-1", "order-otc", "prov-1", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if rc != nil {
		t.Fatalf("plain OTC catalogue order must open NO case, got %+v", rc)
	}
	if len(f.cases) != 0 {
		t.Fatal("no case row may be written for an ungated order")
	}
}

func TestOrderSeam_UnknownSearchEvent_FailsClosedT2(t *testing.T) {
	s, _ := newTestService()
	sid := "ev-ghost"
	rc, err := s.CreateReviewCaseForOrderFromContext(context.Background(), "user-1", "order-ghost", "prov-1", &sid, false)
	if err != nil {
		t.Fatal(err)
	}
	if rc == nil || rc.State != ReviewPharmacistReview || rc.Tier != TierT2 {
		t.Fatalf("unknown search event must fail CLOSED to pharmacist review, got %+v", rc)
	}
	if rc.SearchEventID != nil {
		t.Fatal("a dangling search_event_id must NOT be linked onto the case")
	}
}

// A search event owned by ANOTHER user must never link onto this order's case
// (its symptom terms would otherwise surface in the pharmacist drawer) — the
// context is treated as unlinkable and fails closed to pharmacist review.
func TestOrderSeam_ForeignUsersSearchEvent_NotLinkedFailsClosed(t *testing.T) {
	s, f := newTestService()
	t1, other := "T1", "user-OTHER"
	f.eventCtx["ev-foreign"] = &SearchEventContext{ID: "ev-foreign", UserID: &other, Terms: []string{"fever"}, ResolvedTier: &t1}
	sid := "ev-foreign"
	rc, err := s.CreateReviewCaseForOrderFromContext(context.Background(), "user-1", "order-foreign", "prov-1", &sid, false)
	if err != nil {
		t.Fatal(err)
	}
	if rc == nil || rc.State != ReviewPharmacistReview || rc.Tier != TierT2 {
		t.Fatalf("foreign-user search event must fail CLOSED to pharmacist review, got %+v", rc)
	}
	if rc.SearchEventID != nil {
		t.Fatal("another user's search_event_id must NOT be linked onto the case")
	}
}

// ─── read-path tenant scoping (object-level authz on review reads) ───────────

func TestGetReviewCaseDetail_ForeignTenantReadsNotFound(t *testing.T) {
	s, _ := newTestService()
	ctx := context.Background()
	rc, _ := s.CreateReviewCaseForOrder(ctx, "user-1", "order-authz-1", "prov-1", TierT2)
	// A pharmacist from another premises tenant reads not-found.
	if _, err := s.GetReviewCaseDetail(ctx, "other-pharmacist", rc.ID, false); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("foreign-tenant detail read must be not-found, got %v", err)
	}
	// The superintendent override may read across tenants.
	if _, err := s.GetReviewCaseDetail(ctx, "other-pharmacist", rc.ID, true); err != nil {
		t.Fatalf("superintendent detail read failed: %v", err)
	}
	// The owning pharmacist reads normally.
	if _, err := s.GetReviewCaseDetail(ctx, "pharm-1", rc.ID, false); err != nil {
		t.Fatalf("own-tenant detail read failed: %v", err)
	}
}

func TestListReviewCases_TenantScoped(t *testing.T) {
	s, _ := newTestService()
	ctx := context.Background()
	_, _ = s.CreateReviewCaseForOrder(ctx, "user-1", "order-authz-2", "prov-1", TierT2)
	// Unscoped query without the override is rejected fail-closed.
	if _, err := s.ListReviewCases(ctx, "pharm-1", "", "", false); err == nil {
		t.Fatal("unscoped queue read without superintendent override must be rejected")
	}
	// Own tenant lists its cases.
	own, err := s.ListReviewCases(ctx, "pharm-1", "", "prov-1", false)
	if err != nil || len(own) != 1 {
		t.Fatalf("own-tenant queue read: %v, %d cases", err, len(own))
	}
	// A foreign tenant reads an empty queue (no enumeration).
	foreign, err := s.ListReviewCases(ctx, "other-pharmacist", "", "prov-1", false)
	if err != nil || len(foreign) != 0 {
		t.Fatalf("foreign-tenant queue must read empty, got %v, %d cases", err, len(foreign))
	}
	// The superintendent override lists across tenants without a filter.
	all, err := s.ListReviewCases(ctx, "other-pharmacist", "", "", true)
	if err != nil || len(all) != 1 {
		t.Fatalf("override queue read: %v, %d cases", err, len(all))
	}
}

// ─── evented review-case history ─────────────────────────────────────────────

func TestReviewCase_EventRowPerTransition(t *testing.T) {
	s, f := newTestService()
	ctx := context.Background()
	rc, err := s.CreateReviewCaseForOrder(ctx, "user-1", "order-h1", "prov-1", TierT2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "NEEDS_INFO", "confirm patient age", false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResumeReviewCase(ctx, "user-1", rc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "APPROVE", "", false); err != nil {
		t.Fatal(err)
	}
	want := []ReviewState{ReviewSubmitted, ReviewPharmacistReview, ReviewNeedsInfo, ReviewPharmacistReview, ReviewApproved}
	evs := f.caseEvents[rc.ID]
	if len(evs) != len(want) {
		t.Fatalf("expected %d event rows (one per transition incl. creation), got %d: %+v", len(want), len(evs), evs)
	}
	for i, w := range want {
		if evs[i].State != w {
			t.Fatalf("event[%d] = %s, want %s", i, evs[i].State, w)
		}
	}
	if evs[0].FromState != nil {
		t.Fatal("creation event must carry a NULL from_state")
	}
	if evs[2].FromState == nil || *evs[2].FromState != ReviewPharmacistReview {
		t.Fatalf("NEEDS_INFO event must chain from PHARMACIST_REVIEW, got %v", evs[2].FromState)
	}
	if evs[2].Note == nil || *evs[2].Note != "confirm patient age" {
		t.Fatal("the NEEDS_INFO note must ride on its event row")
	}
	if evs[4].Actor != "pharm-1" {
		t.Fatalf("decision event must carry the acting pharmacist, got %q", evs[4].Actor)
	}
	// Idempotent replay of a decision writes NO extra event.
	if _, err := s.DecideReviewCase(ctx, "pharm-1", rc.ID, "APPROVE", "", false); err != nil {
		t.Fatal(err)
	}
	if len(f.caseEvents[rc.ID]) != len(want) {
		t.Fatal("idempotent same-state replay must not append an event row")
	}
}

func TestGetReviewCaseDetail_RealHistoryAndSearchContext(t *testing.T) {
	s, f := newTestService()
	ctx := context.Background()
	t2 := "T2"
	cn := "Fever (uncomplicated, short)"
	f.eventCtx["ev-ctx"] = &SearchEventContext{
		ID: "ev-ctx", Terms: []string{"fever"},
		MatchedConcepts: []string{"Fever / high temperature"},
		ClusterName:     &cn,
		CohortFlags:     []string{CohortPregnantOrBF},
		ResolvedTier:    &t2,
	}
	sid := "ev-ctx"
	rc, err := s.CreateReviewCaseForOrderFromContext(ctx, "user-1", "order-det", "prov-1", &sid, false)
	if err != nil {
		t.Fatal(err)
	}
	det, err := s.GetReviewCaseDetail(ctx, "pharm-1", rc.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(det.History) != 2 || det.History[0].State != ReviewSubmitted || det.History[1].State != ReviewPharmacistReview {
		t.Fatalf("detail must read the REAL evented history, got %+v", det.History)
	}
	if det.History[0].FromState != nil {
		t.Fatal("first history entry is the creation event (nil from_state)")
	}
	if len(det.SymptomTerms) != 1 || det.SymptomTerms[0] != "fever" {
		t.Fatalf("detail must carry the linked search terms, got %v", det.SymptomTerms)
	}
	if len(det.MatchedConcepts) != 1 || det.MatchedConcepts[0] != "Fever / high temperature" {
		t.Fatalf("detail must carry the matched concepts, got %v", det.MatchedConcepts)
	}
	if det.ClusterName == nil || *det.ClusterName != cn {
		t.Fatalf("detail must carry the cluster name, got %v", det.ClusterName)
	}
	if len(det.CohortFlags) != 1 || det.CohortFlags[0] != CohortPregnantOrBF {
		t.Fatalf("detail must carry the cohort flags, got %v", det.CohortFlags)
	}
}

func TestGetReviewCaseDetail_NoEvents_FallsBackToDerived(t *testing.T) {
	s, f := newTestService()
	ctx := context.Background()
	rc, err := s.CreateReviewCaseForOrder(ctx, "user-1", "order-legacy", "prov-1", TierT2)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a case predating the events table.
	delete(f.caseEvents, rc.ID)
	det, err := s.GetReviewCaseDetail(ctx, "pharm-1", rc.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(det.History) == 0 {
		t.Fatal("empty events table must fall back to the derived history — never an empty trail")
	}
	if det.History[0].State != ReviewSubmitted {
		t.Fatalf("derived history must start at SUBMITTED, got %s", det.History[0].State)
	}
}
