package ratings

import "time"

// EntityType identifies what was rated.
type EntityType string

const (
	EntityDoctor      EntityType = "doctor"
	EntityPharmacy    EntityType = "pharmacy"
	EntityRestaurant  EntityType = "restaurant"
	EntityRider       EntityType = "rider"
	EntityDriver      EntityType = "driver"
	EntityBusOperator EntityType = "bus_operator"
	EntityEventOrg    EntityType = "event_organiser"
	EntityCampaign    EntityType = "campaign"
	EntityGroupAdmin  EntityType = "group_admin"
)

// Rating is one user's rating of an entity after a completed transaction.
type Rating struct {
	ID             string     `json:"id"`
	RaterID        string     `json:"rater_id"`
	EntityID       string     `json:"entity_id"`
	EntityType     EntityType `json:"entity_type"`
	TransactionRef string     `json:"transaction_ref"` // prevents duplicate ratings per order
	Score          float32    `json:"score"`           // 1.0–5.0
	Comment        *string    `json:"comment,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// CreateRequest is the body for POST /ratings.
type CreateRequest struct {
	EntityID       string     `json:"entity_id" binding:"required"`
	EntityType     EntityType `json:"entity_type" binding:"required"`
	TransactionRef string     `json:"transaction_ref" binding:"required"`
	Score          float32    `json:"score" binding:"required,min=1,max=5"`
	Comment        *string    `json:"comment,omitempty"`
}

// Summary is the aggregated rating for an entity.
type Summary struct {
	EntityID   string  `json:"entity_id"`
	EntityType string  `json:"entity_type"`
	Average    float32 `json:"average"`
	Count      int     `json:"count"`
}
