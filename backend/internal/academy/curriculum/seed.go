package curriculum

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Seed installs the baseline VERSIONED curriculum data idempotently. Every insert
// uses ON CONFLICT DO NOTHING keyed on the table's natural UNIQUE constraint, so
// Seed is safe to run on every startup and forms a stable contract:
//
//   - versions: NERDC-2025 (effective 2025-09-01, active) + LEGACY (active).
//   - classes (for BOTH versions): P1..P6, JSS1..JSS3, SSS1..SSS3 with phases
//     LowerPrimary (P1-3), UpperPrimary (P4-6), JSS, SSS and ascending ordinals.
//   - streams: Science / Humanities / Commercial.
//   - trade tracks: solar_pv, fashion_garment, livestock, beauty_cosmetology,
//     computer_gsm_repair, horticulture.
//   - For NERDC-2025 ENTRY classes (P1, P4, JSS1, SSS1): a representative
//     subject → topic → objective tree with exam_relevance tags per curriculum.md
//     (UpperPrimary→CCE; JSS→BECE; SSS→WASSCE,NECO,UTME).
//
// All curriculum content lives here as DATA — service logic never hardcodes it.
func Seed(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return nil
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := seedVersions(ctx, tx); err != nil {
		return err
	}
	if err := seedStreams(ctx, tx); err != nil {
		return err
	}
	if err := seedTradeTracks(ctx, tx); err != nil {
		return err
	}
	if err := seedClasses(ctx, tx); err != nil {
		return err
	}
	if err := seedEntryClassTrees(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── Versions ────────────────────────────────────────────────────────────────

func seedVersions(ctx context.Context, tx pgx.Tx) error {
	const q = `
		INSERT INTO public.academy_curriculum_versions (code, name, effective_date, status)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (code) DO NOTHING`
	rows := []struct {
		code, name, eff, status string
	}{
		{VersionCodeNERDC2025, "NERDC National Curriculum 2025", "2025-09-01", "active"},
		{VersionCodeLegacy, "Legacy National Curriculum", "", "active"},
	}
	for _, r := range rows {
		var eff any
		if r.eff != "" {
			eff = r.eff
		}
		if _, err := tx.Exec(ctx, q, r.code, r.name, eff, r.status); err != nil {
			return fmt.Errorf("seed version %s: %w", r.code, err)
		}
	}
	return nil
}

// ── Streams ─────────────────────────────────────────────────────────────────

func seedStreams(ctx context.Context, tx pgx.Tx) error {
	const q = `
		INSERT INTO public.academy_streams (code, name)
		VALUES ($1,$2)
		ON CONFLICT (code) DO NOTHING`
	rows := [][2]string{
		{"Science", "Science"},
		{"Humanities", "Humanities"},
		{"Commercial", "Commercial"},
	}
	for _, r := range rows {
		if _, err := tx.Exec(ctx, q, r[0], r[1]); err != nil {
			return fmt.Errorf("seed stream %s: %w", r[0], err)
		}
	}
	return nil
}

// ── Trade tracks ────────────────────────────────────────────────────────────

func seedTradeTracks(ctx context.Context, tx pgx.Tx) error {
	const q = `
		INSERT INTO public.academy_trade_tracks (code, name, status)
		VALUES ($1,$2,'active')
		ON CONFLICT (code) DO NOTHING`
	rows := [][2]string{
		{"solar_pv", "Solar PV Installation"},
		{"fashion_garment", "Fashion & Garment Making"},
		{"livestock", "Livestock Farming"},
		{"beauty_cosmetology", "Beauty & Cosmetology"},
		{"computer_gsm_repair", "Computer & GSM Repair"},
		{"horticulture", "Horticulture"},
	}
	for _, r := range rows {
		if _, err := tx.Exec(ctx, q, r[0], r[1]); err != nil {
			return fmt.Errorf("seed trade track %s: %w", r[0], err)
		}
	}
	return nil
}

// ── Classes (for BOTH versions) ─────────────────────────────────────────────

// classSpec is the full set of K-12 classes with phase + ordinal.
type classSpec struct {
	phase   string
	code    string
	name    string
	ordinal int
}

func classSpine() []classSpec {
	return []classSpec{
		{"LowerPrimary", "P1", "Primary 1", 1},
		{"LowerPrimary", "P2", "Primary 2", 2},
		{"LowerPrimary", "P3", "Primary 3", 3},
		{"UpperPrimary", "P4", "Primary 4", 4},
		{"UpperPrimary", "P5", "Primary 5", 5},
		{"UpperPrimary", "P6", "Primary 6", 6},
		{"JSS", "JSS1", "Junior Secondary 1", 7},
		{"JSS", "JSS2", "Junior Secondary 2", 8},
		{"JSS", "JSS3", "Junior Secondary 3", 9},
		{"SSS", "SSS1", "Senior Secondary 1", 10},
		{"SSS", "SSS2", "Senior Secondary 2", 11},
		{"SSS", "SSS3", "Senior Secondary 3", 12},
	}
}

func seedClasses(ctx context.Context, tx pgx.Tx) error {
	const q = `
		INSERT INTO public.academy_classes (version_id, phase, code, name, ordinal)
		SELECT v.id, $2, $3, $4, $5
		FROM public.academy_curriculum_versions v
		WHERE v.code = $1
		ON CONFLICT (version_id, code) DO NOTHING`
	for _, vcode := range []string{VersionCodeNERDC2025, VersionCodeLegacy} {
		for _, c := range classSpine() {
			if _, err := tx.Exec(ctx, q, vcode, c.phase, c.code, c.name, c.ordinal); err != nil {
				return fmt.Errorf("seed class %s/%s: %w", vcode, c.code, err)
			}
		}
	}
	return nil
}

// ── Entry-class subject → topic → objective trees (NERDC-2025 only) ──────────

// objectiveSpec is one learning objective with exam tags.
type objectiveSpec struct {
	code     string
	title    string
	examTags []string
	ordinal  int
}

// topicSpec is one topic with its objectives.
type topicSpec struct {
	code       string
	title      string
	ordinal    int
	objectives []objectiveSpec
}

// subjectSpec is one subject with exam_relevance and its topic tree.
type subjectSpec struct {
	code          string
	name          string
	kind          string
	stream        *string
	examRelevance []string
	topics        []topicSpec
}

func strPtr(s string) *string { return &s }

// entryClassTrees returns the representative content tree per NERDC-2025 entry
// class. Exam-relevance follows curriculum.md: UpperPrimary→CCE (Common Entrance),
// JSS→BECE, SSS→WASSCE/NECO/UTME. Lower Primary (P1) has no terminal exam, so its
// subjects carry empty exam_relevance.
func entryClassTrees() map[string][]subjectSpec {
	return map[string][]subjectSpec{
		// P1 — Lower Primary entry class (no terminal exam tags).
		"P1": {
			{code: "ENG", name: "English Studies", kind: "core", topics: []topicSpec{
				{code: "ENG-LISTEN", title: "Listening and Speaking", ordinal: 1, objectives: []objectiveSpec{
					{code: "ENG-LISTEN-1", title: "Respond to simple spoken instructions", ordinal: 1},
					{code: "ENG-LISTEN-2", title: "Recite rhymes and simple poems", ordinal: 2},
				}},
				{code: "ENG-PHONICS", title: "Phonics and Reading Readiness", ordinal: 2, objectives: []objectiveSpec{
					{code: "ENG-PHONICS-1", title: "Identify letter sounds a-z", ordinal: 1},
					{code: "ENG-PHONICS-2", title: "Blend two- and three-letter words", ordinal: 2},
				}},
			}},
			{code: "MTH", name: "Mathematics", kind: "core", topics: []topicSpec{
				{code: "MTH-NUM", title: "Whole Numbers to 100", ordinal: 1, objectives: []objectiveSpec{
					{code: "MTH-NUM-1", title: "Count, read and write numbers 1-100", ordinal: 1},
					{code: "MTH-NUM-2", title: "Order and compare numbers to 100", ordinal: 2},
				}},
			}},
			{code: "BSC", name: "Basic Science and Technology", kind: "core", topics: []topicSpec{
				{code: "BSC-LIVING", title: "Living and Non-living Things", ordinal: 1, objectives: []objectiveSpec{
					{code: "BSC-LIVING-1", title: "Distinguish living from non-living things", ordinal: 1},
					{code: "BSC-LIVING-2", title: "Name parts of the human body", ordinal: 2},
				}},
			}},
			{code: "NLG", name: "Nigerian Language", kind: "core", topics: []topicSpec{
				{code: "NLG-GREET", title: "Greetings and Everyday Expressions", ordinal: 1, objectives: []objectiveSpec{
					{code: "NLG-GREET-1", title: "Use common greetings in a Nigerian language", ordinal: 1},
				}},
			}},
			{code: "ARB", name: "Arabic", kind: "optional", topics: []topicSpec{
				{code: "ARB-ALIF", title: "The Arabic Alphabet", ordinal: 1, objectives: []objectiveSpec{
					{code: "ARB-ALIF-1", title: "Recognise and write Arabic letters", ordinal: 1},
				}},
			}},
		},
		// P4 — Upper Primary entry class → Common Entrance (CCE).
		"P4": {
			{code: "ENG", name: "English Studies", kind: "core", examRelevance: []string{"CCE"}, topics: []topicSpec{
				{code: "ENG-COMP", title: "Reading Comprehension", ordinal: 1, objectives: []objectiveSpec{
					{code: "ENG-COMP-1", title: "Answer literal questions on a passage", examTags: []string{"CCE"}, ordinal: 1},
					{code: "ENG-COMP-2", title: "Identify main idea of a passage", examTags: []string{"CCE"}, ordinal: 2},
				}},
				{code: "ENG-GRAM", title: "Grammar and Usage", ordinal: 2, objectives: []objectiveSpec{
					{code: "ENG-GRAM-1", title: "Use nouns, verbs and adjectives correctly", examTags: []string{"CCE"}, ordinal: 1},
				}},
			}},
			{code: "MTH", name: "Mathematics", kind: "core", examRelevance: []string{"CCE"}, topics: []topicSpec{
				{code: "MTH-FRAC", title: "Fractions", ordinal: 1, objectives: []objectiveSpec{
					{code: "MTH-FRAC-1", title: "Add and subtract simple fractions", examTags: []string{"CCE"}, ordinal: 1},
					{code: "MTH-FRAC-2", title: "Convert between improper fractions and mixed numbers", examTags: []string{"CCE"}, ordinal: 2},
				}},
			}},
			{code: "BST", name: "Basic Science and Technology", kind: "core", examRelevance: []string{"CCE"}, topics: []topicSpec{
				{code: "BST-MATTER", title: "States of Matter", ordinal: 1, objectives: []objectiveSpec{
					{code: "BST-MATTER-1", title: "Classify matter as solid, liquid or gas", examTags: []string{"CCE"}, ordinal: 1},
				}},
			}},
			{code: "BDL", name: "Basic Digital Literacy", kind: "core", examRelevance: []string{"CCE"}, topics: []topicSpec{
				{code: "BDL-PARTS", title: "Parts of a Computer", ordinal: 1, objectives: []objectiveSpec{
					{code: "BDL-PARTS-1", title: "Identify input and output devices", examTags: []string{"CCE"}, ordinal: 1},
				}},
			}},
		},
		// JSS1 — JSS entry class → BECE.
		"JSS1": {
			{code: "ENG", name: "English Language", kind: "core", examRelevance: []string{"BECE"}, topics: []topicSpec{
				{code: "ENG-ESSAY", title: "Essay Writing", ordinal: 1, objectives: []objectiveSpec{
					{code: "ENG-ESSAY-1", title: "Write a coherent narrative essay", examTags: []string{"BECE"}, ordinal: 1},
					{code: "ENG-ESSAY-2", title: "Apply paragraphing and topic sentences", examTags: []string{"BECE"}, ordinal: 2},
				}},
			}},
			{code: "MTH", name: "Mathematics", kind: "core", examRelevance: []string{"BECE"}, topics: []topicSpec{
				{code: "MTH-INT", title: "Integers and Number Line", ordinal: 1, objectives: []objectiveSpec{
					{code: "MTH-INT-1", title: "Perform operations on integers", examTags: []string{"BECE"}, ordinal: 1},
					{code: "MTH-INT-2", title: "Solve simple linear equations", examTags: []string{"BECE"}, ordinal: 2},
				}},
			}},
			{code: "BSC", name: "Intermediate Science", kind: "core", examRelevance: []string{"BECE"}, topics: []topicSpec{
				{code: "BSC-CELL", title: "The Cell", ordinal: 1, objectives: []objectiveSpec{
					{code: "BSC-CELL-1", title: "Describe the structure of a plant and animal cell", examTags: []string{"BECE"}, ordinal: 1},
				}},
			}},
			{code: "BST", name: "Business Studies", kind: "core", examRelevance: []string{"BECE"}, topics: []topicSpec{
				{code: "BST-TRADE", title: "Trade and Commerce", ordinal: 1, objectives: []objectiveSpec{
					{code: "BST-TRADE-1", title: "Explain forms of trade", examTags: []string{"BECE"}, ordinal: 1},
				}},
			}},
			{code: "TRD", name: "Trade Subject", kind: "core", examRelevance: []string{"BECE"}, topics: []topicSpec{
				{code: "TRD-INTRO", title: "Introduction to Trade Skills", ordinal: 1, objectives: []objectiveSpec{
					{code: "TRD-INTRO-1", title: "Identify tools and safety practices for the chosen trade", examTags: []string{"BECE"}, ordinal: 1},
				}},
			}},
		},
		// SSS1 — SSS entry class → WASSCE, NECO, UTME. Includes a streamed elective.
		"SSS1": {
			{code: "ENG", name: "English Language", kind: "core", examRelevance: []string{"WASSCE", "NECO", "UTME"}, topics: []topicSpec{
				{code: "ENG-SUMM", title: "Summary and Comprehension", ordinal: 1, objectives: []objectiveSpec{
					{code: "ENG-SUMM-1", title: "Summarise a passage in a fixed word count", examTags: []string{"WASSCE", "NECO", "UTME"}, ordinal: 1},
					{code: "ENG-SUMM-2", title: "Answer inference-based comprehension questions", examTags: []string{"WASSCE", "NECO", "UTME"}, ordinal: 2},
				}},
			}},
			{code: "MTH", name: "Mathematics", kind: "core", examRelevance: []string{"WASSCE", "NECO", "UTME"}, topics: []topicSpec{
				{code: "MTH-QUAD", title: "Quadratic Equations", ordinal: 1, objectives: []objectiveSpec{
					{code: "MTH-QUAD-1", title: "Solve quadratic equations by factorisation", examTags: []string{"WASSCE", "NECO", "UTME"}, ordinal: 1},
					{code: "MTH-QUAD-2", title: "Use the quadratic formula", examTags: []string{"WASSCE", "NECO", "UTME"}, ordinal: 2},
				}},
			}},
			{code: "CIV", name: "Civic Education", kind: "core", examRelevance: []string{"WASSCE", "NECO"}, topics: []topicSpec{
				{code: "CIV-RIGHTS", title: "Rights and Responsibilities", ordinal: 1, objectives: []objectiveSpec{
					{code: "CIV-RIGHTS-1", title: "Explain fundamental human rights", examTags: []string{"WASSCE", "NECO"}, ordinal: 1},
				}},
			}},
			{code: "PHY", name: "Physics", kind: "elective", stream: strPtr("Science"), examRelevance: []string{"WASSCE", "NECO", "UTME"}, topics: []topicSpec{
				{code: "PHY-MOTION", title: "Motion", ordinal: 1, objectives: []objectiveSpec{
					{code: "PHY-MOTION-1", title: "Describe types of motion", examTags: []string{"WASSCE", "NECO", "UTME"}, ordinal: 1},
					{code: "PHY-MOTION-2", title: "Apply equations of uniformly accelerated motion", examTags: []string{"WASSCE", "NECO", "UTME"}, ordinal: 2},
				}},
			}},
			{code: "TRD", name: "Trade Subject", kind: "core", examRelevance: []string{"WASSCE", "NECO"}, topics: []topicSpec{
				{code: "TRD-PRACT", title: "Applied Trade Practice", ordinal: 1, objectives: []objectiveSpec{
					{code: "TRD-PRACT-1", title: "Execute a guided project in the chosen trade", examTags: []string{"WASSCE", "NECO"}, ordinal: 1},
				}},
			}},
		},
	}
}

func seedEntryClassTrees(ctx context.Context, tx pgx.Tx) error {
	// Resolve the NERDC-2025 version id once.
	var versionID string
	err := tx.QueryRow(ctx,
		`SELECT id FROM public.academy_curriculum_versions WHERE code = $1`, VersionCodeNERDC2025).Scan(&versionID)
	if err != nil {
		return fmt.Errorf("resolve version %s: %w", VersionCodeNERDC2025, err)
	}

	const insSubject = `
		INSERT INTO public.academy_subjects
			(version_id, class_id, code, name, kind, stream, exam_relevance)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (class_id, code) DO NOTHING`
	const selSubject = `
		SELECT id FROM public.academy_subjects WHERE class_id = $1 AND code = $2`
	const insTopic = `
		INSERT INTO public.academy_topics (subject_id, code, title, ordinal)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (subject_id, code) DO NOTHING`
	const selTopic = `
		SELECT id FROM public.academy_topics WHERE subject_id = $1 AND code = $2`
	const insObjective = `
		INSERT INTO public.academy_learning_objectives (topic_id, code, title, exam_tags, ordinal)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (topic_id, code) DO NOTHING`

	for classCode, subjects := range entryClassTrees() {
		var classID string
		err := tx.QueryRow(ctx,
			`SELECT id FROM public.academy_classes WHERE version_id = $1 AND code = $2`,
			versionID, classCode).Scan(&classID)
		if err != nil {
			return fmt.Errorf("resolve class %s: %w", classCode, err)
		}

		for _, sub := range subjects {
			kind := sub.kind
			if kind == "" {
				kind = "core"
			}
			if _, err := tx.Exec(ctx, insSubject, versionID, classID, sub.code, sub.name, kind,
				sub.stream, strArray(sub.examRelevance)); err != nil {
				return fmt.Errorf("seed subject %s/%s: %w", classCode, sub.code, err)
			}
			var subjectID string
			if err := tx.QueryRow(ctx, selSubject, classID, sub.code).Scan(&subjectID); err != nil {
				return fmt.Errorf("resolve subject %s/%s: %w", classCode, sub.code, err)
			}

			for _, top := range sub.topics {
				if _, err := tx.Exec(ctx, insTopic, subjectID, top.code, top.title, top.ordinal); err != nil {
					return fmt.Errorf("seed topic %s/%s: %w", sub.code, top.code, err)
				}
				var topicID string
				if err := tx.QueryRow(ctx, selTopic, subjectID, top.code).Scan(&topicID); err != nil {
					return fmt.Errorf("resolve topic %s/%s: %w", sub.code, top.code, err)
				}

				for _, obj := range top.objectives {
					if _, err := tx.Exec(ctx, insObjective, topicID, obj.code, obj.title,
						strArray(obj.examTags), obj.ordinal); err != nil {
						return fmt.Errorf("seed objective %s/%s: %w", top.code, obj.code, err)
					}
				}
			}
		}
	}
	return nil
}
