// ── Association — Group chat type contract (I) ────────────────────────────────

export type ChatScope =
  | 'ORG'           // organisation-wide
  | 'CHAPTER'
  | 'STATE'
  | 'COMMITTEE'
  | 'EXECUTIVE'
  | 'EVENT'
  | 'TASK'
  | 'MEETING'
  | 'DIRECT'        // one-to-one
  | 'ANNOUNCEMENT'; // announcement-only (read-only feed)

/** Why a member can't post into a thread (null = can post). */
export type ChatPostingBlock =
  | 'ANNOUNCEMENT_ONLY'   // read-only channel
  | 'ROLE_RESTRICTED'     // exec-only etc.
  | 'PAYMENT_RESTRICTED'  // unpaid dues gate
  | 'ARCHIVED'
  | null;

export interface ChatThreadSummary {
  id:          string;
  title:       string;
  scope:       ChatScope;
  lastMessage: string;
  lastAt:      string;        // ISO
  unreadCount: number;
  muted:       boolean;
  memberCount: number;        // 0 for DIRECT
  postingBlock: ChatPostingBlock;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  mine:  boolean;
}

export interface ChatMessage {
  id:        string;
  threadId:  string;
  authorId:  string;
  authorName: string;
  authorRole: string | null;  // "Secretary" etc., shown in group chats
  body:      string;
  imageUrl:  string | null;   // attachment (image)
  createdAt: string;          // ISO
  mine:      boolean;
  system:    boolean;         // system/notice line, centered
  pinned:    boolean;
  reactions: MessageReaction[];
}

export interface ChatThread extends ChatThreadSummary {
  description: string | null;
  messages:    ChatMessage[];
}
