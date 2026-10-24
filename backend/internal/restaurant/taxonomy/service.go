package taxonomy

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("taxonomy: not found")
	ErrConflict = errors.New("taxonomy: name or slug already exists")
	ErrInvalid  = errors.New("taxonomy: invalid")
	ErrSeeded   = errors.New("taxonomy: default rows cannot be deleted; deactivate instead")
)

// ErrInUse reports how many menu items or sub-categories still depend on a row.
type ErrInUse struct{ Count int }

func (e ErrInUse) Error() string {
	return fmt.Sprintf("taxonomy: in use by %d item(s) or sub-categories", e.Count)
}

const (
	kindFood  = "FOOD"
	kindDrink = "DRINK"
	kindOther = "OTHER"
)

func validKind(k string) bool { return k == kindFood || k == kindDrink || k == kindOther }

// Node is one category in the tree, with its usage count for the admin view.
type Node struct {
	ID             string  `json:"id"`
	ParentID       *string `json:"parent_id"`
	Name           string  `json:"name"`
	Slug           string  `json:"slug"`
	Kind           string  `json:"kind"`
	Icon           *string `json:"icon"`
	SortOrder      int     `json:"sort_order"`
	IsActive       bool    `json:"is_active"`
	IsSystemSeeded bool    `json:"is_system_seeded"`
	ItemCount      int     `json:"item_count"`
	Children       []Node  `json:"children"`
}

// Input is a create request. Slug is derived from Name and never editable afterwards,
// so a rename does not break a bookmark or an import keyed on slug.
type Input struct {
	Name      string
	Kind      string
	ParentID  *string
	Icon      *string
	SortOrder int
}

