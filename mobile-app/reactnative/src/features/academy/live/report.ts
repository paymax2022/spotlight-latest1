// Request body for POST /moderation/report. The Go handler binds {entity_type, entity_id, reason};
// the app used to send targetKind/targetId, which that handler rejects (400), so a live report
// never reached a moderator.

export function buildReportBody(targetKind: string, targetId: string, reason: string): { entity_type: string; entity_id: string; reason: string } {
  if (!targetKind || !targetId || !reason) throw new Error('A report needs a target and a reason.');
  return { entity_type: targetKind, entity_id: targetId, reason };
}

/**
 * Chat messages exist only in the live room (they are not stored), so a report has to carry enough
 * to find the sender: the session, the sender's user id (their LiveKit identity) and the message id.
 */
export function liveMessageEntityId(sessionId: string, senderId: string, messageId: string): string {
  if (!sessionId || !senderId || !messageId) throw new Error('A report needs a session, a sender and a message.');
  return `${sessionId}/${senderId}/${messageId}`;
}
