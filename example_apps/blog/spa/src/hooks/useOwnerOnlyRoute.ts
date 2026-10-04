import { usePilelyAuth } from "@pilely/core";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useIsOwner } from "./useIsOwner";

/**
 * UI-only guard for an owner screen: once auth is ready, anyone but the
 * owner is sent home. Answers whether the owner's view may render.
 */
export function useOwnerOnlyRoute(): boolean {
  const { ready } = usePilelyAuth();
  const isOwner = useIsOwner();
  const navigate = useNavigate();
  useEffect(() => {
    if (ready && !isOwner) void navigate({ to: "/" });
  }, [ready, isOwner, navigate]);
  return isOwner;
}
