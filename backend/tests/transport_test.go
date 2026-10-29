package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/transport/hail"
)

// ---- in-memory fakes -------------------------------------------------------

type tpRepo struct {
	mu      sync.Mutex
	seq     int
	trips   map[string]*hail.Trip
	drivers map[string]*hail.Driver // by driver id
}

func newTpRepo() *tpRepo {
	return &tpRepo{trips: map[string]*hail.Trip{}, drivers: map[string]*hail.Driver{}}
}

func (r *tpRepo) addDriver(userID string, st hail.DriverStatus) *hail.Driver {
	r.mu.Lock()
	defer r.mu.Unlock()
	d := &hail.Driver{ID: "drv-" + userID, UserID: userID, Status: st}
	r.drivers[d.ID] = d
	return d
}

func (r *tpRepo) CreateTrip(_ context.Context, t *hail.Trip) (*hail.Trip, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.trips {
		if e.RiderID == t.RiderID && e.IdempotencyKey == t.IdempotencyKey {
			c := *e
			return &c, false, nil
		}
	}
	r.seq++
	c := *t
	c.ID = fmt.Sprintf("trip-%d", r.seq)
	r.trips[c.ID] = &c
	out := c
	return &out, true, nil
}

func (r *tpRepo) GetTrip(_ context.Context, id string) (*hail.Trip, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.trips[id]
	if !ok {
		return nil, hail.ErrNotFound
	}
	c := *t
	return &c, nil
}

func (r *tpRepo) DriverByUser(_ context.Context, uid string) (*hail.Driver, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, d := range r.drivers {
		if d.UserID == uid {
			c := *d
			return &c, nil
		}
	}
	return nil, hail.ErrNotFound
}

func (r *tpRepo) DemandSupply(context.Context) (int64, int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var a, v int64
	for _, t := range r.trips {
		if t.Status == hail.StatusRequested || t.Status == hail.StatusMatched {
			a++
		}
	}
	for _, d := range r.drivers {
		if d.Status == hail.DriverAvailable {
			v++
		}
	}
	return a, v, nil
}

// AssignDriver deliberately has NO atomic guard of its own beyond the status
// checks; the double-booking tests prove the lock, and this counts violations.
func (r *tpRepo) AssignDriver(_ context.Context, tripID, driverID string) (*hail.Trip, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, d := r.trips[tripID], r.drivers[driverID]
	if d.Status != hail.DriverAvailable {
		return nil, hail.ErrDriverUnavailable
	}
	if t.Status != hail.StatusRequested {
		return nil, hail.ErrNotRequested
	}
	d.Status, t.Status = hail.DriverBusy, hail.StatusMatched
	t.DriverID = &driverID
	c := *t
	return &c, nil
}

func (r *tpRepo) CompleteTrip(_ context.Context, id string, ds, ps int64) (*hail.Trip, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.trips[id]
	if t.Status != hail.StatusMatched {
		return nil, hail.ErrNotMatched
	}
	t.Status, t.DriverShareKobo, t.PlatformShareKobo = hail.StatusCompleted, &ds, &ps
	r.drivers[*t.DriverID].Status = hail.DriverAvailable
	c := *t
	return &c, nil
}

type tpLocker struct {
	mu   sync.Mutex
	held map[string]string
	n    int
}

func newTpLocker() *tpLocker { return &tpLocker{held: map[string]string{}} }

func (l *tpLocker) Acquire(_ context.Context, key string, _ time.Duration) (string, bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.held[key]; ok {
		return "", false, nil
	}
	l.n++
	tok := fmt.Sprint(l.n)
	l.held[key] = tok
	return tok, true, nil
}

func (l *tpLocker) Release(_ context.Context, key, tok string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.held[key] == tok {
		delete(l.held, key)
	}
	return nil
}

type tpLedger struct {
	mu       sync.Mutex
	posted   map[string]bool
	debits   int64 // rider debited
	credits  int64 // driver + platform credited
	failWith error
	calls    int
}

