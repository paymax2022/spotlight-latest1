package learn

import "github.com/gin-gonic/gin"

// RegisterLearn mounts the Learn Center member routes on the provided group.
// The caller passes a group already scoped to /learn and already carrying the
// auth middleware (user_id mirrored onto the gin context), matching the mobile
// base path /api/v1/learn/*.
//
//	GET  /paths                     — list published learning paths
//	GET  /paths/:id                 — single path detail
//	GET  /lessons/:id               — single lesson (marks read → advances progress)
//	GET  /lessons/:id/quiz          — quiz for a lesson (404 → none)
//	POST /quizzes/:id/submit        — score a quiz submission (server-authoritative)
//	GET  /glossary                  — alphabetical glossary
func RegisterLearn(g *gin.RouterGroup, h *Handler) {
	g.GET("/paths", h.GetPaths)
	g.GET("/paths/:id", h.GetPath)
	g.GET("/lessons/:id", h.GetLesson)
	g.GET("/lessons/:id/quiz", h.GetQuiz)
	g.POST("/quizzes/:id/submit", h.SubmitQuiz)
	g.GET("/glossary", h.GetGlossary)
}
