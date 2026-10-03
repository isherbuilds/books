// PostgreSQL binds at most 65,535 parameters per statement. 1,000 rows of the widest
// table written in bulk stay well under it.
const INSERT_CHUNK = 1_000;

/** Splits a multi-row insert into statements below PostgreSQL's bind limit. */
export function* insertChunks<T>(rows: readonly T[]): Generator<T[]> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK)
    yield rows.slice(start, start + INSERT_CHUNK);
}
