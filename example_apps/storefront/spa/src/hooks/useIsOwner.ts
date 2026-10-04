import { usePilelyAuth } from "@pilely/core";
import { OWNER_HANDLE } from "../config";

/**
 * Is the signed-in visitor the storefront owner? UI gating only (the
 * Inquiries link, /admin) — simple_db enforces the real permission
 * regardless: the `inquiries` read group is empty, so anyone else's list
 * answers the uniform 404.
 */
export function useIsOwner(): boolean {
  const { user } = usePilelyAuth();
  return user !== null && user.handle === OWNER_HANDLE;
}
