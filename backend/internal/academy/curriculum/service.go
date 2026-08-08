package curriculum

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the academy curriculum domain service. Reads are open; admin
// mutations are audited (RBAC is enforced at the route layer, academy.curriculum).
type Service struct {
	repo *Repository
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{repo: NewRepository(pool)} }

// NewServiceWith allows injecting a repository (tests).
func NewServiceWith(repo *Repository) *Service { return &Service{repo: repo} }

// ── Read APIs ─────────────────────────────────────────────────────────────────

func (s *Service) ListVersions(ctx context.Context) ([]CurriculumVersion, error) {
	return s.repo.ListVersions(ctx)
}

func (s *Service) ListClasses(ctx context.Context, versionID string, limit int) ([]Class, error) {
	return s.repo.ListClasses(ctx, versionID, limit)
}

// GetClassTree returns a class plus its subjects (with exam_relevance).
func (s *Service) GetClassTree(ctx context.Context, classID string) (*ClassTree, error) {
	c, err := s.repo.GetClass(ctx, classID)
	if err != nil {
		return nil, err
	}
	subs, err := s.repo.ListSubjects(ctx, classID)
	if err != nil {
		return nil, err
	}
	return &ClassTree{Class: *c, Subjects: subs}, nil
}

func (s *Service) ListSubjects(ctx context.Context, classID string) ([]Subject, error) {
	return s.repo.ListSubjects(ctx, classID)
}

// GetSubject returns a single subject by id.
func (s *Service) GetSubject(ctx context.Context, id string) (*Subject, error) {
	return s.repo.GetSubjectByID(ctx, id)
}

func (s *Service) ListTopics(ctx context.Context, subjectID string) ([]Topic, error) {
	return s.repo.ListTopics(ctx, subjectID)
}

// GetTopic returns a single topic by id.
func (s *Service) GetTopic(ctx context.Context, id string) (*Topic, error) {
	return s.repo.GetTopicByID(ctx, id)
}

// LessonsForTopic bridges topic → objectives → content lessons (read-only).
func (s *Service) LessonsForTopic(ctx context.Context, topicID string) ([]Lesson, error) {
	return s.repo.ListTopicLessons(ctx, topicID)
}

// GetLesson returns a single content lesson by id (read-only).
func (s *Service) GetLesson(ctx context.Context, id string) (*Lesson, error) {
	return s.repo.GetLessonByID(ctx, id)
}

// AdminTree composes the full curriculum tree (versions → classes → subjects)
// from the existing list queries. Read-only; there is no dedicated tree table.
func (s *Service) AdminTree(ctx context.Context) ([]VersionTree, error) {
	versions, err := s.repo.ListVersions(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]VersionTree, 0, len(versions))
	for _, v := range versions {
		classes, err := s.repo.ListClasses(ctx, v.ID, 0)
		if err != nil {
			return nil, err
		}
		nodes := make([]ClassSubjectsTree, 0, len(classes))
		for _, cl := range classes {
			subs, err := s.repo.ListSubjects(ctx, cl.ID)
			if err != nil {
				return nil, err
			}
			nodes = append(nodes, ClassSubjectsTree{Class: cl, Subjects: subs})
		}
		out = append(out, VersionTree{Version: v, Classes: nodes})
	}
	return out, nil
}

func (s *Service) GetObjectives(ctx context.Context, topicID string) ([]LearningObjective, error) {
	return s.repo.ListObjectives(ctx, topicID)
}

func (s *Service) ListStreams(ctx context.Context) ([]Stream, error) { return s.repo.ListStreams(ctx) }

func (s *Service) ListTradeTracks(ctx context.Context) ([]TradeTrack, error) {
	return s.repo.ListTradeTracks(ctx)
}

// ── Admin CRUD (audited) ──────────────────────────────────────────────────────

func (s *Service) CreateVersion(ctx context.Context, actorID string, req CreateVersionRequest) (*CurriculumVersion, error) {
	v, err := s.repo.CreateVersion(ctx, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.version.created", "academy_curriculum_version", v.ID, v)
	return v, nil
}

func (s *Service) UpdateVersion(ctx context.Context, actorID, id string, req UpdateVersionRequest) (*CurriculumVersion, error) {
	v, err := s.repo.UpdateVersion(ctx, id, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.version.updated", "academy_curriculum_version", v.ID, req)
	return v, nil
}

// PublishVersion performs the guarded draft → active transition (audited).
func (s *Service) PublishVersion(ctx context.Context, actorID, id string) (*CurriculumVersion, error) {
	v, err := s.repo.PublishVersion(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.version.published", "academy_curriculum_version", v.ID, v)
	return v, nil
}

func (s *Service) CreateClass(ctx context.Context, actorID string, req CreateClassRequest) (*Class, error) {
	c, err := s.repo.CreateClass(ctx, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.class.created", "academy_class", c.ID, c)
	return c, nil
}

func (s *Service) UpdateClass(ctx context.Context, actorID, id string, req UpdateClassRequest) (*Class, error) {
	c, err := s.repo.UpdateClass(ctx, id, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.class.updated", "academy_class", c.ID, req)
	return c, nil
}

func (s *Service) CreateSubject(ctx context.Context, actorID string, req CreateSubjectRequest) (*Subject, error) {
	sub, err := s.repo.CreateSubject(ctx, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.subject.created", "academy_subject", sub.ID, sub)
	return sub, nil
}

func (s *Service) UpdateSubject(ctx context.Context, actorID, id string, req UpdateSubjectRequest) (*Subject, error) {
	sub, err := s.repo.UpdateSubject(ctx, id, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.subject.updated", "academy_subject", sub.ID, req)
	return sub, nil
}

func (s *Service) CreateTopic(ctx context.Context, actorID string, req CreateTopicRequest) (*Topic, error) {
	t, err := s.repo.CreateTopic(ctx, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.topic.created", "academy_topic", t.ID, t)
	return t, nil
}

func (s *Service) UpdateTopic(ctx context.Context, actorID, id string, req UpdateTopicRequest) (*Topic, error) {
	t, err := s.repo.UpdateTopic(ctx, id, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.topic.updated", "academy_topic", t.ID, req)
	return t, nil
}

func (s *Service) CreateObjective(ctx context.Context, actorID string, req CreateObjectiveRequest) (*LearningObjective, error) {
	o, err := s.repo.CreateObjective(ctx, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.objective.created", "academy_learning_objective", o.ID, o)
	return o, nil
}

func (s *Service) UpdateObjective(ctx context.Context, actorID, id string, req UpdateObjectiveRequest) (*LearningObjective, error) {
	o, err := s.repo.UpdateObjective(ctx, id, req)
	if err != nil {
		return nil, err
	}
	_ = s.repo.InsertAudit(ctx, actorID, "academy.curriculum.objective.updated", "academy_learning_objective", o.ID, req)
	return o, nil
}