func (l *tpLedger) Settle(_ context.Context, key, _, _, _ string, fare, d, p int64) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls++
	if l.failWith != nil {
		return l.failWith
	}
	if l.posted == nil {
		l.posted = map[string]bool{}
	}
	if l.posted[key] {
		return nil
	}
	l.posted[key] = true
	l.debits += fare
	l.credits += d + p
	return nil
}

type tpEnv struct {
	repo *tpRepo
	lock *tpLocker
	led  *tpLedger
	svc  *hail.Service
	gate *tpGate
	aud  *tpAuditor
}

func newTpEnv() *tpEnv {
	e := &tpEnv{repo: newTpRepo(), lock: newTpLocker(), led: &tpLedger{}}
	e.gate = &tpGate{}
	e.aud = &tpAuditor{}
	e.svc = hail.NewService(e.repo, e.lock, e.led).WithWalletGate(e.gate).WithAuditor(e.aud)
	return e
}

func (e *tpEnv) request(t *testing.T, rider, key string) *hail.Trip {
	t.Helper()
	tr, err := e.svc.RequestTrip(context.Background(), rider, 6.5, 3.3, 6.6, 3.4, key)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	return tr
}

// ---- surge math ------------------------------------------------------------

func TestTransportSurge_Table(t *testing.T) {
	cases := []struct {
		name          string
		active, avail int64
		want          int64
	}{
		{"no demand", 0, 5, 10000},
		{"no demand no drivers", 0, 0, 10000},
		{"quarter", 1, 4, 12500},
		{"half", 5, 10, 15000},
		{"just under cap", 9, 10, 19000},
		{"equal hits cap", 4, 4, 20000},
		{"over cap clamped", 50, 4, 20000},
		{"no drivers capped", 3, 0, 20000},
	}
	for _, c := range cases {
		if got := hail.SurgeBPS(c.active, c.avail); got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}
}

func TestTransportSurge_AlwaysWithinBounds(t *testing.T) {
	for a := int64(0); a < 40; a++ {
		for v := int64(0); v < 40; v++ {
			if m := hail.SurgeBPS(a, v); m < 10000 || m > 20000 {
				t.Fatalf("out of range a=%d v=%d m=%d", a, v, m)
			}
		}
	}
}

func TestTransportFare_SurgeExample(t *testing.T) {
	// 5 active trips / 10 available drivers => 1.5x on NGN 1,500 => NGN 2,250.
	bps := hail.SurgeBPS(5, 10)
	if got := hail.Fare(150000, bps); got != 225000 {
		t.Fatalf("fare=%d want 225000", got)
	}
	if got := hail.Fare(150001, 12500); got != 187501 { // floor of 187501.25
		t.Fatalf("rounding fare=%d", got)
	}
}

func TestTransportSplit_ConservesToTheKobo(t *testing.T) {
	for _, f := range []int64{1, 2, 3, 99, 100, 150000, 187501, 299999, 300000} {
		d, p := hail.Split(f)
		if d+p != f {
			t.Fatalf("fare %d: %d+%d != fare", f, d, p)
		}
		if f == 150000 && (d != 105000 || p != 45000) {
			t.Fatalf("70/30 of 150000 = %d/%d", d, p)
		}
	}
}

// ---- service flow ----------------------------------------------------------

func TestTransportRequest_UsesLiveSurge(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	e.repo.addDriver("d2", hail.DriverAvailable)
	first := e.request(t, "r1", "k1") // 0 active / 2 avail => 1.0x
	if first.SurgeBPS != 10000 || first.FareKobo != 150000 {
		t.Fatalf("first: %+v", first)
	}
	second := e.request(t, "r2", "k2") // 1 active / 2 avail => 1.5x
	if second.SurgeBPS != 15000 || second.FareKobo != 225000 {
		t.Fatalf("second: %+v", second)
	}
}

func TestTransportRequest_IdempotentAndValidated(t *testing.T) {
	e := newTpEnv()
	a, b := e.request(t, "r1", "same"), e.request(t, "r1", "same")
	if a.ID != b.ID || len(e.repo.trips) != 1 {
		t.Fatal("replay created a second trip")
	}
	if _, err := e.svc.RequestTrip(context.Background(), "r1", 1, 1, 2, 2, ""); !errors.Is(err, hail.ErrIdempotencyKey) {
		t.Fatalf("missing key: %v", err)
	}
	if _, err := e.svc.RequestTrip(context.Background(), "r1", 91, 1, 2, 2, "k"); !errors.Is(err, hail.ErrInvalidInput) {
		t.Fatalf("bad lat: %v", err)
	}
}

