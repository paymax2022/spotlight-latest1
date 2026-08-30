package association

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the association endpoints onto the provided (already
// auth-guarded) router group. Mirrors the internal/groups wiring style; the
// caller supplies the group base (e.g. /associations).
//
// NOTE on routing: org detail is served at GET /orgs/:id rather than a
// root-level GET /:id — gin's tree conflicts a root param with the many static
// siblings (/me, /members, /meetings, …). The mobile client's bare
// GET /associations/:id maps here as part of the documented path reconciliation.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	// ── Discovery ───────────────────────────────────────────────
	rg.GET("", h.ListOrganisations)
	rg.GET("/orgs/:id", h.GetOrganisation)

	// ── Member self ─────────────────────────────────────────────
	rg.GET("/me/dashboard", h.GetDashboard)
	rg.GET("/me/card", h.GetCard)
	rg.GET("/me/profile", h.GetProfile)
	rg.PUT("/me/profile", h.UpdateProfile)
	rg.GET("/me/privacy", h.GetPrivacy)
	rg.PUT("/me/privacy", h.UpdatePrivacy)
	rg.GET("/me/activity", h.GetActivity)
	rg.GET("/me/admin-access", h.GetAdminAccess)
	rg.GET("/me/dues", h.GetDues)

	// ── Elections & voting (TS-13) ──────────────────────────────
	rg.GET("/elections", h.ListElections)
	rg.GET("/elections/:id", h.GetElection)
	rg.POST("/elections", h.CreateElection)                      // officer
	rg.POST("/elections/:id/candidates", h.AddElectionCandidate) // officer
	rg.POST("/elections/:id/open", h.OpenElection)               // officer
	rg.POST("/elections/:id/close", h.CloseElection)             // officer
	rg.POST("/elections/:id/publish", h.PublishElectionResults)  // officer
	rg.POST("/elections/:id/handover", h.HandoverElection)       // senior officer
	rg.GET("/elections/:id/tally", h.GetElectionTally)           // officer
	rg.POST("/elections/:id/vote", h.CastVote)                   // eligible voter

	// ── Membership card verification (MC-003/004/005) ───────────
	rg.POST("/cards/verify", h.VerifyCard)

	// ── Directory ───────────────────────────────────────────────
	rg.GET("/members", h.ListMembers)
	rg.GET("/members/:id", h.GetMember)

	// ── Dues & payments ─────────────────────────────────────────
	rg.POST("/dues/:invoiceId/pay", h.PayInvoice)
	rg.GET("/receipts/:receiptId", h.GetReceipt)

	// ── Engagement ──────────────────────────────────────────────
	rg.GET("/announcements", h.ListAnnouncements)
	rg.GET("/announcements/:id", h.GetAnnouncement)
	rg.POST("/announcements/:id/acknowledge", h.AcknowledgeAnnouncement)
	rg.GET("/notifications", h.ListNotifications)
	rg.POST("/notifications/read", h.MarkNotificationsRead)

	// ── Meetings ────────────────────────────────────────────────
	rg.GET("/meetings", h.ListMeetings)
	rg.GET("/meetings/:id", h.GetMeeting)
	rg.POST("/meetings/:id/rsvp", h.RsvpMeeting)
	rg.POST("/meetings/:id/attendance", h.CheckInMeeting)

	// ── Tasks ───────────────────────────────────────────────────
	rg.GET("/tasks", h.ListTasks)
	rg.GET("/tasks/:id", h.GetTask)
	rg.PATCH("/tasks/:id", h.UpdateTaskStatus)

	// ── Documents ───────────────────────────────────────────────
	rg.GET("/documents", h.ListDocuments)
	rg.GET("/documents/:id", h.GetDocument)
	rg.POST("/documents/:id/acknowledge", h.AcknowledgeDocument)

	// ── Community ───────────────────────────────────────────────
	rg.GET("/committees", h.ListCommittees)
	rg.GET("/committees/:id", h.GetCommittee)
	rg.POST("/committees/:id/join", h.JoinCommittee)
	rg.GET("/events", h.ListEvents)
	rg.GET("/events/:id", h.GetEvent)
	rg.POST("/events/:id/rsvp", h.RsvpEvent)
	rg.POST("/events/:id/register", h.RegisterEvent)
	rg.POST("/events/:id/feedback", h.SubmitEventFeedback)

	// ── Admin ───────────────────────────────────────────────────
	rg.GET("/admin/organisations", h.GetAdminOrganisations)
	rg.GET("/admin/kpis", h.GetAdminKpis)
	rg.GET("/admin/audit-log", h.GetAuditLog)
	rg.GET("/admin/approvals", h.ListApprovals)
	rg.GET("/admin/approvals/:id", h.GetApproval)
	rg.POST("/admin/approvals/:id/decision", h.DecideApplication)
	rg.GET("/admin/finance", h.GetFinanceSummary)
	rg.GET("/admin/finance/offline", h.ListOfflinePayments)
	rg.POST("/admin/finance/offline/:id/decision", h.DecideOfflinePayment)
	rg.POST("/admin/members/:id/suspend", h.SuspendMember)
	rg.POST("/admin/members/:id/restore", h.RestoreMember)
	rg.POST("/admin/members/:id/transfer", h.TransferMember)
	rg.POST("/admin/members/:id/role", h.AssignRole)
	rg.POST("/admin/import/preview", h.ImportPreview)
	rg.POST("/admin/import/confirm", h.ConfirmImport)
	// Multipart CSV bulk import (org_id query param + file form field). Served at
	// /admin/import/members (not /admin/members/import) to avoid a gin static-vs-
	// param conflict with /admin/members/:id/*.
	rg.POST("/admin/import/members", h.BulkImportMembers)

	// ── Admin: organisation management ──────────────────────────
	// assoc_organisations used to be write-once — no UPDATE or DELETE existed
	// anywhere against it or its chapters/committees/dues tiers, so every field
	// was immutable after creation and `verified` was dead schema. Child routes
	// use :childId (not :id) because gin requires one param name per path
	// position and :id is already the organisation at that depth.
	rg.GET("/admin/organisations/:id", h.GetAdminOrganisation)
	rg.PATCH("/admin/organisations/:id", h.UpdateAdminOrganisation)
	rg.GET("/admin/organisations/:id/settings", h.GetOrganisationSettings)
	rg.PUT("/admin/organisations/:id/settings", h.UpdateOrganisationSettings)
	rg.POST("/admin/organisations/:id/verify", h.orgFlagHandler("verified", true))
	rg.POST("/admin/organisations/:id/unverify", h.orgFlagHandler("verified", false))
	rg.POST("/admin/organisations/:id/publish", h.orgFlagHandler("published", true))
	rg.POST("/admin/organisations/:id/unpublish", h.orgFlagHandler("published", false))
	rg.POST("/admin/organisations/:id/suspend", h.orgFlagHandler("suspended", true))
	rg.POST("/admin/organisations/:id/restore", h.orgFlagHandler("suspended", false))
	rg.POST("/admin/organisations/:id/chapters", h.CreateChapter)
	rg.POST("/admin/organisations/:id/committees", h.CreateCommittee)
	rg.POST("/admin/organisations/:id/categories", h.CreateCategory)
	rg.POST("/admin/organisations/:id/rules", h.CreateRule)
	rg.PATCH("/admin/chapters/:childId", h.UpdateChapter)
	rg.DELETE("/admin/chapters/:childId", h.DeleteChapter)
	rg.PATCH("/admin/committees/:childId", h.UpdateCommittee)
	rg.DELETE("/admin/committees/:childId", h.DeleteCommittee)
	rg.PATCH("/admin/categories/:childId", h.UpdateCategory)
	rg.DELETE("/admin/categories/:childId", h.DeleteCategory)
	rg.PATCH("/admin/rules/:childId", h.UpdateRule)
	rg.DELETE("/admin/rules/:childId", h.DeleteRule)

	// ── Admin: content authoring ────────────────────────────────
	// assoc_announcements / meetings / documents / events / tasks / notifications
	// / devices / dues_invoices all had READ endpoints and no writer anywhere in
	// the repo, so they were permanently empty and content could only arrive by
	// hand-written SQL. Child routes use :childId — gin allows one param name per
	// path position and :id is already the organisation at that depth.
	rg.POST("/admin/organisations/:id/announcements", h.CreateAnnouncement)
	rg.PATCH("/admin/announcements/:childId", h.UpdateAnnouncement)
	rg.DELETE("/admin/announcements/:childId", h.DeleteAnnouncement)

	rg.POST("/admin/organisations/:id/meetings", h.CreateMeeting)
	rg.PATCH("/admin/meetings/:childId", h.UpdateMeeting)
	rg.DELETE("/admin/meetings/:childId", h.DeleteMeeting)
	rg.POST("/admin/meetings/:childId/minutes", h.PublishMinutes)

	rg.POST("/admin/organisations/:id/documents", h.CreateDocument)
	rg.PATCH("/admin/documents/:childId", h.UpdateDocument)
	rg.DELETE("/admin/documents/:childId", h.DeleteDocument)

	rg.POST("/admin/organisations/:id/events", h.CreateEvent)
	rg.PATCH("/admin/events/:childId", h.UpdateEvent)
	rg.DELETE("/admin/events/:childId", h.DeleteEvent)

	rg.POST("/admin/organisations/:id/tasks", h.CreateTask)
	rg.PATCH("/admin/tasks/:childId", h.UpdateTaskAdmin)
	rg.DELETE("/admin/tasks/:childId", h.DeleteTask)

	// Money path: raises the invoices PayInvoice settles. Both require an
	// Idempotency-Key — a replayed dues run would re-bill an entire roster.
	rg.POST("/admin/organisations/:id/dues/run", h.RunDues)
	rg.POST("/admin/invoices", h.CreateInvoice)

	// ── Settings (V) ────────────────────────────────────────────
	rg.GET("/me/notification-prefs", h.GetNotificationPrefs)
	rg.PUT("/me/notification-prefs", h.UpdateNotificationPrefs)
	rg.GET("/me/security", h.GetSecurity)
	rg.PUT("/me/security", h.UpdateSecurity)
	rg.GET("/me/preferences", h.GetPreferences)
	rg.PUT("/me/preferences", h.UpdatePreferences)
	rg.GET("/me/devices", h.GetDevices)
	// assoc_devices had no writer, so the list was always empty and the revoke
	// endpoint always 403'd on zero rows affected.
	rg.POST("/me/devices", h.RegisterDevice)
	rg.DELETE("/me/devices/:id", h.RevokeDevice)

	// ── Support (W) ─────────────────────────────────────────────
	rg.GET("/support/faqs", h.GetFaqs)
	rg.GET("/support/tickets", h.ListTickets)
	rg.POST("/support/tickets", h.CreateTicket)
	rg.GET("/support/tickets/:id", h.GetTicket)
	rg.POST("/support/tickets/:id/messages", h.ReplyTicket)

	// ── Chat (I) ────────────────────────────────────────────────
	rg.GET("/chat/threads", h.ListChatThreads)
	rg.GET("/chat/threads/:id", h.GetChatThread)
	rg.POST("/chat/threads/:id/messages", h.SendChatMessage)
	rg.POST("/chat/threads/:id/messages/:messageId/react", h.ReactToMessage)
	rg.POST("/chat/threads/:id/mute", h.MuteChatThread)

	// ── AI notes (L) ────────────────────────────────────────────
	rg.GET("/ai-notes", h.ListAiNotes)
	rg.POST("/ai-notes", h.CreateAiNote)
	rg.GET("/ai-notes/:id", h.GetAiNote)
	rg.GET("/ai-notes/:id/status", h.GetAiNoteStatus)
	rg.POST("/ai-notes/:id/regenerate-summary", h.RegenerateAiNoteSummary)
	rg.POST("/ai-notes/:id/approve", h.ApproveAiNote)
	rg.POST("/ai-notes/:id/publish", h.PublishAiNote)
	rg.POST("/ai-notes/:id/action-items/:itemId/convert", h.ConvertActionItem)

	// ── Join / publish (B, U) ───────────────────────────────────
	rg.POST("", h.PublishOrganisation)
	rg.POST("/apply", h.SubmitApplication)
	rg.POST("/invites/validate", h.ValidateInvite)
	rg.POST("/access-codes/validate", h.ValidateAccessCode)
}
