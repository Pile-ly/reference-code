import type { PilelyService } from "./types.js";

/** The four reserved service labels, checked at runtime wherever a service
 *  name decides a host. */
export const SERVICES: readonly PilelyService[] = [
  "simple-db",
  "simple-blob",
  "simple-group",
  "simple-email",
];
