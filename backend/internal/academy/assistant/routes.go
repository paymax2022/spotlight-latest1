package assistant

// routes.go — where the module's paths are declared.
//
// Three groups, matching the three audiences and their authorization:
//
//   - RegisterAssistantStudent — the signed-in student's own thread. No
//     permission slug: a student may only ever touch a conversation whose
//     user_id is theirs, which the store enforces in every WHERE clause.
//   - RegisterAssistantKnowledge — FAQ authoring, behind academy.faq.manage.
//   - RegisterAssistantQueue — the support queue, behind academy.support.view
//     for reads and academy.support.manage for the two mutations.
//
// The caller applies RequireAuthContext and the permission guards; these
// functions only bind paths, so the same handlers can be mounted by any
// composition root.

import "github.com/gin-gonic/gin"

// RegisterAssistantStudent mounts the learner surface on an authenticated group.
func RegisterAssistantStudent(g *gin.RouterGroup, h *Handler) {
	g.POST("/chat", h.Chat)
	g.POST("/handoff", h.Handoff)
	g.GET("/suggestions", h.Suggestions)
	g.GET("/conversations", h.Conversations)
	g.GET("/conversations/:id/messages", h.Messages)
	g.POST("/conversations/:id/feedback", h.Feedback)
}

// RegisterAssistantKnowledge mounts the knowledge base on a group already gated
// by academy.faq.manage.
func RegisterAssistantKnowledge(g *gin.RouterGroup, h *Handler) {
	g.GET("", h.ListFaqs)
	g.POST("", h.CreateFaq)
	g.GET("/categories", h.FaqCategories)
	g.GET("/:id", h.GetFaq)
	g.PUT("/:id", h.UpdateFaq)
	g.DELETE("/:id", h.DeleteFaq)
}

// RegisterAssistantQueue mounts the support queue. The group must already carry
// academy.support.view; manageMW is applied to the two writes so reading the
// queue and working it stay separately grantable.
func RegisterAssistantQueue(g *gin.RouterGroup, h *Handler, manageMW gin.HandlerFunc) {
	g.GET("", h.ListTickets)
	g.GET("/:id", h.GetTicket)
	if manageMW != nil {
		g.POST("/:id/reply", manageMW, h.Reply)
		g.POST("/:id/status", manageMW, h.SetStatus)
		return
	}
	g.POST("/:id/reply", h.Reply)
	g.POST("/:id/status", h.SetStatus)
}
