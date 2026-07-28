// Paymax Connect — Networking CONTENT / FEED types (PRD §6.2 CN-*).
//
// Self-contained content slice for the professional feed. Reuses USE_MOCK /
// CONNECT_API_BASE from ../../constants/connect.constants and the shared axios
// `api` client. All fields are camelCase to match the backend {data:...} contract.
//
// INVARIANTS:
//  PN-3 Feed ranks by VERIFIED OUTCOMES, not raw engagement. We expose only a
//       boolean `verifiedOutcome` flag per post — never a raw ranking number.
//  PN-1 No public numeric trust/ranking score is ever surfaced to the UI.

export type ReactionType = 'like' | 'celebrate' | 'support' | 'insightful' | 'curious';

export interface PostAuthor {
  id: string;
  type: 'user' | 'companyPage';
  name: string;
  headline?: string;
  avatarUrl?: string;
}

// A ranked feed post (CN-02 detail / CN-01 compose output).
export interface FeedPost {
  id: string;
  author: PostAuthor;
  body: string;
  hashtags: string[];
  mediaRefs: string[];        // remote URIs
  createdAt: string;          // ISO
  reactionCount: number;
  commentCount: number;
  reshareCount: number;
  viewerReaction: ReactionType | null;
  // PN-3: whether this post carries a verified-outcome signal used in ranking.
  // A display flag ONLY — never a raw ranking score (PN-1).
  verifiedOutcome: boolean;
}

export interface PostComment {
  id: string;
  postId: string;
  author: PostAuthor;
  body: string;
  createdAt: string;          // ISO
  parentCommentId?: string | null;
}

export interface PostDetail {
  post: FeedPost;
  comments: PostComment[];
}

// Input for composing a post (CN-01).
export interface ComposePostInput {
  body: string;
  hashtags: string[];
  mediaRefs: string[];
}

export interface ReactionResult {
  ok: true;
  post: FeedPost;
}
