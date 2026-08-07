package assessment

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"
)

// PDFReportService generates PDF reports for exam results and analytics
type PDFReportService struct {
	repo *MockExamRepository
}

func NewPDFReportService(repo *MockExamRepository) *PDFReportService {
	return &PDFReportService{repo: repo}
}

// ExamResultsPDF generates a formatted PDF string for exam results
// In production, use github.com/go-pdf/fpdf or similar for actual PDF generation
func (s *PDFReportService) ExamResultsPDF(ctx context.Context, attemptID string) ([]byte, error) {
	// Fetch attempt details
	attempt, err := s.repo.GetAttempt(ctx, attemptID)
	if err != nil {
		return nil, err
	}

	// Fetch instance details
	instance, err := s.repo.GetInstanceByCode(ctx, "") // Would need code lookup
	if err != nil {
		return nil, err
	}

	// Build HTML content that can be converted to PDF
	html := s.buildResultsHTML(attempt, instance)

	// For now, return as HTML bytes (would be converted to PDF in production)
	return []byte(html), nil
}

// buildResultsHTML creates HTML representation of exam results
func (s *PDFReportService) buildResultsHTML(attempt *MockExamAttempt, instance *MockExamInstance) string {
	var buf bytes.Buffer

	buf.WriteString(`<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; background: white; }
		.header { text-align: center; border-bottom: 3px solid #1f2937; padding-bottom: 20px; margin-bottom: 30px; }
		.header h1 { margin: 0; color: #1f2937; font-size: 28px; }
		.header p { margin: 5px 0; color: #666; }
		.score-box {
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			color: white;
			padding: 30px;
			border-radius: 8px;
			margin: 20px 0;
			text-align: center;
		}
		.score-large { font-size: 48px; font-weight: bold; }
		.score-label { font-size: 14px; opacity: 0.9; margin-top: 10px; }
		.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
		.metric {
			background: #f3f4f6;
			padding: 15px;
			border-radius: 6px;
			text-align: center;
			border-left: 4px solid #667eea;
		}
		.metric-value { font-size: 24px; font-weight: bold; color: #1f2937; }
		.metric-label { font-size: 12px; color: #666; margin-top: 5px; }
		.section { margin: 30px 0; }
		.section-title {
			font-size: 18px;
			font-weight: bold;
			color: #1f2937;
			border-bottom: 2px solid #e5e7eb;
			padding-bottom: 10px;
			margin-bottom: 15px;
		}
		.performance-breakdown { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
		.performance-item {
			text-align: center;
			padding: 15px;
			background: #f9fafb;
			border-radius: 6px;
		}
		.performance-number { font-size: 32px; font-weight: bold; color: #667eea; }
		.performance-label { font-size: 14px; color: #666; margin-top: 5px; }
		.recommendations {
			background: #f0f9ff;
			border-left: 4px solid #0284c7;
			padding: 15px;
			border-radius: 6px;
			margin-top: 20px;
		}
		.recommendations h3 { margin: 0 0 10px 0; color: #0284c7; }
		.recommendations ul { margin: 0; padding-left: 20px; }
		.recommendations li { margin: 5px 0; }
		.footer {
			text-align: center;
			color: #999;
			font-size: 12px;
			margin-top: 40px;
			border-top: 1px solid #e5e7eb;
			padding-top: 20px;
		}
		table { width: 100%; border-collapse: collapse; margin: 15px 0; }
		th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
		th { background: #f3f4f6; font-weight: bold; }
	</style>
</head>
<body>
	<div class="header">
		<h1>Exam Results Report</h1>
		<p>Spotlight Academy Mock Exam</p>
	</div>
`)

	// Score box
	grade := calculateGrade(int(attempt.ScorePercent))
	scoreColor := getGradeColor(grade)

	buf.WriteString(fmt.Sprintf(`
	<div class="score-box" style="background: linear-gradient(135deg, %s 0%%, %s 100%%);">
		<div class="score-large">%d%%</div>
		<div class="score-label">Final Score</div>
		<div style="font-size: 36px; margin-top: 10px;">Grade: %s</div>
	</div>
`, scoreColor, adjustColor(scoreColor), int(attempt.ScorePercent), grade))

	// Metrics grid
	buf.WriteString(`
	<div class="metrics">
`)

	// Parse performance data
	var correctAnswers, totalAnswered, unanswered int
	if perf, ok := attempt.Performance.(map[string]interface{}); ok {
		if c, ok := perf["correct_answers"].(float64); ok {
			correctAnswers = int(c)
		}
		if t, ok := perf["total_answered"].(float64); ok {
			totalAnswered = int(t)
		}
		if u, ok := perf["unanswered"].(float64); ok {
			unanswered = int(u)
		}
	}

	accuracy := 0.0
	if totalAnswered > 0 {
		accuracy = float64(correctAnswers) / float64(totalAnswered) * 100
	}

	minutes := attempt.TotalSeconds / 60
	seconds := attempt.TotalSeconds % 60

	buf.WriteString(fmt.Sprintf(`
		<div class="metric">
			<div class="metric-value">%d</div>
			<div class="metric-label">Correct Answers</div>
		</div>
		<div class="metric">
			<div class="metric-value">%.1f%%</div>
			<div class="metric-label">Accuracy</div>
		</div>
		<div class="metric">
			<div class="metric-value">%d:%02d</div>
			<div class="metric-label">Time Spent</div>
		</div>
		<div class="metric">
			<div class="metric-value">%s</div>
			<div class="metric-label">Status</div>
		</div>
	</div>
`, correctAnswers, accuracy, minutes, seconds, strings.ToUpper(attempt.Status)))

	// Performance breakdown section
	buf.WriteString(`
	<div class="section">
		<div class="section-title">Performance Breakdown</div>
		<div class="performance-breakdown">
`)

	incorrect := totalAnswered - correctAnswers
	buf.WriteString(fmt.Sprintf(`
			<div class="performance-item">
				<div class="performance-number">%d</div>
				<div class="performance-label">Correct</div>
			</div>
			<div class="performance-item">
				<div class="performance-number">%d</div>
				<div class="performance-label">Incorrect</div>
			</div>
			<div class="performance-item">
				<div class="performance-number">%d</div>
				<div class="performance-label">Unanswered</div>
			</div>
		</div>
	</div>
`, correctAnswers, incorrect, unanswered))

	// Recommendations section
	recommendations := generateRecommendations(int(attempt.ScorePercent))
	buf.WriteString(`
	<div class="section">
		<div class="recommendations">
			<h3>📚 Personalized Recommendations</h3>
			<ul>
`)

	for _, rec := range recommendations {
		buf.WriteString(fmt.Sprintf(`			<li>%s</li>
`, rec))
	}

	buf.WriteString(`
			</ul>
		</div>
	</div>
`)

	// Exam details table
	buf.WriteString(fmt.Sprintf(`
	<div class="section">
		<div class="section-title">Exam Details</div>
		<table>
			<tr>
				<th>Property</th>
				<th>Value</th>
			</tr>
			<tr>
				<td>Attempt ID</td>
				<td>%s</td>
			</tr>
			<tr>
				<td>Instance Code</td>
				<td>%s</td>
			</tr>
			<tr>
				<td>Submitted At</td>
				<td>%s</td>
			</tr>
			<tr>
				<td>Score</td>
				<td>%d / 100</td>
			</tr>
			<tr>
				<td>Grade</td>
				<td>%s</td>
			</tr>
		</table>
	</div>
`, attempt.ID, instance.InstanceCode, attempt.SubmittedAt.Format(time.RFC3339), int(attempt.ScorePercent), grade))

	// Footer
	buf.WriteString(`
	<div class="footer">
		<p>This report was generated by Spotlight Academy Mock Exam System</p>
		<p>For more details and analytics, visit your learner dashboard</p>
	</div>
</body>
</html>
`)

	return buf.String()
}