func TestTransportHappyPath_SettlementBalanced(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	tr := e.request(t, "r1", "k1")
	m, err := e.svc.ConfirmDriver(context.Background(), tr.ID, "d1", "c1")
	if err != nil || m.Status != hail.StatusMatched {
		t.Fatalf("confirm: %v %+v", err, m)
	}
	done, err := e.svc.CompleteTrip(context.Background(), tr.ID, "d1", "x1")
	if err != nil || done.Status != hail.StatusCompleted {
		t.Fatalf("complete: %v %+v", err, done)
	}
	if *done.DriverShareKobo != 105000 || *done.PlatformShareKobo != 45000 {
		t.Fatalf("split %d/%d", *done.DriverShareKobo, *done.PlatformShareKobo)
	}
	if e.led.debits != e.led.credits || e.led.debits != done.FareKobo {
		t.Fatalf("ledger unbalanced debits=%d credits=%d", e.led.debits, e.led.credits)
	}
	if d, _ := e.repo.DriverByUser(context.Background(), "d1"); d.Status != hail.DriverAvailable {
		t.Fatal("driver not freed")
	}
}

func TestTransportComplete_IdempotentNoDoubleSettle(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	tr := e.request(t, "r1", "k1")
	_, _ = e.svc.ConfirmDriver(context.Background(), tr.ID, "d1", "c1")
	for i := 0; i < 3; i++ {
		if _, err := e.svc.CompleteTrip(context.Background(), tr.ID, "d1", "x"); err != nil {
			t.Fatal(err)
		}
	}
	if e.led.calls != 1 || e.led.debits != tr.FareKobo {
		t.Fatalf("calls=%d debits=%d", e.led.calls, e.led.debits)
	}
}

func TestTransportComplete_OnlyAssignedDriverAndInsufficientFunds(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	e.repo.addDriver("d2", hail.DriverAvailable)
	tr := e.request(t, "r1", "k1")
	_, _ = e.svc.ConfirmDriver(context.Background(), tr.ID, "d1", "c1")
	if _, err := e.svc.CompleteTrip(context.Background(), tr.ID, "d2", "x"); !errors.Is(err, hail.ErrForbidden) {
		t.Fatalf("other driver: %v", err)
	}
	e.led.failWith = hail.ErrInsufficientFunds
	if _, err := e.svc.CompleteTrip(context.Background(), tr.ID, "d1", "x"); !errors.Is(err, hail.ErrInsufficientFunds) {
		t.Fatalf("funds: %v", err)
	}
	if got, _ := e.repo.GetTrip(context.Background(), tr.ID); got.Status != hail.StatusMatched {
		t.Fatalf("trip must stay matched on failed settle, got %s", got.Status)
	}
}

func TestTransportGet_OwnerScoped(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	e.repo.addDriver("d2", hail.DriverAvailable)
	tr := e.request(t, "r1", "k1")
	_, _ = e.svc.ConfirmDriver(context.Background(), tr.ID, "d1", "c1")
	ctx := context.Background()
	for _, ok := range []string{"r1", "d1"} {
		if _, err := e.svc.GetTrip(ctx, tr.ID, ok); err != nil {
			t.Errorf("%s should read: %v", ok, err)
		}
	}
	for _, bad := range []string{"r2", "d2", "stranger"} {
		if _, err := e.svc.GetTrip(ctx, tr.ID, bad); !errors.Is(err, hail.ErrNotFound) {
			t.Errorf("%s should get not found, got %v", bad, err)
		}
	}
}

// ---- lock behaviour --------------------------------------------------------

func TestTransportMatch_HeldLockIsContended(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	tr := e.request(t, "r1", "k1")
	if _, ok, _ := e.lock.Acquire(context.Background(), "transport:trip:"+tr.ID, time.Minute); !ok {
		t.Fatal("setup")
	}
	if _, err := e.svc.ConfirmDriver(context.Background(), tr.ID, "d1", "c"); !errors.Is(err, hail.ErrLockContended) {
		t.Fatalf("want contended, got %v", err)
	}
}

