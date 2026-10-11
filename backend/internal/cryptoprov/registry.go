package cryptoprov

import (
	"errors"
	"fmt"
	"sort"
	"sync"
)

// ErrProviderNotFound is returned when a registered provider name is requested
// but was never registered.
var ErrProviderNotFound = errors.New("cryptoprov: provider not registered")

// Registry holds providers by name. ACTIVE_PROVIDER selects the default. Every
// stored row records its provider name, so several providers can coexist.
type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
	active    string
}

// NewRegistry returns an empty registry whose default is active.
func NewRegistry(active string) *Registry {
	return &Registry{providers: map[string]Provider{}, active: active}
}

// Register adds a provider. A duplicate name is an error, never a silent overwrite.
func (r *Registry) Register(p Provider) error {
	if p == nil || p.Name() == "" {
		return errors.New("cryptoprov: provider must have a name")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.providers[p.Name()]; dup {
		return fmt.Errorf("cryptoprov: provider %q already registered", p.Name())
	}
	r.providers[p.Name()] = p
	return nil
}

// Get returns the named provider.
func (r *Registry) Get(name string) (Provider, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[name]
	if !ok {
		return nil, ErrProviderNotFound
	}
	return p, nil
}

// Active returns the default provider selected by ACTIVE_PROVIDER.
func (r *Registry) Active() (Provider, error) {
	return r.Get(r.active)
}

// Names returns the registered provider names in stable order.
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.providers))
	for n := range r.providers {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}
