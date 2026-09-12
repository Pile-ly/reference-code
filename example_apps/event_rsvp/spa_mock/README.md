# Event RSVP interactive mock

This is a deliberately **API-free** companion to `../spa/`. It demonstrates
the guest and host experience using resettable in-memory fixtures, so it is
safe to click through offline and cannot create platform data.

- Select Maya or Leo to send RSVP changes. A guest sees only their own
  invitation workflow—never attendance totals or another guest's RSVP.
- Select Host and open the portal to see the latest-row-per-guest roll-up,
  create events, rename/cancel/delete them, and choose a cover emoji.
- **Reset fixtures** returns the entire mock to its initial state.

`spa/` remains the deployable Pilely reference implementation and is the
place for authentication, simple_db, simple_blob, and build/upload work.
This mock purposely imports neither a platform SDK nor networking APIs.

## Run locally

```bash
npm ci
npm run dev
```

## Verify

```bash
npm run typecheck
npm test
VITE_BASE=/reference-code/event-rsvp/ npm run build
```

The public-repository sync publishes the complete bundle; this repository has
no private demo publisher.
