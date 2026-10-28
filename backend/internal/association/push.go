package association

import (
	"context"
	"log"
	"time"
)

// PushFunc delivers one device push to a user. It is supplied by app wiring
// (platform notifications service + the user's registered Expo tokens), so this
// package carries no queue or provider dependency.
type PushFunc func(ctx context.Context, userID, title, body string, data map[string]any) error

// SetPusher wires device push delivery. Nil leaves notifications in-app only.
func (s *Service) SetPusher(p PushFunc) { s.pusher = p }

// pushToMemberships sends a push to the users behind the given memberships.
//
// Best effort and after the fact: the assoc_notifications row is the durable
// record and is already committed when this runs, so a push failure must never
// fail the action that caused it. It runs in the background so a slow queue
// cannot add latency to the request.
func (s *Service) pushToMemberships(membershipIDs []string, title, body, route string) {
	if s.pusher == nil || len(membershipIDs) == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		rows, err := s.db.Query(ctx,
			`SELECT DISTINCT user_id::text FROM assoc_memberships WHERE id = ANY($1::uuid[]) AND status='ACTIVE' AND user_id IS NOT NULL`,
			membershipIDs)
		if err != nil {
			log.Printf("association: push: resolve recipients: %v", err)
			return
		}
		var users []string
		for rows.Next() {
			var u string
			if rows.Scan(&u) == nil {
				users = append(users, u)
			}
		}
		rows.Close()
		s.pushToUsers(ctx, users, title, body, route)
	}()
}

// pushToOrg sends a push to every active member of an organisation.
func (s *Service) pushToOrg(orgID, title, body, route string) {
	if s.pusher == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		rows, err := s.db.Query(ctx,
			`SELECT DISTINCT user_id::text FROM assoc_memberships WHERE organisation_id=$1 AND status='ACTIVE' AND user_id IS NOT NULL`,
			orgID)
		if err != nil {
			log.Printf("association: push: resolve org recipients: %v", err)
			return
		}
		var users []string
		for rows.Next() {
			var u string
			if rows.Scan(&u) == nil {
				users = append(users, u)
			}
		}
		rows.Close()
		s.pushToUsers(ctx, users, title, body, route)
	}()
}

func (s *Service) pushToUsers(ctx context.Context, users []string, title, body, route string) {
	data := map[string]any{"route": route}
	for _, u := range users {
		if err := s.pusher(ctx, u, title, body, data); err != nil {
			log.Printf("association: push to user %s: %v", u, err)
		}
	}
}