// LearnerAnalyticsPDF generates analytics report
func (s *PDFReportService) LearnerAnalyticsPDF(analytics *LearnerAnalytics) string {
	var buf bytes.Buffer

	buf.WriteString(`<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; background: white; }
		.header { text-align: center; border-bottom: 3px solid #1f2937; padding-bottom: 20px; margin-bottom: 30px; }
		.header h1 { margin: 0; color: #1f2937; }
		.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
		.kpi { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; }
		.kpi-value { font-size: 32px; font-weight: bold; }
		.kpi-label { font-size: 12px; margin-top: 5px; opacity: 0.9; }
		.section { margin: 30px 0; }
		.section-title { font-size: 18px; font-weight: bold; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
		table { width: 100%; border-collapse: collapse; }
		th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
		th { background: #f3f4f6; font-weight: bold; }
	</style>
</head>
<body>
	<div class="header">
		<h1>Your Learning Analytics Report</h1>
	</div>
`)

	// KPI Section
	buf.WriteString(`
	<div class="kpi-grid">
`)

	buf.WriteString(fmt.Sprintf(`
		<div class="kpi">
			<div class="kpi-value">%d</div>
			<div class="kpi-label">Total Attempts</div>
		</div>
		<div class="kpi">
			<div class="kpi-value">%.1f%%</div>
			<div class="kpi-label">Average Score</div>
		</div>
		<div class="kpi">
			<div class="kpi-value">%.1f%%</div>
			<div class="kpi-label">Best Score</div>
		</div>
		<div class="kpi">
			<div class="kpi-value">%.1f%%</div>
			<div class="kpi-label">Pass Rate</div>
		</div>
	</div>
`, analytics.TotalAttempts, analytics.AverageScore, analytics.BestScore, analytics.PassRate))

	// Recent attempts table
	buf.WriteString(`
	<div class="section">
		<div class="section-title">Recent Exam Attempts</div>
		<table>
			<tr>
				<th>Exam</th>
				<th>Type</th>
				<th>Score</th>
				<th>Grade</th>
				<th>Date</th>
			</tr>
`)

	for _, attempt := range analytics.Attempts {
		buf.WriteString(fmt.Sprintf(`
			<tr>
				<td>%s</td>
				<td>%s</td>
				<td>%.1f%%</td>
				<td>%s</td>
				<td>%s</td>
			</tr>
`, attempt.TemplateName, attempt.ExamType, attempt.ScorePercent, attempt.Grade, attempt.AttemptedAt))
	}

	buf.WriteString(`
		</table>
	</div>
</body>
</html>
`)

	return buf.String()
}