func TestTransportMatch_LockReleasedAfterMatch(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	tr := e.request(t, "r1", "k1")
	_, _ = e.svc.ConfirmDriver(context.Background(), tr.ID, "d1", "c")
	if len(e.lock.held) != 0 {
		t.Fatalf("locks leaked: %v", e.lock.held)
	}
	// Replay by the same driver is idempotent.
	if m, err := e.svc.ConfirmDriver(context.Background(), tr.ID, "d1", "c"); err != nil || m.Status != hail.StatusMatched {
		t.Fatalf("replay: %v", err)
	}
}

func TestTransportMatch_TenDriversOneTripExactlyOneWins(t *testing.T) {
	e := newTpEnv()
	for i := 0; i < 10; i++ {
		e.repo.addDriver(fmt.Sprintf("d%d", i), hail.DriverAvailable)
	}
	tr := e.request(t, "r1", "k1")
	var wins, losses int32
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, err := e.svc.ConfirmDriver(context.Background(), tr.ID, fmt.Sprintf("d%d", i), "c")
			if err == nil {
				atomic.AddInt32(&wins, 1)
			} else if errors.Is(err, hail.ErrLockContended) || errors.Is(err, hail.ErrNotRequested) {
				atomic.AddInt32(&losses, 1)
			} else {
				t.Errorf("unexpected: %v", err)
			}
		}(i)
	}
	close(start)
	wg.Wait()
	if wins != 1 || losses != 9 {
		t.Fatalf("wins=%d losses=%d", wins, losses)
	}
	busy := 0
	for _, d := range e.repo.drivers {
		if d.Status == hail.DriverBusy {
			busy++
		}
	}
	if busy != 1 {
		t.Fatalf("busy drivers=%d, want 1", busy)
	}
}

func TestTransportMatch_OneDriverTwoTripsNotDoubleBooked(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	t1, t2 := e.request(t, "r1", "k1"), e.request(t, "r2", "k2")
	var wg sync.WaitGroup
	var wins int32
	start := make(chan struct{})
	for _, id := range []string{t1.ID, t2.ID} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			<-start
			if _, err := e.svc.ConfirmDriver(context.Background(), id, "d1", "c"); err == nil {
				atomic.AddInt32(&wins, 1)
			}
		}(id)
	}
	close(start)
	wg.Wait()
	if wins != 1 {
		t.Fatalf("driver matched to %d trips", wins)
	}
}

// Real Redis (only when REDIS_URL is set): the production locker, 2 concurrent requests.
func TestTransportMatch_RealRedisTwoConcurrent(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL not set")
	}
	opt, err := goredis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	e := newTpEnv()
	e.svc = hail.NewService(e.repo, hail.NewRedisLocker(goredis.NewClient(opt)), e.led)
	e.repo.addDriver("a", hail.DriverAvailable)
	e.repo.addDriver("b", hail.DriverAvailable)
	tr := e.request(t, "r1", fmt.Sprint(time.Now().UnixNano()))
	var wins int32
	var wg sync.WaitGroup
	for _, d := range []string{"a", "b"} {
		wg.Add(1)
		go func(d string) {
			defer wg.Done()
			if _, err := e.svc.ConfirmDriver(context.Background(), tr.ID, d, "c"); err == nil {
				atomic.AddInt32(&wins, 1)
			}
		}(d)
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("wins=%d", wins)
	}
}

// ---- HTTP ------------------------------------------------------------------

func tpRouter(e *tpEnv) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1/transport")
	g.Use(func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-Test-User")) })
	hail.NewHandler(e.svc).Register(g)
	return r
}

