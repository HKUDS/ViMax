interface CursorPaginationOptions<TCursor> {
  cursor?: TCursor;
  limit: number;
}

interface CursorPaginationResult<TRow, TCursor> {
  items: TRow[];
  nextCursor: TCursor | null;
}

function paginateRows<TRow, TCursor>(
  rows: TRow[],
  options: CursorPaginationOptions<TCursor>,
  getCursor: (row: TRow) => TCursor,
): CursorPaginationResult<TRow, TCursor> {
  const startIndex =
    options.cursor === undefined
      ? 0
      : rows.findIndex((row) => getCursor(row) === options.cursor) + 1;
  const safeStartIndex = startIndex < 0 ? 0 : startIndex;
  const page = rows.slice(safeStartIndex, safeStartIndex + options.limit + 1);
  const hasMore = page.length > options.limit;
  const items = hasMore ? page.slice(0, options.limit) : page;

  return {
    items,
    nextCursor: hasMore ? getCursor(items[items.length - 1]!) : null,
  };
}

export function paginateConversations<TRow extends { id: string }>(
  rows: TRow[],
  options: CursorPaginationOptions<string>,
): CursorPaginationResult<TRow, string> {
  return paginateRows(rows, options, (row) => row.id);
}

export function paginateMessages<TRow extends { id: number }>(
  rows: TRow[],
  options: CursorPaginationOptions<number>,
): CursorPaginationResult<TRow, number> {
  return paginateRows(rows, options, (row) => row.id);
}
