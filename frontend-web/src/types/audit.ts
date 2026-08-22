export type AuditFilters = {
  limit?: number;
  actorUser?: string;
  targetUser?: string;
  module?: string;
  action?: string;
  severity?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  email?: string;
};

export type GenericRow = Record<string, unknown>;
