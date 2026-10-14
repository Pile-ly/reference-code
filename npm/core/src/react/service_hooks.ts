// The plumbing every `@pilely` service package builds its hooks on: the
// `["pilely", <service>, ...]` key root, the ready gate and the retry rule.
// Apps use the service packages' hooks, not these.

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import type {
  InfiniteData,
  QueryKey,
  UseInfiniteQueryOptions,
  UseInfiniteQueryResult,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";

import { PilelyError } from "../error.js";
import type { PilelyService } from "../types.js";
import { useServiceContext } from "./context.js";

/** The first element of every `@pilely` query key. */
export const PILELY_QUERY_ROOT = "pilely";

/** `["pilely", service, ...parts]` — the key layout every service hook
 *  uses, so `invalidateQueries({ queryKey: serviceQueryKey(service) })`
 *  reaches every query of one service. */
export function serviceQueryKey(service: PilelyService, ...parts: unknown[]): QueryKey {
  return [PILELY_QUERY_ROOT, service, ...parts];
}

const DEFAULT_RETRIES = 3;

/**
 * The retry rule every `@pilely` query carries itself, so it holds under an
 * app-supplied `QueryClient` too. A `PilelyError` with a 4xx status is
 * never retried: a 404 is a uniform denial, not a blip. With no runtime
 * loaded nothing is retried — every attempt fails the same way. Anything
 * else (5xx, network) gets TanStack's default three retries.
 */
export function serviceRetry(loaded: boolean): (failureCount: number, error: Error) => boolean {
  return (failureCount, error) => {
    if (error instanceof PilelyError && error.status >= 400 && error.status < 500) {
      return false;
    }
    if (!loaded) {
      return false;
    }
    return failureCount < DEFAULT_RETRIES;
  };
}

export type ServiceQueryOptions<TQueryFnData, TData> = Omit<
  UseQueryOptions<TQueryFnData, Error, TData, QueryKey>,
  "retry" | "enabled"
> & {
  /** `false` disables the query on top of the ready gate (an `undefined`
   *  key argument, for instance). */
  enabled?: boolean;
};

/** `useQuery` behind the ready gate, with the `@pilely` retry rule. */
export function useServiceQuery<TQueryFnData, TData = TQueryFnData>(
  hookName: string,
  options: ServiceQueryOptions<TQueryFnData, TData>,
): UseQueryResult<TData, Error> {
  const context = useServiceContext(hookName);
  return useQuery<TQueryFnData, Error, TData, QueryKey>(
    {
      ...options,
      enabled: context.ready && (options.enabled ?? true),
      retry: serviceRetry(context.loaded),
    },
    context.queryClient,
  );
}

/** One page of a cursor-paged listing, reduced to its rows and next cursor. */
export interface ServicePage<TRow, TCursor> {
  rows: TRow[];
  nextCursor: TCursor | null;
}

export interface ServiceInfiniteQueryOptions<TRow, TCursor> {
  queryKey: QueryKey;
  /** Fetches one page; `cursor` is `null` for the first. */
  fetchPage: (cursor: TCursor | null) => Promise<ServicePage<TRow, TCursor>>;
  enabled?: boolean;
}

function flattenRows<TRow, TCursor>(data: InfiniteData<ServicePage<TRow, TCursor>, TCursor | null>): TRow[] {
  return data.pages.flatMap((page) => page.rows);
}

/**
 * `useInfiniteQuery` over a cursor-paged listing, behind the ready gate,
 * with the `@pilely` retry rule. `data` is every loaded row, flattened;
 * `hasNextPage` / `fetchNextPage` walk the cursor.
 */
export function useServiceInfiniteQuery<TRow, TCursor>(
  hookName: string,
  options: ServiceInfiniteQueryOptions<TRow, TCursor>,
): UseInfiniteQueryResult<TRow[], Error> {
  const context = useServiceContext(hookName);
  const { fetchPage } = options;
  const queryOptions: UseInfiniteQueryOptions<
    ServicePage<TRow, TCursor>,
    Error,
    TRow[],
    QueryKey,
    TCursor | null
  > = {
    queryKey: options.queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam as TCursor | null),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    select: flattenRows,
    enabled: context.ready && (options.enabled ?? true),
    retry: serviceRetry(context.loaded),
  };
  return useInfiniteQuery(queryOptions, context.queryClient);
}

export interface ServiceMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** The query keys this write can change; each is invalidated (prefix
   *  match) once the server accepted the write. */
  invalidates: (data: TData, variables: TVariables) => QueryKey[];
}

/**
 * A non-optimistic write: nothing in the cache changes until the server
 * answers; on success every key `invalidates` names is invalidated, and the
 * mutation stays pending until the queries on screen have refetched.
 */
export function useServiceMutation<TData, TVariables = void>(
  hookName: string,
  options: ServiceMutationOptions<TData, TVariables>,
): UseMutationResult<TData, Error, TVariables> {
  const context = useServiceContext(hookName);
  const { queryClient } = context;
  return useMutation<TData, Error, TVariables>(
    {
      mutationFn: options.mutationFn,
      onSuccess: async (data, variables) => {
        await Promise.all(
          options.invalidates(data, variables).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        );
      },
    },
    queryClient,
  );
}
