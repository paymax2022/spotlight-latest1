package assistant

// service.go — what reaches the model, what never does, and how a conversation
// moves to a person.
//
// The order of operations on a student turn IS the security design:
//
//  1. store the student's message — the transcript stays complete even if every
//     later step fails, because staff reading a handed-off thread need to see
//     what was actually asked.
//  2. human-mode check — while a ticket is live the model is not called at all.
//  3. rate guard — before the call, so an over-budget student cannot spend the
//     academy's quota on them.
//  4. explicit-human and person-specific detection — both refused without an
//     upstream call, which is what keeps one student's account out of a model
//     that may retain what it is sent.
//  5. retrieval — no published evidence means no model call.
//  6. the model — redacted question plus approved FAQ text, nothing else.
//
// A failure at step 6 degrades to the approved FAQ text or the honest fallback.
// An upstream error, key or quota detail never reaches the client.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	platformRedis "spotlight/backend/internal/platform/redis"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Status labels what the client got, so the screen can draw the right affordance
// instead of guessing from an empty source list.
const (
	StatusAnswered = "answered" // a model (or mock) answer grounded in published FAQs
	StatusFallback = "fallback" // no reliable match, or the model was unavailable
	StatusDeflect  = "deflect"  // a personal case: a person must answer it
	StatusQueued   = "queued"   // human mode: stored for staff, no model involved
	StatusHandoff  = "handoff"  // the conversation just moved to a person
)

// WaitingReply is shown while a conversation is with a person. It promises no
// timescale, because none has been approved to promise.
const WaitingReply = "Academy Support has this. Your messages are saved here and a member of the team will reply in this chat."

// Sentinel errors the HTTP layer maps to a status. Each is a domain outcome, not
// a crash, and the mapping is one-to-one so a client can branch on the code.
var (
	ErrEmptyQuestion  = errors.New("assistant: empty question")
	ErrQuestionLong   = errors.New("assistant: question too long")
	ErrRateLimited    = errors.New("assistant: over the assistant budget")
	ErrNotPublishable = errors.New("assistant: answer is not approved to publish")
	ErrClosedTicket   = errors.New("assistant: ticket is closed")
	ErrBadInput       = errors.New("assistant: invalid input")
)

// Default per-student budget, overridable by environment. Six a minute is well
// past how fast a person types a question; a hundred a day bounds a runaway
// client. Both are checked BEFORE the upstream call.
const (
	defaultRatePerMin = 6
	defaultRatePerDay = 100

	rateKeyPrefix = "academy:assistant:rl:"
)

// Config carries the settings the composition root resolved. Limits of zero fall
// back to the defaults; a negative disables that window.
type Config struct {
	RatePerMin int
	RatePerDay int
}

// Service is the Academy Assistant's application layer. It owns the guardrail
// order above and is the only caller of the provider.
type Service struct {
	store      *Store
	llm        LLMProvider
	rc         *platformRedis.Client
	ratePerMin int
	ratePerDay int
}

func NewService(pool *pgxpool.Pool, llm LLMProvider, rc *platformRedis.Client, cfg Config) *Service {
	if cfg.RatePerMin == 0 {
		cfg.RatePerMin = defaultRatePerMin
	}
	if cfg.RatePerDay == 0 {
		cfg.RatePerDay = defaultRatePerDay
	}
	return &Service{
		store:      NewStore(pool),
		llm:        llm,
		rc:         rc,
		ratePerMin: cfg.RatePerMin,
		ratePerDay: cfg.RatePerDay,
	}
}

// --- the student turn --------------------------------------------------------

