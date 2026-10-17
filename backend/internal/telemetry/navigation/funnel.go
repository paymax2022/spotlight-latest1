package navigation

import "time"

// ComputeFunnel returns, for each step, the number of distinct users who
// reached it in order, each consecutive step within gap of the previously
// matched one. events must be grouped by user (a UserID change is a user
// boundary) and ordered by OccurredAt within each user.
//
// Per user it is a greedy forward scan: pointer p is the next step to match; an
// event advances p when its route equals steps[p] and (p == 0 or it occurred
// within gap of the last match). Other events are skipped without resetting p.
func ComputeFunnel(events []StepEvent, steps []string, gap time.Duration) []int64 {
	result := make([]int64, len(steps))
	if len(steps) == 0 {
		return result
	}
	flush := func(depth int) {
		for k := 0; k < depth; k++ {
			result[k]++
		}
	}
	var (
		cur      string
		started  bool
		p, depth int
		last     time.Time
	)
	for _, e := range events {
		if !started || e.UserID != cur {
			if started {
				flush(depth)
			}
			cur, started = e.UserID, true
			p, depth, last = 0, 0, time.Time{}
		}
		if p >= len(steps) || e.Route != steps[p] {
			continue
		}
		if p == 0 || e.OccurredAt.Sub(last) <= gap {
			last = e.OccurredAt
			p++
			depth = p
		}
	}
	if started {
		flush(depth)
	}
	return result
}
