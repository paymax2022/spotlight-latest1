export type Analytics = {
  sessionsTotal: number;
  messagesTotal: number;
  leadsTotal: number;
  byPage: Record<string, number>;
  byIntent: Record<string, number>;
  leadsByType: Record<string, number>;
};