// Chat handles one student message and returns the assistant turn, already
// persisted. A nil conversation_id starts a new thread, which is what the
// screen's "New chat" does.
func (s *Service) Chat(ctx context.Context, userID uuid.UUID, req ChatRequest) (*ChatResponse, error) {
	body := strings.TrimSpace(req.Message)
	if body == "" {
		return nil, ErrEmptyQuestion
	}
	if utf8.RuneCountInString(body) > MaxMessageChars {
		return nil, ErrQuestionLong
	}

	convo, err := s.openConversation(ctx, userID, req.ConversationID)
	if err != nil {
		return nil, err
	}

	studentTurn, err := s.store.AppendMessage(ctx, convo.ID, SenderUser, body, &userID, nil)
	if err != nil {
		return nil, err
	}

	// Step 2: a conversation already with a person never touches the model.
	if convo.Mode == ModeHuman {
		return &ChatResponse{
			ConversationID: convo.ID,
			Mode:           ModeHuman,
			Reply:          WaitingReply,
			Status:         StatusQueued,
			MessageID:      studentTurn.ID,
			Sources:        []string{},
			CreatedAt:      studentTurn.CreatedAt,
		}, nil
	}

	// Step 3: budget. Checked here, after the cheap local replies and before any
	// paid call.
	if err := s.guardRate(ctx, userID); err != nil {
		return nil, err
	}

	// Step 4a: an explicit request for a human always wins, whatever the
	// knowledge base could have said.
	if asksForHuman(body) {
		h, herr := s.handoff(ctx, userID, convo, reasonStudentAsked, body)
		if herr != nil {
			return nil, herr
		}
		return &ChatResponse{
			ConversationID: convo.ID,
			Mode:           ModeHuman,
			Reply:          h.Reply,
			Status:         StatusHandoff,
			MessageID:      studentTurn.ID,
			Sources:        []string{},
			CreatedAt:      time.Now().UTC(),
		}, nil
	}

	// Step 4b: a personal case is deflected without a model call. No ticket is
	// opened yet — the student chooses, because "why is my payment missing" is
	// not automatically a support request they want filed.
	if isPersonSpecific(body) {
		return s.replyLocal(ctx, convo, studentTurn, PersonalCaseReply, true, StatusDeflect)
	}

	// Step 5: retrieval over published entries only.
	candidates, err := s.store.PublishedFaqs(ctx)
	if err != nil {
		return nil, err
	}
	got, err := rank(candidates, body)
	if errors.Is(err, ErrNoEvidence) {
		return s.replyLocal(ctx, convo, studentTurn, FallbackReply, true, StatusFallback)
	}
	if err != nil {
		return nil, err
	}

	// Step 6: the model. Only the redacted current turn and the approved text.
	answer, gerr := s.llm.Generate(ctx, ReplyRequest{
		SystemPrompt: SystemPrompt(),
		FaqContext:   got.Faqs,
		Question:     redactPII(body),
	})
	if gerr != nil && !errors.Is(gerr, ErrGeminiUnavailable) && !errors.Is(gerr, ErrNoEvidence) {
		// Log the class of failure, never the question: a student's text may
		// carry the identifier they pasted before redaction mangled it.
		log.Printf("academy assistant: provider error (%T) — degrading to approved FAQ text", gerr)
	}
	status := StatusAnswered
	offer := false
	if gerr != nil || strings.TrimSpace(answer) == "" {
		// The honest fallback with the approved answer attached is more useful
		// than either alone, and says nothing the academy has not already said.
		answer = OutageReply + "\n\n" + strings.TrimSpace(got.Faqs[0].Answer)
		status = StatusFallback
		offer = true
	} else if hasUnapprovedPlaceholder(answer) {
		// A model that repeats a placeholder it was not given has invented it.
		// Trust only the approved text.
		log.Printf("academy assistant: generated answer carried a draft marker — replaced, category=%s", got.Reason)
		answer = strings.TrimSpace(got.Faqs[0].Answer)
		status = StatusFallback
		offer = true
	}

	assistantTurn, err := s.store.AppendMessage(ctx, convo.ID, SenderAssistant, answer, nil, parseIDs(got.Sources))
	if err != nil {
		return nil, err
	}
	return &ChatResponse{
		ConversationID: convo.ID,
		Mode:           convo.Mode,
		Reply:          answer,
		Status:         status,
		OfferHandoff:   offer,
		Fallback:       status != StatusAnswered,
		MessageID:      assistantTurn.ID,
		Sources:        got.Sources,
		CreatedAt:      assistantTurn.CreatedAt,
	}, nil
}

