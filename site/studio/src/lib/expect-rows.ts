// boringco's worst bug class: an update that matched nothing and still reported success.
export function expectOne<T>(rows: readonly T[], what: string): T {
  if (rows.length !== 1) throw new Error(`${what}: expected 1 row, got ${rows.length}`);
  return rows[0] as T;
}
