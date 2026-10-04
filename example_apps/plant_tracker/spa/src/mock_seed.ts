// Sample content for mock mode (`npm run dev:mock`): the owner's plants, so
// the grid and every plant page have something on first load.
//
// `seedMock` applies once per origin and is a no-op outside mock mode; a
// production build carries none of this file's content. Rows are created
// as the mock user's, with server-minted ids and timestamps, so a seed row
// cannot reference another seed row's id: waterings start empty and are
// logged through the UI (the cards' one-tap Water, or a plant's Water now).
// Every plant has no photo (""), so each shows its generated portrait —
// blob bytes in mock mode live in memory only and could not survive a
// reload anyway.
//
// The fakes keep every record change in this origin's localStorage across
// reloads; clear the site's data and reload to start from this seed again.

import { seedMock } from "@pilely/core";
// Registers the simple_db fake before the seed below reaches it.
import "@pilely/simple-db";
import type { PlantFields } from "./lib/records";

/** Creation order — the order the grid shows them. */
const PLANTS: PlantFields[] = [
  { name: "Monstera", photo_blob_id: "" },
  { name: "Snake plant", photo_blob_id: "" },
  { name: "Golden pothos", photo_blob_id: "" },
  { name: "Aloe vera", photo_blob_id: "" },
  { name: "Fiddle-leaf fig", photo_blob_id: "" },
  { name: "Parlor palm", photo_blob_id: "" },
  { name: "Boston fern", photo_blob_id: "" },
  { name: "ZZ plant", photo_blob_id: "" },
];

seedMock({ tables: { plants: PLANTS } });