// replyLocal stores an assistant turn produced without the model — the fallback,
// the deflection. It is still a real answer in the transcript, so a staff member
// reading the thread later sees that the assistant gave up at this point.
func (s *Service) replyLocal(ctx context.Context, convo Conversation, studentTurn Message,
	text string, offer bool, status string) (*ChatResponse, error) {

	msg, err := s.store.AppendMessage(ctx, convo.ID, SenderAssistant, text, nil, nil)
	if err != nil {
		return nil, err
	}
	return &ChatResponse{
		ConversationID: convo.ID,
		Mode:           convo.Mode,
		Reply:          text,
		Status:         status,
		OfferHandoff:   offer,
		Fallback:       true,
		MessageID:      msg.ID,
		Sources:        []string{},
		CreatedAt:      msg.CreatedAt,
	}, nil
}

// openConversation resolves the thread to use: the caller's own existing one, or
// a new one when the client omitted the id. A conversation belonging to someone
// else is ErrNotFound, never ErrForbidden — the assistant does not confirm that
// another student's thread id exists.
func (s *Service) openConversation(ctx context.Context, userID uuid.UUID, rawID *string) (Conversation, error) {
	if rawID == nil || strings.TrimSpace(*rawID) == "" {
		return s.store.CreateConversation(ctx, userID)
	}
	id, err := uuid.Parse(strings.TrimSpace(*rawID))
	if err != nil {
		return Conversation{}, ErrBadInput
	}
	convo, err := s.store.GetConversation(ctx, id, userID)
	if err != nil {
		return Conversation{}, err
	}
	return convo, nil
}

// --- handoff -----------------------------------------------------------------

// Reasons a conversation reaches a person. They land on the ticket so the queue
// can be triaged without reading every thread.
const (
	reasonStudentAsked  = "student asked to speak to someone"
	reasonFlaggedAnswer = "student said an answer was wrong"
)

// Handoff escalates the conversation the student is in.
func (s *Service) Handoff(ctx context.Context, userID uuid.UUID, req HandoffRequest) (*HandoffResponse, error) {
	convo, err := s.store.GetConversation(ctx, req.ConversationID, userID)
	if err != nil {
		return nil, err
	}
	question := req.Reason
	if strings.TrimSpace(question) == "" {
		question = reasonStudentAsked
	}
	return s.handoff(ctx, userID, convo, question, s.latestStudentQuestion(ctx, convo.ID, userID))
}

// handoff is the single path into a ticket, so a student asking, a flagged answer
// and a no-match fallback all produce the same shape of record.
//
// It is idempotent per conversation: escalating a thread that already has a live
// ticket returns that ticket instead of filing a second one.
func (s *Service) handoff(ctx context.Context, userID uuid.UUID, convo Conversation,
	reason, question string) (*HandoffResponse, error) {

	ticket, err := s.store.TicketForConversation(ctx, convo.ID)
	switch {
	case err == nil:
		// A live ticket already exists. Make sure the thread reflects it.
		if convo.Mode != ModeHuman {
			if err := s.store.SetConversationMode(ctx, convo.ID, ModeHuman); err != nil {
				return nil, err
			}
		}
	case errors.Is(err, ErrNotFound):
		subject := truncateRunes(firstLine(question), 120)
		if subject == "" {
			subject = "Academy assistant enquiry"
		}
		// The reason goes on the ticket beside the student's words: "why was this
		// filed" and "what did they ask" are the two things an agent needs before
		// opening the thread.
		detail := reason + "\n\n" + question
		ticket, err = s.store.CreateTicket(ctx, convo.ID, userID, subject,
			ticketCategory(question), detail)
		if err != nil {
			return nil, err
		}
		if err := s.store.SetConversationMode(ctx, convo.ID, ModeHuman); err != nil {
			return nil, err
		}
		if _, err := s.store.AppendMessage(ctx, convo.ID, SenderSystem,
			fmt.Sprintf("Academy Support ticket %s opened. A member of the team will continue this chat.",
				ticket.TicketNumber), nil, nil); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}

	return &HandoffResponse{
		ConversationID: convo.ID,
		TicketID:       ticket.ID,
		TicketNumber:   ticket.TicketNumber,
		Mode:           ModeHuman,
		Reply:          HandoffReply,
		OfferHandoff:   false,
	}, nil
}

