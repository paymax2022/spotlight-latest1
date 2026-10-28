package prescriptions

import "strings"

// maskPatient hides a patient's identity in list views: the display name is cut to
// first name + initial of the rest ("Aisha M•••"); with no name it falls back to the
// first 8 characters of the id, mirroring telemedicine's maskPatientId.
func maskPatient(name, id string) string {
	name = strings.TrimSpace(name)
	if name != "" {
		parts := strings.Fields(name)
		first := parts[0]
		if len(parts) == 1 {
			r := []rune(first)
			if len(r) <= 1 {
				return "•••"
			}
			return string(r[:1]) + "•••"
		}
		last := []rune(parts[len(parts)-1])
		return first + " " + string(last[:1]) + "•••"
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return "Unknown"
	}
	if len(id) > 8 {
		return id[:8] + "…"
	}
	return id
}

// clampPage applies the default and maximum page size.
func clampPage(limit, offset int) (int, int) {
	if limit <= 0 || limit > maxLimit {
		limit = defaultLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}
