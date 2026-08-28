export type DistillationPageSize = 10 | 25 | 50;

export function distillationPageCount(
  total: number,
  size: DistillationPageSize,
): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

export function distillationPage<T>(
  items: readonly T[],
  requestedPage: number,
  size: DistillationPageSize,
): T[] {
  const page = Math.min(
    Math.max(1, Math.trunc(requestedPage)),
    distillationPageCount(items.length, size),
  );
  return items.slice((page - 1) * size, page * size);
}