// ticketCategory keeps the queue filterable by the subject the academy actually
// staffs, using the same category detection the retriever runs.
func ticketCategory(question string) string {
	if cat := detectCategory(normalize(question)); cat != "" {
		return cat
	}
	return "general_enquiry"
}

// latestStudentQuestion is what the agent reads first in the queue. The unredacted
// text stays in the database; it is never sent anywhere off-server.
func (s *Service) latestStudentQuestion(ctx context.Context, conversationID, userID uuid.UUID) string {
	msgs, err := s.store.ListMessages(ctx, conversationID, userID, 40)
	if err != nil {
		return ""
	}
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Sender == SenderUser {
			return msgs[i].Body
		}
	}
	return ""
}

// Flag records that a student said an answer was wrong, and opens the ticket they
// did not have to ask for: a wrong answer about fees or dates is a support case
// and a knowledge-base defect at the same time.
func (s *Service) Flag(ctx context.Context, userID, conversationID uuid.UUID, req FeedbackRequest) (*HandoffResponse, error) {
	convo, err := s.store.GetConversation(ctx, conversationID, userID)
	if err != nil {
		return nil, err
	}
	// Owner-scoped lookup, so a message id from another student's thread is a 404.
	if _, err := s.store.ConversationIDForMessage(ctx, req.MessageID, userID); err != nil {
		return nil, err
	}
	msg, err := s.store.FlagMessage(ctx, req.MessageID, userID)
	if err != nil {
		return nil, err
	}
	if msg.ConversationID != convo.ID {
		// The message is real but belongs to a different one of this student's
		// threads; flagging across threads would open the wrong ticket.
		return nil, ErrNotFound
	}

	note := strings.TrimSpace(truncateRunes(req.Note, 500))
	question := note
	if question == "" {
		question = "The assistant answered: " + truncateRunes(msg.Body, 300)
	}
	return s.handoff(ctx, userID, convo, reasonFlaggedAnswer, question)
}

// --- read surfaces -----------------------------------------------------------

func (s *Service) Conversations(ctx context.Context, userID uuid.UUID, limit int) ([]Conversation, error) {
	return s.store.ListConversations(ctx, userID, limit)
}

// History returns the transcript of the caller's own conversation.
func (s *Service) History(ctx context.Context, userID, conversationID uuid.UUID, limit int) ([]Message, error) {
	if _, err := s.store.GetConversation(ctx, conversationID, userID); err != nil {
		return nil, err
	}
	return s.store.ListMessages(ctx, conversationID, userID, limit)
}

// Suggestions are opening questions taken from published entries only, so a topic
// that is not approved yet cannot be prompted into existence by the UI.
func (s *Service) Suggestions(ctx context.Context, limit int) ([]string, error) {
	candidates, err := s.store.PublishedFaqs(ctx)
	if err != nil {
		return nil, err
	}
	return suggestions(candidates, clampLimit(limit, 5, 10)), nil
}

// --- knowledge base (admin) --------------------------------------------------

func (s *Service) ListFaqs(ctx context.Context, q FaqListQuery) ([]Faq, int, error) {
	return s.store.ListFaqs(ctx, q)
}

func (s *Service) Faq(ctx context.Context, id uuid.UUID) (Faq, error) {
	return s.store.FaqByID(ctx, id)
}

func (s *Service) FaqCategories(ctx context.Context) ([]string, error) {
	return s.store.FaqCategories(ctx)
}

func (s *Service) CreateFaq(ctx context.Context, actor uuid.UUID, in FaqInput) (Faq, error) {
	in, err := normalizeFaqInput(in)
	if err != nil {
		return Faq{}, err
	}
	return s.store.CreateFaq(ctx, in, actor)
}

