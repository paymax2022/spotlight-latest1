// ── Association — AI note-taking type contract (L) ────────────────────────────
// AI assists, humans approve. Minutes are not final until approved (PRD §17.5).
// IRON RULE: monetary amounts are integers in minor units (kobo).

export type AiNoteSource = 'RECORD' | 'AUDIO' | 'VIDEO' | 'TRANSCRIPT';

export type AiNoteStatus =
  | 'PROCESSING'   // transcription/extraction running
  | 'READY'        // AI output ready for human review
  | 'APPROVED'     // secretary/chair approved (not yet published)
  | 'PUBLISHED'    // minutes published to members
  | 'FAILED';

export interface AiNoteSummary {
  id:           string;
  meetingTitle: string;
  status:       AiNoteStatus;
  source:       AiNoteSource;
  createdAt:    string;        // ISO
  durationLabel: string;       // "1h 12m"
}

export interface AiDecision { id: string; text: string }

export interface AiActionItem {
  id:        string;
  title:     string;
  owner:     string;
  dueLabel:  string;           // "in 7 days" / "no date"
  convertedTaskId: string | null;
}

export interface AiFinancialCommitment {
  id:        string;
  label:     string;
  amountKobo: number;
}

export interface AiAttendee { id: string; name: string; present: boolean }

export interface AiNote extends AiNoteSummary {
  summary:      string;        // editable executive summary
  minutes:      string;        // full minutes (markdown-ish plain text)
  /** All collections are optional: a PROCESSING note carries none of them. */
  decisions?:   AiDecision[];
  actionItems?: AiActionItem[];
  unresolved?:  string[];
  financialCommitments?: AiFinancialCommitment[];
  attendees?:   AiAttendee[];
  transcriptPreview?: string;
  meetingId:    string | null;
}

export interface CreateAiNoteInput {
  source:       AiNoteSource;
  meetingTitle: string;
  meetingId?:   string | null;
}