// Patch is a partial update; nil fields are left alone.
type Patch struct {
	Name     *string
	Kind     *string
	Icon     *string
	IsActive *bool
}

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ListTree returns the whole tree, or only active rows for owners and customers.
func (s *Service) ListTree(ctx context.Context, includeInactive bool) ([]Node, error) {
	rows, err := s.db.Query(ctx, `
		SELECT c.id, c.parent_id, c.name, c.slug, c.kind, c.icon, c.sort_order,
		       c.is_active, c.is_system_seeded,
		       COALESCE(ic.n, 0)
		  FROM restaurant_taxonomy_categories c
		  LEFT JOIN (
		        -- UNION (not ALL): an item tagged with both a category and its
		        -- subcategory counts once per category it matches, as the old OR did.
		        SELECT cid, COUNT(*) AS n FROM (
		            SELECT taxonomy_category_id AS cid, id FROM menu_items WHERE taxonomy_category_id IS NOT NULL
		            UNION
		            SELECT taxonomy_subcategory_id AS cid, id FROM menu_items WHERE taxonomy_subcategory_id IS NOT NULL
		        ) u GROUP BY cid
		  ) ic ON ic.cid = c.id
		 WHERE $1 OR c.is_active
		 ORDER BY c.sort_order, c.name`, includeInactive)
	if err != nil {
		return nil, fmt.Errorf("taxonomy: list: %w", err)
	}
	defer rows.Close()

	var flat []Node
	for rows.Next() {
		var n Node
		if err := rows.Scan(&n.ID, &n.ParentID, &n.Name, &n.Slug, &n.Kind, &n.Icon, &n.SortOrder,
			&n.IsActive, &n.IsSystemSeeded, &n.ItemCount); err != nil {
			return nil, err
		}
		n.Children = []Node{}
		flat = append(flat, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return buildTree(flat), nil
}

func buildTree(flat []Node) []Node {
	byParent := map[string][]Node{}
	var roots []Node
	for _, n := range flat {
		if n.ParentID == nil {
			roots = append(roots, n)
			continue
		}
		byParent[*n.ParentID] = append(byParent[*n.ParentID], n)
	}
	var attach func(n Node) Node
	attach = func(n Node) Node {
		kids := byParent[n.ID]
		n.Children = make([]Node, 0, len(kids))
		for _, k := range kids {
			n.Children = append(n.Children, attach(k))
		}
		return n
	}
	out := make([]Node, 0, len(roots))
	for _, r := range roots {
		out = append(out, attach(r))
	}
	return out
}

func (s *Service) Create(ctx context.Context, actorID string, in Input) (Node, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > 80 {
		return Node{}, fmt.Errorf("%w: name must be 1 to 80 characters", ErrInvalid)
	}
	if !validKind(in.Kind) {
		return Node{}, fmt.Errorf("%w: kind must be FOOD, DRINK or OTHER", ErrInvalid)
	}
	slug := Slugify(name)
	if slug == "" {
		return Node{}, fmt.Errorf("%w: name must contain letters or numbers", ErrInvalid)
	}
	var n Node
	err := s.db.QueryRow(ctx, `
		INSERT INTO restaurant_taxonomy_categories
		  (parent_id, name, slug, kind, icon, sort_order, is_active, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,TRUE,NULLIF($7,'')::uuid)
		RETURNING id, parent_id, name, slug, kind, icon, sort_order, is_active, is_system_seeded`,
		in.ParentID, name, slug, in.Kind, in.Icon, in.SortOrder, actorID,
	).Scan(&n.ID, &n.ParentID, &n.Name, &n.Slug, &n.Kind, &n.Icon, &n.SortOrder, &n.IsActive, &n.IsSystemSeeded)
	if err != nil {
		return Node{}, mapWriteErr(err)
	}
	n.Children = []Node{}
	log.Printf("[taxonomy] admin %s created category %s (%s)", actorID, n.Slug, n.ID)
	return n, nil
}

func (s *Service) Update(ctx context.Context, actorID, id string, p Patch) (Node, error) {
	if p.Kind != nil && !validKind(*p.Kind) {
		return Node{}, fmt.Errorf("%w: kind must be FOOD, DRINK or OTHER", ErrInvalid)
	}
	if p.Name != nil {
		trimmed := strings.TrimSpace(*p.Name)
		if trimmed == "" || len(trimmed) > 80 {
			return Node{}, fmt.Errorf("%w: name must be 1 to 80 characters", ErrInvalid)
		}
		p.Name = &trimmed
	}
	var n Node
	err := s.db.QueryRow(ctx, `
		UPDATE restaurant_taxonomy_categories SET
		  name       = COALESCE($2, name),
		  kind       = COALESCE($3, kind),
		  icon       = COALESCE($4, icon),
		  is_active  = COALESCE($5, is_active),
		  updated_at = NOW()
		WHERE id = $1
		RETURNING id, parent_id, name, slug, kind, icon, sort_order, is_active, is_system_seeded`,
		id, p.Name, p.Kind, p.Icon, p.IsActive,
	).Scan(&n.ID, &n.ParentID, &n.Name, &n.Slug, &n.Kind, &n.Icon, &n.SortOrder, &n.IsActive, &n.IsSystemSeeded)
	if errors.Is(err, pgx.ErrNoRows) {
		return Node{}, ErrNotFound
	}
	if err != nil {
		return Node{}, mapWriteErr(err)
	}
	n.Children = []Node{}
	log.Printf("[taxonomy] admin %s updated category %s", actorID, n.Slug)
	return n, nil
}

// Reorder sets sort_order for many rows in one transaction, so the tree never shows
// a half-applied order.
func (s *Service) Reorder(ctx context.Context, actorID string, orders map[string]int) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for id, order := range orders {
		tag, err := tx.Exec(ctx, `UPDATE restaurant_taxonomy_categories SET sort_order=$2, updated_at=NOW() WHERE id=$1`, id, order)
		if err != nil {
			return mapWriteErr(err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	log.Printf("[taxonomy] admin %s reordered %d categories", actorID, len(orders))
	return nil
}

// Delete removes a row only when nothing depends on it. Default rows are never
// hard-deleted: they are deactivated, which keeps history readable.
func (s *Service) Delete(ctx context.Context, actorID, id string) error {
	var seeded bool
	var kids, items int
	err := s.db.QueryRow(ctx, `
		SELECT c.is_system_seeded,
		       (SELECT COUNT(*) FROM restaurant_taxonomy_categories k WHERE k.parent_id = c.id),
		       (SELECT COUNT(*) FROM menu_items m
		         WHERE m.taxonomy_category_id = c.id OR m.taxonomy_subcategory_id = c.id)
		  FROM restaurant_taxonomy_categories c WHERE c.id = $1`, id).Scan(&seeded, &kids, &items)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if seeded {
		return ErrSeeded
	}
	if kids+items > 0 {
		return ErrInUse{Count: kids + items}
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM restaurant_taxonomy_categories WHERE id=$1`, id); err != nil {
		return mapWriteErr(err)
	}
	log.Printf("[taxonomy] admin %s deleted category %s", actorID, id)
	return nil
}

// ListCuisines returns cuisines; inactive ones only when asked.
func (s *Service) ListCuisines(ctx context.Context, includeInactive bool) ([]Cuisine, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, slug, sort_order, is_active, is_system_seeded
		  FROM cuisines WHERE $1 OR is_active ORDER BY sort_order, name`, includeInactive)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Cuisine{}
	for rows.Next() {
		var c Cuisine
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.SortOrder, &c.IsActive, &c.IsSystemSeeded); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Cuisine is a restaurant tag. Cuisines are deactivated, never deleted: a restaurant
// may already reference one.
type Cuisine struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Slug           string `json:"slug"`
	SortOrder      int    `json:"sort_order"`
	IsActive       bool   `json:"is_active"`
	IsSystemSeeded bool   `json:"is_system_seeded"`
}

func (s *Service) CreateCuisine(ctx context.Context, actorID, name string, sortOrder int) (Cuisine, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 80 {
		return Cuisine{}, fmt.Errorf("%w: name must be 1 to 80 characters", ErrInvalid)
	}
	slug := Slugify(name)
	if slug == "" {
		return Cuisine{}, fmt.Errorf("%w: name must contain letters or numbers", ErrInvalid)
	}
	var c Cuisine
	err := s.db.QueryRow(ctx, `
		INSERT INTO cuisines (name, slug, sort_order) VALUES ($1,$2,$3)
		RETURNING id, name, slug, sort_order, is_active, is_system_seeded`,
		name, slug, sortOrder).Scan(&c.ID, &c.Name, &c.Slug, &c.SortOrder, &c.IsActive, &c.IsSystemSeeded)
	if err != nil {
		return Cuisine{}, mapWriteErr(err)
	}
	log.Printf("[taxonomy] admin %s created cuisine %s", actorID, c.Slug)
	return c, nil
}

func (s *Service) UpdateCuisine(ctx context.Context, actorID, id string, name *string, sortOrder *int, active *bool) (Cuisine, error) {
	if name != nil {
		t := strings.TrimSpace(*name)
		if t == "" || len(t) > 80 {
			return Cuisine{}, fmt.Errorf("%w: name must be 1 to 80 characters", ErrInvalid)
		}
		name = &t
	}
	var c Cuisine
	err := s.db.QueryRow(ctx, `
		UPDATE cuisines SET
		  name       = COALESCE($2, name),
		  sort_order = COALESCE($3, sort_order),
		  is_active  = COALESCE($4, is_active),
		  updated_at = NOW()
		WHERE id = $1
		RETURNING id, name, slug, sort_order, is_active, is_system_seeded`,
		id, name, sortOrder, active).Scan(&c.ID, &c.Name, &c.Slug, &c.SortOrder, &c.IsActive, &c.IsSystemSeeded)
	if errors.Is(err, pgx.ErrNoRows) {
		return Cuisine{}, ErrNotFound
	}
	if err != nil {
		return Cuisine{}, mapWriteErr(err)
	}
	log.Printf("[taxonomy] admin %s updated cuisine %s", actorID, c.Slug)
	return c, nil
}

// mapWriteErr turns database constraint failures into sentinel errors, so the handler
// answers 409 or 422 instead of a generic 500.
func mapWriteErr(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "23505":
			return ErrConflict
		case "23514":
			return fmt.Errorf("%w: %s", ErrInvalid, pg.Message)
		case "23503":
			return fmt.Errorf("%w: references a row that does not exist", ErrInvalid)
		}
	}
	return err
}
