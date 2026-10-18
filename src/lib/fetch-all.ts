/**
 * PostgREST returns at most 1000 rows per request and says nothing when it cuts
 * the rest off, so a long trade history silently loses its oldest P&L. Pages
 * through `range(from, to)` until a short page, and throws on any error instead
 * of treating it as "no rows". The query must have a stable order (e.g. by id).
 */
export const PAGE_SIZE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(
  range: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
