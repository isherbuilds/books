import { useMemo } from "react";

/** The query state a line row reads. */
export type ListState<T> = { data?: T; isPending: boolean; isError: boolean; error: unknown };

/**
 * One object per change of the query's fields. A tracked `useQuery` result is a new
 * object on every render, so passing it to line rows re-renders every row of a line
 * grid on each append or remove.
 */
export function useListState<T>({ data, isPending, isError, error }: ListState<T>): ListState<T> {
  return useMemo(() => ({ data, isPending, isError, error }), [data, isPending, isError, error]);
}
