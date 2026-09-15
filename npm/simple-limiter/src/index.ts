// @pilely/simple-limiter — a typed wrapper over the simple_limiter
// service's three POST routes. A policy is immutable: create, list and
// disable are the whole lifecycle — no update, no reset, no re-enable.
// See README.md for a worked example.

import { call, collectPages } from "@pilely/core";

import type { Policy, PolicyCursor, PolicyInput } from "./types.js";

export type {
  FixedWindowStrategy,
  Policy,
  PolicyCursor,
  PolicyInput,
  PolicyKey,
  PolicyMethod,
  PolicyStrategy,
  TokenBucketStrategy,
} from "./types.js";

export interface ListPoliciesOptions {
  limit?: number;
  after_created_at?: number;
  after_id?: string;
}

/** Create a rate-limit policy. Ownership of the target route is checked
 *  once, here: for a `<label>.pilely.app` host, the caller must own the
 *  pile registered under that label; for `simple-db.pilely.app`, the
 *  caller must own the pile whose id is the `<pile_id>` segment of
 *  `/apps/<pile_id>/**`. Capped at 50 active policies per owner — and,
 *  on the shared `simple-db.pilely.app` host, the host itself has its
 *  own active-policy cap every owner on it shares. */
export async function createPolicy(input: PolicyInput): Promise<Policy> {
  return call<Policy>({
    service: "simple-limiter",
    path: "/policies/create",
    body: input,
  });
}

/** The paged primitive — the caller's own policies, newest first,
 *  disabled rows included with their `disabled_at`. Use `listAllPolicies`
 *  to walk to the end. */
export async function listPolicies(
  options: ListPoliciesOptions = {},
): Promise<{ policies: Policy[]; next_cursor: PolicyCursor | null }> {
  return call<{ policies: Policy[]; next_cursor: PolicyCursor | null }>({
    service: "simple-limiter",
    path: "/policies/list",
    body: {
      limit: options.limit,
      after_created_at: options.after_created_at,
      after_id: options.after_id,
    },
  });
}

export async function listAllPolicies(): Promise<Policy[]> {
  return collectPages<Policy, PolicyCursor>(async (cursor) => {
    const page = await listPolicies({ limit: 100, ...(cursor ?? {}) });
    return { rows: page.policies, nextCursor: page.next_cursor };
  });
}

/** Disable a policy by its public id. The policy stops matching
 *  immediately; a second call on the same id is a 409. There is no
 *  re-enable — create a new policy instead. Unknown id and "not the
 *  owner" are the same 404. */
export async function disablePolicy(id: string): Promise<Policy> {
  return call<Policy>({
    service: "simple-limiter",
    path: `/policies/${id}/disable`,
    body: {},
  });
}
