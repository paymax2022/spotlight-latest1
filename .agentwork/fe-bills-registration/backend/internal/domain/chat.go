package domain

type ChatSession struct {
	ID          string `json:"id"`
	PageContext string `json:"pageContext"`
	Status      string `json:"status"`
	StartedAt   string `json:"startedAt"`
}

type ChatMessage struct {
	ID          string   `json:"id"`
	Role        string   `json:"role"`
	MessageText string   `json:"message_text,omitempty"`
	Text        string   `json:"text,omitempty"`
	Intent      string   `json:"intent,omitempty"`
	Confidence  *float64 `json:"confidence,omitempty"`
	CreatedAt   string   `json:"created_at,omitempty"`
}

type ChatEvent struct {
	ID           string         `json:"id,omitempty"`
	EventName    string         `json:"event_name,omitempty"`
	Event        string         `json:"event,omitempty"`
	EventPayload map[string]any `json:"event_payload,omitempty"`
	Payload      map[string]any `json:"payload,omitempty"`
	CreatedAt    string         `json:"created_at,omitempty"`
}

type ChatSessionDetail struct {
	Session  *ChatSession  `json:"session,omitempty"`
	Messages []ChatMessage `json:"messages"`
	Events   []ChatEvent   `json:"events"`
}
