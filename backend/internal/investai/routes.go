package investai

import "github.com/gin-gonic/gin"

// RegisterInvestAI mounts the InvestAI education routes on the provided group. The
// caller passes a group already scoped to /api/v1/ai/invest and already carrying
// the auth middleware (user_id mirrored onto the gin context), matching the mobile
// base path (mobile-app/reactnative/src/features/investai/api/ai.api.ts).
//
//	POST /chat                    — one education turn { prompt, context?, session_id? }
//	POST /explain-asset           — neutral educational summary of one symbol { symbol }
//	GET  /sessions                — list the caller's education sessions
//	GET  /sessions/:id/messages   — owner-scoped chat history for a session
//
// Every assistant turn is educational and disclaimered; advice-seeking prompts are
// refused server-side. No money path.
func RegisterInvestAI(g *gin.RouterGroup, h *Handler) {
	g.POST("/chat", h.Chat)
	g.POST("/explain-asset", h.ExplainAsset)
	g.GET("/sessions", h.ListSessions)
	g.GET("/sessions/:id/messages", h.GetHistory)
}
