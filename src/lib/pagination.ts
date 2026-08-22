export const PAGE_SIZE = 60;

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function pageSlice<T>(items: readonly T[], page: number, size = PAGE_SIZE): T[] {
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}

/** Page 1 lives at /browse/, the rest at /browse/2/ — no /browse/1/ duplicate. */
export function browseHref(page: number): string {
  return page <= 1 ? '/browse/' : `/browse/${page}/`;
}
