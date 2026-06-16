export const activeOnly = <T extends { isActive?: boolean; is_active?: boolean }>(items: T[]) =>
  items.filter((item) => item.isActive ?? item.is_active ?? true);