func tpDo(r *gin.Engine, method, path, user, key, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("X-Test-User", user)
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestTransportHTTP_AllEndpointsHappyPath(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	r := tpRouter(e)

	w := tpDo(r, "POST", "/api/v1/transport/trips", "r1", "k1",
		`{"pickup_lat":6.5,"pickup_lon":3.3,"dropoff_lat":6.6,"dropoff_lon":3.4}`)
	if w.Code != http.StatusOK {
		t.Fatalf("request %d %s", w.Code, w.Body)
	}
	var env struct{ Data hail.Trip }
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	id := env.Data.ID

	if w = tpDo(r, "POST", "/api/v1/transport/trips/"+id+"/confirm-driver", "d1", "c1", `{}`); w.Code != 200 {
		t.Fatalf("confirm %d %s", w.Code, w.Body)
	}
	if w = tpDo(r, "GET", "/api/v1/transport/trips/"+id, "r1", "", ""); w.Code != 200 {
		t.Fatalf("get %d", w.Code)
	}
	if w = tpDo(r, "GET", "/api/v1/transport/trips/"+id, "intruder", "", ""); w.Code != 404 {
		t.Fatalf("intruder get %d", w.Code)
	}
	if w = tpDo(r, "POST", "/api/v1/transport/trips/"+id+"/complete", "d1", "x1", `{}`); w.Code != 200 {
		t.Fatalf("complete %d %s", w.Code, w.Body)
	}
}

func TestTransportHTTP_RequiresIdempotencyKeyAndBody(t *testing.T) {
	r := tpRouter(newTpEnv())
	body := `{"pickup_lat":6.5,"pickup_lon":3.3,"dropoff_lat":6.6,"dropoff_lon":3.4}`
	if w := tpDo(r, "POST", "/api/v1/transport/trips", "r1", "", body); w.Code != 400 {
		t.Fatalf("no key: %d", w.Code)
	}
	if w := tpDo(r, "POST", "/api/v1/transport/trips", "r1", "k", `{"pickup_lat":6.5}`); w.Code != 400 {
		t.Fatalf("partial body: %d", w.Code)
	}
}

// ---- Block 14 fix round 1: tier guard, audit, partial-settlement safety ----

type tpGate struct{ err error }

func (g *tpGate) CheckRider(context.Context, string, int64) error { return g.err }

type tpAuditor struct {
	mu      sync.Mutex
	actions []string
	meta    []map[string]any
}

func (a *tpAuditor) LogAction(_, _, action, _, _, _ string, _, newValues map[string]any, _, _, _ string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.actions = append(a.actions, action)
	a.meta = append(a.meta, newValues)
}

func (a *tpAuditor) count(action string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	n := 0
	for _, x := range a.actions {
		if x == action {
			n++
		}
	}
	return n
}

// memBook is an in-memory double-entry book honouring the ledger.Service
// contract the settler relies on: per-key idempotent replays, balance checks,
// the in-tx debit guard, and reversal pairs. The LedgerSettler under test is
// the real one.
type memBook struct {
	mu       sync.Mutex
	seq      int
	bal      map[string]int64
	wallets  map[string]string
	standing map[ledger.AccountType]string
	entries  map[string]string // exact entry key -> signature
	fail     map[string]error  // base idempotency key -> injected error (fires once)
}

func newMemBook() *memBook {
	return &memBook{bal: map[string]int64{}, wallets: map[string]string{}, standing: map[ledger.AccountType]string{},
		entries: map[string]string{}, fail: map[string]error{}}
}

func (b *memBook) newAcc() string { b.seq++; return fmt.Sprintf("acc-%d", b.seq) }

func (b *memBook) GetOrCreateUserWallet(_ context.Context, u string) (*ledger.Account, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if id, ok := b.wallets[u]; ok {
		return &ledger.Account{ID: id}, nil
	}
	id := b.newAcc()
	b.wallets[u] = id
	return &ledger.Account{ID: id}, nil
}

func (b *memBook) GetOrCreateStandingAccount(_ context.Context, t ledger.AccountType) (*ledger.Account, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if id, ok := b.standing[t]; ok {
		return &ledger.Account{ID: id}, nil
	}
	id := b.newAcc()
	b.standing[t] = id
	return &ledger.Account{ID: id}, nil
}

func (b *memBook) GetBalance(_ context.Context, u string) (int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.bal[b.wallets[u]], nil
}

func (b *memBook) EntryByKey(_ context.Context, k string) (*ledger.Entry, bool, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.entries[k]; ok {
		return &ledger.Entry{IdempotencyKey: k}, true, nil
	}
	return nil, false, nil
}

// post applies one balanced pair under the caller-held lock.
func (b *memBook) post(key, dSfx, cSfx, debit, credit string, amt int64) error {
	if err, ok := b.fail[key]; ok {
		delete(b.fail, key)
		return err
	}
	sig := fmt.Sprintf("%s>%s:%d", debit, credit, amt)
	if prev, ok := b.entries[key+cSfx]; ok {
		if prev == sig {
			return nil // identical replay: no-op success
		}
		return ledger.ErrDuplicate
	}
	b.entries[key+dSfx], b.entries[key+cSfx] = sig, sig
	b.bal[debit] -= amt
	b.bal[credit] += amt
	return nil
}

func (b *memBook) DebitWithGuard(ctx context.Context, u, _, key, creditAcc string, amt int64, guard ledger.DebitGuard) error {
	if guard == nil {
		return ledger.ErrDebitGuardUnwired
	}
	acc, _ := b.GetOrCreateUserWallet(ctx, u)
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.entries[key+":credit"] == fmt.Sprintf("%s>%s:%d", acc.ID, creditAcc, amt) {
		return nil // replay converges before the guard, like the real repo
	}
	if err := guard(ctx, nil, u, amt); err != nil {
		return err
	}
	if b.bal[acc.ID] < amt {
		return ledger.ErrInsufficientFunds
	}
	return b.post(key, ":debit", ":credit", acc.ID, creditAcc, amt)
}

func (b *memBook) Credit(ctx context.Context, u, _, key, debitAcc string, amt int64) error {
	acc, _ := b.GetOrCreateUserWallet(ctx, u)
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.post(key, ":debit", ":credit", debitAcc, acc.ID, amt)
}

func (b *memBook) PostJournal(_ context.Context, j ledger.JournalEntry) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.post(j.IdempotencyKey, ":debit", ":credit", j.DebitAccountID, j.CreditAccountID, j.AmountKobo)
}

