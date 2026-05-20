package app

import (
	"time"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/handlers"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/repositories"
	"spotlight/backend/internal/services"
)

func NewRouter(cfg config.Config) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORSMiddleware(cfg.CORSAllowOrigins))

	health := handlers.NewHealthHandler()
	supabase := integrations.NewSupabaseRestClient(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey)
	adminRepo := repositories.NewAdminSupabaseRepository(supabase)
	leadRepo := repositories.NewLeadSupabaseRepository(supabase)
	chatRepo := repositories.NewChatSupabaseRepository(supabase)
	handoffRepo := repositories.NewHandoffSupabaseRepository(supabase)
	analyticsRepo := repositories.NewAnalyticsSupabaseRepository(supabase)
	competitionRepo := repositories.NewCompetitionSupabaseRepository(supabase)
	realityTVRepo := repositories.NewRealityTVSupabaseRepository(supabase)
	stemRepo := repositories.NewStemSupabaseRepository(supabase)
	admin := handlers.NewAdminHandler(services.NewAdminService(adminRepo))
	leads := handlers.NewLeadHandler(services.NewLeadService(leadRepo))
	chats := handlers.NewChatHandler(services.NewChatService(chatRepo))
	handoffs := handlers.NewHandoffHandler(services.NewHandoffService(handoffRepo))
	analytics := handlers.NewAnalyticsHandler(services.NewAnalyticsService(analyticsRepo))
	competitions := handlers.NewCompetitionHandler(services.NewCompetitionService(competitionRepo))
	realityTV := handlers.NewRealityTVHandler(services.NewRealityTVService(realityTVRepo))
	stem := handlers.NewStemHandler(services.NewStemService(stemRepo))

	v1 := r.Group("/api/v1")
	{
		public := v1.Group("/public")
		public.GET("/health", health.PublicHealth)

		auth := v1.Group("/auth")
		auth.GET("/health", health.GenericHealth)

		users := v1.Group("/users")
		users.GET("/health", health.GenericHealth)

		schools := v1.Group("/schools")
		schools.Use(middleware.StemRateLimit(25, time.Minute))
		schools.GET("", stem.Schools)
		schools.POST("", stem.CreateSchool)
		schools.GET("/:id/dashboard", stem.SchoolDashboard)

		schoolProfiles := v1.Group("/school-profiles")
		schoolProfiles.Use(middleware.StemRateLimit(30, time.Minute))
		schoolProfiles.GET("", stem.SchoolProfiles)
		schoolProfiles.POST("", stem.CreateSchoolProfile)

		schoolTeams := v1.Group("/school-teams")
		schoolTeams.Use(middleware.StemRateLimit(30, time.Minute))
		schoolTeams.GET("", stem.SchoolTeams)
		schoolTeams.POST("", stem.CreateSchoolTeam)

		emerging := v1.Group("/emerging-innovators")
		emerging.Use(middleware.StemRateLimit(25, time.Minute))
		emerging.GET("", stem.EmergingInnovators)
		emerging.POST("", stem.CreateEmergingInnovator)

		emergingTeams := v1.Group("/emerging-teams")
		emergingTeams.Use(middleware.StemRateLimit(30, time.Minute))
		emergingTeams.GET("", stem.EmergingTeams)
		emergingTeams.POST("", stem.CreateEmergingTeam)

		emergingProjects := v1.Group("/emerging-projects")
		emergingProjects.Use(middleware.StemRateLimit(30, time.Minute))
		emergingProjects.GET("", stem.EmergingProjects)
		emergingProjects.POST("", stem.CreateEmergingProject)

		contests := v1.Group("/stem-contests")
		contests.Use(middleware.StemRateLimit(20, time.Minute))
		contests.GET("", stem.Contests)
		contests.POST("", stem.CreateContest)

		eligibility := v1.Group("/stem-eligibility")
		eligibility.Use(middleware.StemRateLimit(20, time.Minute))
		eligibility.POST("/check", stem.CheckEligibility)

		leaderboard := v1.Group("/stem-leaderboard")
		leaderboard.Use(middleware.StemRateLimit(60, time.Minute))
		leaderboard.GET("", stem.Leaderboard)
		leaderboard.GET("/slices", stem.LeaderboardSlices)

		submissions := v1.Group("/stem-submissions")
		submissions.Use(middleware.StemRateLimit(20, time.Minute))
		submissions.GET("", stem.Submissions)
		submissions.PATCH("/:id/status", stem.UpdateSubmissionStatus)

		judging := v1.Group("/stem-judging")
		judging.Use(middleware.StemRateLimit(20, time.Minute))
		judging.GET("/scores", stem.JudgingScores)
		judging.POST("/scores", stem.CreateJudgingScore)
		judging.PATCH("/scores/:id/review-state", stem.UpdateJudgingScoreReviewState)
		judging.GET("/rubrics", stem.JudgingRubrics)
		judging.POST("/rubrics", stem.CreateJudgingRubric)
		judging.GET("/criteria", stem.JudgingCriteria)
		judging.GET("/assignments", stem.JudgeAssignments)
		judging.POST("/assignments", stem.CreateJudgeAssignment)
		judging.PATCH("/assignments/:id/conflict", stem.UpdateJudgeAssignmentConflict)

		voting := v1.Group("/stem-voting")
		voting.Use(middleware.StemRateLimit(30, time.Minute))
		voting.GET("/rules", stem.VotingRules)
		voting.POST("/rules", stem.UpsertVotingRule)
		voting.GET("/packages", stem.VotePackages)
		voting.POST("/packages", stem.CreateVotePackage)
		voting.GET("/transactions", stem.VoteTransactions)
		voting.POST("/transactions", stem.CreateVoteTransaction)

		bootcamp := v1.Group("/stem-bootcamp")
		bootcamp.Use(middleware.StemRateLimit(20, time.Minute))
		bootcamp.GET("/cohorts", stem.BootcampCohorts)
		bootcamp.POST("/cohorts", stem.CreateBootcampCohort)
		bootcamp.GET("/tasks", stem.BootcampTasks)
		bootcamp.POST("/tasks", stem.CreateBootcampTask)
		bootcamp.GET("/scores", stem.BootcampScores)
		bootcamp.POST("/scores", stem.UpsertBootcampScore)

		sponsors := v1.Group("/stem-sponsors")
		sponsors.Use(middleware.StemRateLimit(20, time.Minute))
		sponsors.GET("", stem.Sponsors)
		sponsors.POST("", stem.CreateSponsor)

		awards := v1.Group("/stem-awards")
		awards.Use(middleware.StemRateLimit(20, time.Minute))
		awards.GET("/certificates", stem.Certificates)
		awards.POST("/certificates", stem.CreateCertificate)
		awards.GET("/badges", stem.Badges)
		awards.POST("/badges", stem.CreateBadge)
		awards.GET("/badge-awards", stem.BadgeAwards)
		awards.POST("/badge-awards", stem.AwardBadge)

		reports := v1.Group("/stem-reports")
		reports.Use(middleware.StemRateLimit(30, time.Minute))
		reports.GET("/summary", stem.ReportSummary)
		reports.GET("/buckets", stem.ReportBuckets)

		adminGroup := v1.Group("/admin")
		adminGroup.Use(middleware.RequireAdmin(cfg.AdminAPIKey))
		adminGroup.GET("/menu-counts", admin.MenuCounts)
		adminGroup.GET("/leads", leads.List)
		adminGroup.PATCH("/leads/:id", leads.UpdateStatus)
		adminGroup.GET("/chatbot/sessions", chats.ListSessions)
		adminGroup.GET("/chatbot/sessions/:id", chats.GetSession)
		adminGroup.GET("/handoffs", handoffs.List)
		adminGroup.PATCH("/handoffs/:id", handoffs.UpdateStatus)
		adminGroup.GET("/analytics/summary", analytics.Summary)
		adminGroup.GET("/competitions/overview", competitions.Overview)
		adminGroup.GET("/competitions/open-mic", competitions.OpenMic)
		adminGroup.POST("/competitions/open-mic", competitions.CreateOpenMic)
		adminGroup.GET("/reality-tv/dashboard", realityTV.Dashboard)

		stemRead := adminGroup.Group("")
		stemRead.Use(middleware.StemRateLimit(120, time.Minute))
		stemRead.Use(middleware.RequireStemRoles(
			"SUPER_ADMIN",
			"ADMIN",
			"OPERATIONS_MANAGER",
			"CONTEST_MANAGER",
			"SCHOOL_ADMIN",
			"TEACHER_COACH",
			"JUDGE",
			"MENTOR",
			"SPONSOR",
		))
		stemRead.GET("/stem/overview", stem.Overview)
		stemRead.GET("/schools", stem.Schools)
		stemRead.GET("/schools/:id/dashboard", stem.SchoolDashboard)
		stemRead.GET("/school-profiles", stem.SchoolProfiles)
		stemRead.GET("/school-teams", stem.SchoolTeams)
		stemRead.GET("/emerging-innovators", stem.EmergingInnovators)
		stemRead.GET("/emerging-teams", stem.EmergingTeams)
		stemRead.GET("/emerging-projects", stem.EmergingProjects)
		stemRead.GET("/stem-contests", stem.Contests)
		stemRead.GET("/stem-leaderboard", stem.Leaderboard)
		stemRead.GET("/stem-leaderboard/slices", stem.LeaderboardSlices)
		stemRead.GET("/stem-submissions", stem.Submissions)
		stemRead.GET("/stem-judging/scores", stem.JudgingScores)
		stemRead.GET("/stem-judging/rubrics", stem.JudgingRubrics)
		stemRead.GET("/stem-judging/criteria", stem.JudgingCriteria)
		stemRead.GET("/stem-judging/assignments", stem.JudgeAssignments)
		stemRead.GET("/stem-voting/rules", stem.VotingRules)
		stemRead.GET("/stem-voting/packages", stem.VotePackages)
		stemRead.GET("/stem-voting/transactions", stem.VoteTransactions)
		stemRead.GET("/stem-bootcamp/cohorts", stem.BootcampCohorts)
		stemRead.GET("/stem-bootcamp/tasks", stem.BootcampTasks)
		stemRead.GET("/stem-bootcamp/scores", stem.BootcampScores)
		stemRead.GET("/stem-sponsors", stem.Sponsors)
		stemRead.GET("/stem-awards/certificates", stem.Certificates)
		stemRead.GET("/stem-awards/badges", stem.Badges)
		stemRead.GET("/stem-awards/badge-awards", stem.BadgeAwards)
		stemRead.GET("/stem-reports/summary", stem.ReportSummary)
		stemRead.GET("/stem-reports/buckets", stem.ReportBuckets)

		stemManage := adminGroup.Group("")
		stemManage.Use(middleware.StemRateLimit(40, time.Minute))
		stemManage.Use(middleware.RequireStemRoles("SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER"))
		stemManage.PATCH("/schools/:id/verification", stem.UpdateSchoolVerification)
		stemManage.POST("/stem-contests", stem.CreateContest)
		stemManage.POST("/stem-eligibility/check", stem.CheckEligibility)
		stemManage.PATCH("/stem-submissions/:id/status", stem.UpdateSubmissionStatus)
		stemManage.POST("/stem-judging/scores", stem.CreateJudgingScore)
		stemManage.PATCH("/stem-judging/scores/:id/review-state", stem.UpdateJudgingScoreReviewState)
		stemManage.POST("/stem-judging/rubrics", stem.CreateJudgingRubric)
		stemManage.POST("/stem-judging/assignments", stem.CreateJudgeAssignment)
		stemManage.PATCH("/stem-judging/assignments/:id/conflict", stem.UpdateJudgeAssignmentConflict)
		stemManage.POST("/stem-voting/rules", stem.UpsertVotingRule)
		stemManage.POST("/stem-voting/packages", stem.CreateVotePackage)
		stemManage.POST("/stem-voting/transactions", stem.CreateVoteTransaction)
		stemManage.POST("/stem-bootcamp/cohorts", stem.CreateBootcampCohort)
		stemManage.POST("/stem-bootcamp/tasks", stem.CreateBootcampTask)
		stemManage.POST("/stem-bootcamp/scores", stem.UpsertBootcampScore)
		stemManage.POST("/stem-sponsors", stem.CreateSponsor)
		stemManage.POST("/stem-awards/certificates", stem.CreateCertificate)
		stemManage.POST("/stem-awards/badges", stem.CreateBadge)
		stemManage.POST("/stem-awards/badge-awards", stem.AwardBadge)

		mobile := v1.Group("/mobile")
		mobile.GET("/health", health.GenericHealth)

		webhooks := v1.Group("/webhooks")
		webhooks.GET("/health", health.GenericHealth)
	}

	return r
}
