package connectmatching

import "encoding/json"

// jsonUnmarshal is a thin wrapper kept local so the service file reads cleanly.
func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