// PostReversal: restore gains, release is drained (ledger.Service semantics).
func (b *memBook) PostReversal(_ context.Context, restore, release string, amt int64, _, key string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.post(key, ":rev_credit", ":rev_debit", release, restore, amt)
}

func (b *memBook) total() int64 {
	var n int64
	for _, v := range b.bal {
		n += v
	}
	return n
}

func (b *memBook) of(u string) int64                       { return b.bal[b.wallets[u]] }
func (b *memBook) std(t ledger.AccountType) int64          { return b.bal[b.standing[t]] }
func okGuard(context.Context, pgx.Tx, string, int64) error { return nil }

func fundedBook(rider string, kobo int64) *memBook {
	b := newMemBook()
	a, _ := b.GetOrCreateUserWallet(context.Background(), rider)
	b.bal[a.ID] = kobo
	return b
}

func TestTransportTierGuard_WalletDisabled(t *testing.T) {
	e := newTpEnv()
	e.gate.err = tiers.ErrWalletDisabled
	r := tpRouter(e)
	body := `{"pickup_lat":6.5,"pickup_lon":3.3,"dropoff_lat":6.6,"dropoff_lon":3.4}`

	if _, err := e.svc.RequestTrip(context.Background(), "r1", 6.5, 3.3, 6.6, 3.4, "k1"); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("want ErrWalletDisabled, got %v", err)
	}
	if w := tpDo(r, "POST", "/api/v1/transport/trips", "r1", "k2", body); w.Code != http.StatusPaymentRequired {
		t.Fatalf("disabled wallet must be 402, got %d %s", w.Code, w.Body)
	}
	if len(e.repo.trips) != 0 {
		t.Fatalf("no trip may be created for a disabled wallet, got %d", len(e.repo.trips))
	}
	if e.aud.count(hail.AuditTripRequested) != 0 {
		t.Fatal("rejected booking must not emit a trip.requested audit")
	}

	// Insufficient balance and cap breaches are also 402.
	for _, ge := range []error{hail.ErrInsufficientFunds, tiers.ErrDailyLimitExceeded, tiers.ErrCheckoutAllowanceExceeded} {
		e.gate.err = ge
		if w := tpDo(r, "POST", "/api/v1/transport/trips", "r1", "k3", body); w.Code != http.StatusPaymentRequired {
			t.Fatalf("%v: want 402 got %d", ge, w.Code)
		}
	}

	// Fail closed when no gate is wired.
	bare := hail.NewService(newTpRepo(), newTpLocker(), &tpLedger{})
	if _, err := bare.RequestTrip(context.Background(), "r1", 6.5, 3.3, 6.6, 3.4, "k"); !errors.Is(err, hail.ErrTierGateUnwired) {
		t.Fatalf("unwired gate must fail closed, got %v", err)
	}
}

