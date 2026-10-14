import type { PilelyService } from "./types.js";

/** The three reserved service labels, checked at runtime wherever a service
 *  name decides a host. */
export const SERVICES: readonly PilelyService[] = [
  "simple-db",
  "simple-group",
  "simple-email",
];
