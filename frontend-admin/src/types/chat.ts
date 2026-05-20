export type ChatSession = {
  id: string;
  pageContext: string;
  status: string;
  startedAt: string;
};

export type ChatMessage = {
  id: string;
  role: string;
  message_text?: string;
  text?: string;
  intent?: string;
  confidence?: number;
  created_at?: string;
  createdAt?: string;
};

export type ChatEvent = {
  id?: string;
  event_name?: string;
  event?: string;
  event_payload?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  created_at?: string;
  createdAt?: string;
};

export type ChatSessionDetail = {
  session?: ChatSession | null;
  messages: ChatMessage[];
  events: ChatEvent[];
};