func TestTransportAudit_RequestAndSettleCarryFareAndSplit(t *testing.T) {
	e := newTpEnv()
	e.repo.addDriver("d1", hail.DriverAvailable)
	tr := e.request(t, "r1", "k1")
	e.request(t, "r1", "k1") // replay: no second audit
	if e.aud.count(hail.AuditTripRequested) != 1 {
		t.Fatalf("trip.requested audits = %d, want 1", e.aud.count(hail.AuditTripRequested))
	}
	_, _ = e.svc.ConfirmDriver(context.Background(), tr.ID, "d1", "c1")
	if _, err := e.svc.CompleteTrip(context.Background(), tr.ID, "d1", "x1"); err != nil {
		t.Fatal(err)
	}
	if e.aud.count(hail.AuditTripSettled) != 1 {
		t.Fatalf("trip.settled audits = %d, want 1", e.aud.count(hail.AuditTripSettled))
	}
	m := e.aud.meta[len(e.aud.meta)-1]
	if m["fare_kobo"] != int64(150000) || m["driver_share_kobo"] != int64(105000) || m["platform_share_kobo"] != int64(45000) ||
		m["rider_id"] != "r1" || m["driver_id"] != "drv-d1" || m["trip_id"] != tr.ID {
		t.Fatalf("settled audit payload incomplete: %v", m)
	}
}

func TestTransportSettler_GuardIsMandatoryAndAuthoritative(t *testing.T) {
	ctx := context.Background()
	b := fundedBook("r1", 500000)
	// Nil guard fails closed.
	if err := hail.NewLedgerSettlerFor(b).Settle(ctx, "k", "t1", "r1", "d1", 150000, 105000, 45000); !errors.Is(err, ledger.ErrDebitGuardUnwired) {
		t.Fatalf("want ErrDebitGuardUnwired, got %v", err)
	}
	// A refusing guard (wallet disabled at settlement) posts nothing and surfaces the sentinel.
	s := hail.NewLedgerSettlerFor(b).WithGuard(func(context.Context, pgx.Tx, string, int64) error { return tiers.ErrWalletDisabled })
	if err := s.Settle(ctx, "k", "t1", "r1", "d1", 150000, 105000, 45000); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("want ErrWalletDisabled, got %v", err)
	}
	if b.of("r1") != 500000 || len(b.entries) != 0 {
		t.Fatal("refused settlement must post nothing")
	}
}