func (s *Service) UpdateFaq(ctx context.Context, id, actor uuid.UUID, in FaqInput) (Faq, error) {
	in, err := normalizeFaqInput(in)
	if err != nil {
		return Faq{}, err
	}
	// Confirm the row exists before the write so a deleted entry is a 404 rather
	// than a 500 from an UPDATE that matched nothing.
	if _, err := s.store.FaqByID(ctx, id); err != nil {
		return Faq{}, err
	}
	return s.store.UpdateFaq(ctx, id, in, actor)
}

// DeleteFaq retires an entry. It leaves the knowledge base for the very next
// answer, because retrieval re-reads published rows on every turn rather than
// caching them.
func (s *Service) DeleteFaq(ctx context.Context, id uuid.UUID) (Faq, error) {
	if _, err := s.store.FaqByID(ctx, id); err != nil {
		return Faq{}, err
	}
	return s.store.SoftDeleteFaq(ctx, id)
}

// normalizeFaqInput trims the fields and enforces the publish rule in Go, so an
// admin gets "this answer is not approved yet" against the field they were
// editing instead of a database constraint name. The CHECK on the table is the
// backstop, not the interface.
func normalizeFaqInput(in FaqInput) (FaqInput, error) {
	in.Category = strings.ToLower(strings.TrimSpace(in.Category))
	in.Question = strings.TrimSpace(in.Question)
	in.Answer = strings.TrimSpace(in.Answer)
	if in.Category == "" || in.Question == "" || in.Answer == "" {
		return in, ErrBadInput
	}
	if utf8.RuneCountInString(in.Question) > 500 || utf8.RuneCountInString(in.Answer) > 8000 {
		return in, ErrBadInput
	}
	if in.Published {
		if hasUnapprovedPlaceholder(in.Answer) || utf8.RuneCountInString(in.Answer) < 20 {
			return in, ErrNotPublishable
		}
	}
	return in, nil
}

// --- support queue (staff) ---------------------------------------------------

// Queue returns the ticket list and the badge counts in one call so the console
// cannot render a list that disagrees with its own header.
func (s *Service) Queue(ctx context.Context, q TicketListQuery) ([]Ticket, TicketSummary, error) {
	items, err := s.store.ListTickets(ctx, q)
	if err != nil {
		return nil, TicketSummary{}, err
	}
	sum, err := s.store.TicketSummary(ctx)
	if err != nil {
		return nil, TicketSummary{}, err
	}
	return items, sum, nil
}

// TicketDetail is the ticket plus the whole student thread behind it.
func (s *Service) TicketDetail(ctx context.Context, id uuid.UUID) (Ticket, []Message, error) {
	ticket, err := s.store.TicketByID(ctx, id)
	if err != nil {
		return Ticket{}, nil, err
	}
	if ticket.ConversationID == nil {
		return ticket, []Message{}, nil
	}
	msgs, err := s.store.ListMessagesForStaff(ctx, *ticket.ConversationID, 200)
	if err != nil {
		return Ticket{}, nil, err
	}
	return ticket, msgs, nil
}

// Reply posts an agent's message into the student's thread. The student sees it
// as an Academy Staff bubble; the ticket leaves "unanswered", and an open case is
// taken up as in_progress in the same statement.
func (s *Service) Reply(ctx context.Context, staff, ticketID uuid.UUID, body string) (Ticket, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return Ticket{}, ErrBadInput
	}
	if utf8.RuneCountInString(body) > 4000 {
		return Ticket{}, ErrBadInput
	}
	ticket, err := s.store.TicketByID(ctx, ticketID)
	if err != nil {
		return Ticket{}, err
	}
	if ticket.Status == TicketClosed {
		return Ticket{}, ErrClosedTicket
	}
	if ticket.ConversationID != nil {
		if _, err := s.store.AppendMessage(ctx, *ticket.ConversationID, SenderStaff, body, &staff, nil); err != nil {
			return Ticket{}, err
		}
	}
	if err := s.store.MarkStaffReply(ctx, ticketID, staff); err != nil {
		if errors.Is(err, ErrNotFound) {
			// Closed between the read and the write.
			return Ticket{}, ErrConflict
		}
		return Ticket{}, err
	}
	return s.store.TicketByID(ctx, ticketID)
}

