export type SortOrder = 'asc' | 'desc';

export interface AdminListQuery {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder: SortOrder;
}

export interface AdminListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sortBy?: string;
  sortOrder: SortOrder;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function parseAdminListQuery(
  searchParams: URLSearchParams,
  options?: {
    defaultPageSize?: number;
    maxPageSize?: number;
    defaultSortBy?: string;
    defaultSortOrder?: SortOrder;
  },
): AdminListQuery {
  const defaultPageSize = options?.defaultPageSize ?? 20;
  const maxPageSize = options?.maxPageSize ?? 100;
  const page = clamp(Number(searchParams.get('page') || 1) || 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clamp(
    Number(searchParams.get('pageSize') || defaultPageSize) || defaultPageSize,
    1,
    maxPageSize,
  );
  const sortBy = searchParams.get('sortBy') || options?.defaultSortBy;
  const sortOrder = (searchParams.get('sortOrder') || options?.defaultSortOrder || 'desc') as SortOrder;

  return {
    page,
    pageSize,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
  };
}

function compareValues(a: unknown, b: unknown) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);

  const aDate = typeof a === 'string' ? Date.parse(a) : NaN;
  const bDate = typeof b === 'string' ? Date.parse(b) : NaN;
  if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) return aDate - bDate;

  return String(a).localeCompare(String(b));
}

export function sortItems<T>(
  items: T[],
  query: Pick<AdminListQuery, 'sortBy' | 'sortOrder'>,
): T[] {
  if (!query.sortBy) return items;
  const key = query.sortBy;
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  return [...items].sort(
    (left, right) => compareValues((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]) * direction,
  );
}

export function paginateItems<T>(
  items: T[],
  query: Pick<AdminListQuery, 'page' | 'pageSize' | 'sortBy' | 'sortOrder'>,
): { items: T[]; meta: AdminListMeta } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const safePage = clamp(query.page, 1, totalPages);
  const start = (safePage - 1) * query.pageSize;
  const pagedItems = items.slice(start, start + query.pageSize);

  return {
    items: pagedItems,
    meta: {
      page: safePage,
      pageSize: query.pageSize,
      total,
      totalPages,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    },
  };
}
