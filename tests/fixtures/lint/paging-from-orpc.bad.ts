export const paging = {
  initialPageParam: undefined,
  getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor,
};
