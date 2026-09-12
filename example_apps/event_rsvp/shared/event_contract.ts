/**
 * Public event fields used by both the deployable RSVP app and its API-free
 * mock. Keep the mock inside this shape so it previews what hosts can create.
 */
export interface EventFields {
  title: string;
  starts_at_ms: number;
  tz: string;
  place: string;
  description: string;
  /** Empty when the host has not supplied a public cover photo. */
  cover_blob_id: string;
  canceled: boolean;
}
