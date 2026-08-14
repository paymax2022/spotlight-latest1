export type HandoffRow = {
  id: string;
  session_id?: string;
  sessionId?: string;
  handoff_type?: string;
  destination?: string;
  status?: string;
  requested_at?: string;
  resolved_at?: string | null;
};
