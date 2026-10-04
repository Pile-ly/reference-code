import { usePilelyAuth } from "@pilely/core";
import { OWNER_HANDLE } from "../config";

/**
 * Is the signed-in visitor the host? UI gating only — simple_db enforces
 * the real permissions regardless. It also keeps the host portal's
 * edit/cancel/delete controls away from everyone else, whose optimistic
 * write would visibly roll back on the server's refusal.
 */
export function useIsOwner(): boolean {
  const { user } = usePilelyAuth();
  return user !== null && user.handle === OWNER_HANDLE;
}
