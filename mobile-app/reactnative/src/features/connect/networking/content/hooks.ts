// Paymax Connect — Networking CONTENT React Query hooks (PRD §6.2 CN-*).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as contentApi from './api';
import type { ComposePostInput, ReactionType } from './types';

export const contentKeys = {
  all: ['connect', 'networking', 'content'] as const,
  feed: () => [...contentKeys.all, 'feed'] as const,
  post: (id: string) => [...contentKeys.all, 'post', id] as const,
};

export function useContentFeed() {
  return useQuery({ queryKey: contentKeys.feed(), queryFn: () => contentApi.getContentFeed() });
}

export function usePost(id: string) {
  return useQuery({ queryKey: contentKeys.post(id), queryFn: () => contentApi.getPost(id), enabled: !!id });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ComposePostInput) => contentApi.createPost(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentKeys.feed() }),
  });
}

export function useReactToPost(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reaction: ReactionType) => contentApi.reactToPost(postId, reaction),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contentKeys.post(postId) });
      qc.invalidateQueries({ queryKey: contentKeys.feed() });
    },
  });
}

export function useCommentOnPost(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => contentApi.commentOnPost(postId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentKeys.post(postId) }),
  });
}