// MoveStatus applies the lifecycle. Closing returns the conversation to the
// assistant and says so in the thread, so a student is not left in a chat that
// nobody is watching.
func (s *Service) MoveStatus(ctx context.Context, staff, ticketID uuid.UUID, req StatusRequest) (Ticket, error) {
	ticket, err := s.store.TicketByID(ctx, ticketID)
	if err != nil {
		return Ticket{}, err
	}
	to := TicketStatus(strings.TrimSpace(string(req.Status)))
	if to != TicketOpen && to != TicketInProgress && to != TicketClosed {
		return Ticket{}, ErrBadInput
	}
	updated, err := s.store.SetTicketStatus(ctx, ticketID, ticket.Status, to,
		strings.TrimSpace(truncateRunes(req.ResolutionNotes, 2000)))
	if err != nil {
		return Ticket{}, err
	}

	if ticket.ConversationID != nil {
		note := fmt.Sprintf("Academy Support marked this as %s.", string(to))
		mode := ModeHuman
		if to == TicketClosed {
			mode = ModeBot
			note = "Academy Support closed this conversation. The assistant is available again here."
		}
		if err := s.store.SetConversationMode(ctx, *ticket.ConversationID, mode); err != nil {
			log.Printf("academy assistant: could not set conversation mode after status change: %v", err)
		}
		if _, err := s.store.AppendMessage(ctx, *ticket.ConversationID, SenderSystem, note, &staff, nil); err != nil {
			log.Printf("academy assistant: could not record status change in the thread: %v", err)
		}
	}
	return updated, nil
}

// --- budget ------------------------------------------------------------------

// guardRate is the per-student budget over Redis fixed windows:
//
//	academy:assistant:rl:<userID>:m:<unixMinute>  (TTL 70s)
//	academy:assistant:rl:<userID>:d:<unixDay>     (TTL 26h)
//
// The FIRST increment in a window sets the TTL. Exceeding either window returns
// ErrRateLimited (HTTP 429) and the model is never called. If Redis is nil or
// errors we FAIL OPEN and log: a limiter outage must not stop a student asking a
// question, and the budget exists to protect a quota, not to gate access.
func (s *Service) guardRate(ctx context.Context, userID uuid.UUID) error {
	rc := s.rc
	if rc == nil {
		return nil
	}
	now := time.Now().Unix()
	type window struct {
		key   string
		limit int
		ttl   time.Duration
	}
	id := userID.String()
	windows := []window{
		{key: rateKeyPrefix + id + ":m:" + fmtInt64(now/60), limit: s.ratePerMin, ttl: 70 * time.Second},
		{key: rateKeyPrefix + id + ":d:" + fmtInt64(now/86400), limit: s.ratePerDay, ttl: 26 * time.Hour},
	}
	for _, w := range windows {
		if w.limit <= 0 {
			continue // window disabled
		}
		n, err := rc.Incr(ctx, w.key).Result()
		if err != nil {
			log.Printf("academy assistant: rate guard INCR failed (%v) — failing open", err)
			return nil
		}
		if n == 1 {
			if err := rc.Expire(ctx, w.key, w.ttl).Err(); err != nil {
				log.Printf("academy assistant: rate guard EXPIRE failed (%v) — counter may not reset", err)
			}
		}
		if n > int64(w.limit) {
			return ErrRateLimited
		}
	}
	return nil
}

// --- small helpers -----------------------------------------------------------

func parseIDs(raw []string) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(raw))
	for _, r := range raw {
		if id, err := uuid.Parse(strings.TrimSpace(r)); err == nil {
			out = append(out, id)
		}
	}
	return out
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return s
}

func fmtInt64(v int64) string { return strconv.FormatInt(v, 10) }

// ParseUserID converts the mirrored auth subject into a uuid. Anything the token
// carries that is not a uuid is a 401, not a 500.
func ParseUserID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return uuid.Nil, ErrBadInput
	}
	return id, nil
}
