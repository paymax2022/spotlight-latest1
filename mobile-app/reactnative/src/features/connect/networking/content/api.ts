// Paymax Connect — Networking CONTENT / FEED API (PRD §6.2 CN-01/CN-02).
// Mock-first (USE_MOCK). Live path hits `${CONNECT_API_BASE}/networking/...`.
//
// Contract (camelCase, {data:...}):
//   GET  /networking/feed                     → FeedPost[]   (content feed, ranked PN-3)
//   POST /networking/posts   (Idempotency-Key)→ FeedPost     (compose, CN-01)
//   GET  /networking/posts/:id                → PostDetail   (CN-02)
//   POST /networking/posts/:id/reactions      → ReactionResult
//   POST /networking/posts/:id/comments       → PostComment
//
// The mock keeps mutable module-level state so reactions/comments are fully
// walkable offline (compose → detail → react → comment all persist in-session).

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../../constants/connect.constants';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  FeedPost,
  PostComment,
  PostDetail,
  ComposePostInput,
  ReactionResult,
  ReactionType,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const VIEWER: FeedPost['author'] = {
  id: 'me',
  type: 'user',
  name: 'You',
  headline: 'Product Engineer · Lagos',
};

// ── Mutable mock state (in-session persistence) ──────────────────────────────
const MOCK_POSTS: FeedPost[] = [
  {
    id: 'p1',
    author: { id: 'n1', type: 'user', name: 'Ifeoma Okoro', headline: 'Staff Engineer · Paystack' },
    body: 'Just wrapped a free Go workshop for 40 junior engineers. Mentoring compounds — teaching one cohort seeds the next. #Mentoring #Golang',
    hashtags: ['Mentoring', 'Golang'],
    mediaRefs: [],
    createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    reactionCount: 128,
    commentCount: 24,
    reshareCount: 9,
    viewerReaction: null,
    verifiedOutcome: true, // PN-3: mentorship-completed signal
  },
  {
    id: 'p2',
    author: { id: 'c1', type: 'companyPage', name: 'AgriPay', headline: 'Agri-fintech for West Africa' },
    body: 'We just crossed 1M farmers on the platform. Hiring backend + growth — verified applicants get fast-tracked. #Fintech #Hiring',
    hashtags: ['Fintech', 'Hiring'],
    mediaRefs: [],
    createdAt: new Date(Date.now() - 6 * 3600000).toISOString(),
    reactionCount: 342,
    commentCount: 57,
    reshareCount: 31,
    viewerReaction: 'celebrate',
    verifiedOutcome: true,
  },
  {
    id: 'p3',
    author: { id: 'n3', type: 'user', name: 'Aisha Bello', headline: 'Product Lead · Flutterwave' },
    body: 'Discovery tip: the best insight rarely comes from the loudest stakeholder. Go talk to the people who churned. #Product #Research',
    hashtags: ['Product', 'Research'],
    mediaRefs: [],
    createdAt: new Date(Date.now() - 26 * 3600000).toISOString(),
    reactionCount: 76,
    commentCount: 12,
    reshareCount: 4,
    viewerReaction: null,
    verifiedOutcome: false,
  },
];

const MOCK_COMMENTS: PostComment[] = [
  {
    id: 'cm1',
    postId: 'p1',
    author: { id: 'n4', type: 'user', name: 'Chidi Eze', headline: 'Data Scientist · Kuda' },
    body: 'This was genuinely useful — the section on context cancellation clicked for me.',
    createdAt: new Date(Date.now() - 90 * 60000).toISOString(),
    parentCommentId: null,
  },
  {
    id: 'cm2',
    postId: 'p2',
    author: { id: 'n2', type: 'user', name: 'David Mensah', headline: 'Founder · AgriPay' },
    body: 'Proud of the team. DM me for a referral.',
    createdAt: new Date(Date.now() - 4 * 3600000).toISOString(),
    parentCommentId: null,
  },
];

function findPost(id: string): FeedPost {
  return MOCK_POSTS.find((p) => p.id === id) ?? MOCK_POSTS[0];
}

// ── Feed (CN — ranked, PN-3) ─────────────────────────────────────────────────
export async function getContentFeed(): Promise<FeedPost[]> {
  if (USE_MOCK) {
    await delay();
    // PN-3: verified-outcome posts rank ahead of raw-engagement-only posts.
    return [...MOCK_POSTS]
      .sort((a, b) => Number(b.verifiedOutcome) - Number(a.verifiedOutcome))
      .map((p) => ({ ...p }));
  }
  // Content feed is namespaced under /posts to avoid colliding with the
  // people-discovery feed at /networking/feed (which returns profiles).
  const res = await api.get(`${CONNECT_API_BASE}/networking/posts/feed`);
  return unwrap<FeedPost[]>(res);
}

// ── Post detail (CN-02) ──────────────────────────────────────────────────────
export async function getPost(id: string): Promise<PostDetail> {
  if (USE_MOCK) {
    await delay(180);
    const post = { ...findPost(id) };
    const comments = MOCK_COMMENTS.filter((c) => c.postId === post.id).map((c) => ({ ...c }));
    return { post, comments };
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/posts/${id}`);
  return unwrap<PostDetail>(res);
}

// ── Compose (CN-01) — Idempotency-Key required ───────────────────────────────
export async function createPost(input: ComposePostInput): Promise<FeedPost> {
  if (USE_MOCK) {
    await delay(460);
    const post: FeedPost = {
      id: `p_${Date.now()}`,
      author: { ...VIEWER },
      body: input.body,
      hashtags: input.hashtags,
      mediaRefs: input.mediaRefs,
      createdAt: new Date().toISOString(),
      reactionCount: 0,
      commentCount: 0,
      reshareCount: 0,
      viewerReaction: null,
      verifiedOutcome: false,
    };
    MOCK_POSTS.unshift(post);
    return { ...post };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/posts`, input, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return unwrap<FeedPost>(res);
}

// ── React (CN-02) ────────────────────────────────────────────────────────────
export async function reactToPost(id: string, reaction: ReactionType): Promise<ReactionResult> {
  if (USE_MOCK) {
    await delay(160);
    const post = findPost(id);
    const had = post.viewerReaction;
    if (had === reaction) {
      // toggle off
      post.viewerReaction = null;
      post.reactionCount = Math.max(0, post.reactionCount - 1);
    } else {
      if (!had) post.reactionCount += 1;
      post.viewerReaction = reaction;
    }
    return { ok: true, post: { ...post } };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/posts/${id}/reactions`, { reaction });
  return unwrap<ReactionResult>(res);
}

// ── Comment (CN-02) ──────────────────────────────────────────────────────────
export async function commentOnPost(id: string, body: string): Promise<PostComment> {
  if (USE_MOCK) {
    await delay(220);
    const post = findPost(id);
    const comment: PostComment = {
      id: `cm_${Date.now()}`,
      postId: post.id,
      author: { ...VIEWER },
      body,
      createdAt: new Date().toISOString(),
      parentCommentId: null,
    };
    MOCK_COMMENTS.push(comment);
    post.commentCount += 1;
    return { ...comment };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/posts/${id}/comments`, { body });
  return unwrap<PostComment>(res);
}