// Helper functions
func getGradeColor(grade string) string {
	colors := map[string]string{
		"A": "#10b981",
		"B": "#3b82f6",
		"C": "#f59e0b",
		"D": "#f97316",
		"F": "#ef4444",
	}
	if c, ok := colors[grade]; ok {
		return c
	}
	return "#6b7280"
}

func adjustColor(hexColor string) string {
	// Darken hex color by 20% (simplified)
	return hexColor
}

func generateRecommendations(scorePercent int) []string {
	if scorePercent >= 90 {
		return []string{
			"Excellent performance! You have demonstrated strong mastery of the material.",
			"Continue with advanced topics or help peers understand difficult concepts.",
			"Consider taking exams from higher difficulty levels to further challenge yourself.",
		}
	} else if scorePercent >= 80 {
		return []string{
			"Good performance! You have a solid understanding of the material.",
			"Focus on the 10-20% of topics where you struggled to achieve perfection.",
			"Practice more on weak areas to build complete mastery.",
		}
	} else if scorePercent >= 70 {
		return []string{
			"Satisfactory performance. You have passed but there's room for improvement.",
			"Identify your weak areas and create a focused study plan.",
			"Take practice drills specifically targeting your identified weak topics.",
			"Review class materials for sections where you scored below 70%.",
		}
	} else if scorePercent >= 60 {
		return []string{
			"You passed, but significant improvement is needed.",
			"Schedule a study session with your teacher to clarify difficult concepts.",
			"Work through practice problems in your weak areas multiple times.",
			"Consider forming a study group with classmates.",
		}
	} else {
		return []string{
			"Additional effort and support are needed to master this material.",
			"Reach out to your teacher for one-on-one tutoring support.",
			"Start with foundational concepts and build up gradually.",
			"Break study sessions into smaller, manageable chunks.",
			"Take this exam again after focused review to track improvement.",
		}
	}
}