func TestTransportPartialSettlement_DriverCreditFails(t *testing.T) {
	const fare, drv, plat = int64(150000), int64(105000), int64(45000)
	b := fundedBook("r1", 500000)
	aud := &tpAuditor{}
	s := hail.NewLedgerSettlerFor(b).WithGuard(okGuard).WithAuditor(aud)
	ctx := context.Background()

	// Driver credit fails once after the rider debit landed.
	b.fail["k:driver"] = errors.New("db blip")
	if err := s.Settle(ctx, "k", "t1", "r1", "d1", fare, drv, plat); err == nil {
		t.Fatal("settle must report the leg failure")
	}
	if _, ok, _ := b.EntryByKey(ctx, "k:rider:rev:rev_credit"); !ok {
		t.Fatal("rider debit must be reversed by a posted reversal entry")
	}
	if b.of("r1") != 500000 || b.std(ledger.AccountSettlement) != 0 || b.of("d1") != 0 {
		t.Fatalf("funds must be fully restored: rider=%d settle=%d driver=%d", b.of("r1"), b.std(ledger.AccountSettlement), b.of("d1"))
	}
	if aud.count(hail.AuditSettlementReverse) != 1 {
		t.Fatalf("reversal must be audited, got %d", aud.count(hail.AuditSettlementReverse))
	}

	// Retry: same key settles exactly once end to end (fresh generation).
	if err := s.Settle(ctx, "k", "t1", "r1", "d1", fare, drv, plat); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if b.of("r1") != 500000-fare || b.of("d1") != drv || b.std(ledger.AccountPaymaxRevenue) != plat || b.std(ledger.AccountSettlement) != 0 {
		t.Fatalf("after retry rider=%d driver=%d rev=%d settle=%d", b.of("r1"), b.of("d1"), b.std(ledger.AccountPaymaxRevenue), b.std(ledger.AccountSettlement))
	}
	// A further replay is a no-op (no double debit).
	if err := s.Settle(ctx, "k", "t1", "r1", "d1", fare, drv, plat); err != nil {
		t.Fatalf("replay: %v", err)
	}
	if b.of("r1") != 500000-fare || b.total() != 500000 {
		t.Fatalf("replay moved money: rider=%d total=%d", b.of("r1"), b.total())
	}
}

func TestTransportPartialSettlement_PlatformLegFailsUnwindsDriver(t *testing.T) {
	const fare, drv, plat = int64(150000), int64(105000), int64(45000)
	b := fundedBook("r1", 500000)
	s := hail.NewLedgerSettlerFor(b).WithGuard(okGuard)
	ctx := context.Background()

	b.fail["k:platform"] = errors.New("db blip")
	if err := s.Settle(ctx, "k", "t1", "r1", "d1", fare, drv, plat); err == nil {
		t.Fatal("expected failure")
	}
	if b.of("r1") != 500000 || b.of("d1") != 0 || b.std(ledger.AccountSettlement) != 0 {
		t.Fatalf("driver credit and rider debit must both unwind: rider=%d driver=%d settle=%d", b.of("r1"), b.of("d1"), b.std(ledger.AccountSettlement))
	}
	if err := s.Settle(ctx, "k", "t1", "r1", "d1", fare, drv, plat); err != nil {
		t.Fatal(err)
	}
	if b.of("d1") != drv || b.std(ledger.AccountPaymaxRevenue) != plat || b.total() != 500000 {
		t.Fatalf("retry wrong: driver=%d rev=%d total=%d", b.of("d1"), b.std(ledger.AccountPaymaxRevenue), b.total())
	}
}

func TestTransportPartialSettlement_FailedCompensationResumesMissingLegsOnly(t *testing.T) {
	const fare, drv, plat = int64(150000), int64(105000), int64(45000)
	b := fundedBook("r1", 500000)
	s := hail.NewLedgerSettlerFor(b).WithGuard(okGuard)
	ctx := context.Background()

	// Driver leg fails AND the compensating reversal fails: nothing is burned.
	b.fail["k:driver"] = errors.New("blip")
	b.fail["k:rider:rev"] = errors.New("blip2")
	if err := s.Settle(ctx, "k", "t1", "r1", "d1", fare, drv, plat); err == nil {
		t.Fatal("expected failure")
	}
	if b.std(ledger.AccountSettlement) != fare {
		t.Fatalf("funds should still be parked in settlement, got %d", b.std(ledger.AccountSettlement))
	}
	// Retry replays the rider debit (no second debit) and posts only the missing legs.
	if err := s.Settle(ctx, "k", "t1", "r1", "d1", fare, drv, plat); err != nil {
		t.Fatal(err)
	}
	if b.of("r1") != 500000-fare || b.of("d1") != drv || b.std(ledger.AccountPaymaxRevenue) != plat ||
		b.std(ledger.AccountSettlement) != 0 || b.total() != 500000 {
		t.Fatalf("rider=%d driver=%d rev=%d settle=%d total=%d", b.of("r1"), b.of("d1"), b.std(ledger.AccountPaymaxRevenue), b.std(ledger.AccountSettlement), b.total())
	}
}
