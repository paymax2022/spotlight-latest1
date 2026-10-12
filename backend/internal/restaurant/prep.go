package restaurant

import (
	"errors"
	"fmt"
)

// Preparation time bounds. A restaurant sets a default; an item may override it.
const (
	minPrepMinutes = 5
	maxPrepMinutes = 180
	prepStep       = 5
)

// validItemPrepMinutes checks an item's own prep time: 5 to 180 minutes.
func validItemPrepMinutes(m int) error {
	if m < minPrepMinutes || m > maxPrepMinutes {
		return fmt.Errorf("restaurant: prep time must be %d to %d minutes", minPrepMinutes, maxPrepMinutes)
	}
	return nil
}

// validRestaurantPrepMinutes checks the restaurant's default: 5 to 180 in steps of 5.
func validRestaurantPrepMinutes(m int) error {
	if err := validItemPrepMinutes(m); err != nil {
		return err
	}
	if m%prepStep != 0 {
		return errors.New("restaurant: prep time must be in steps of 5 minutes")
	}
	return nil
}
