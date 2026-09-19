# Plant tracker local mock

`spa_mock/` is a deliberately API-free, browser-only companion to the deployable
[`../spa/`](../spa/) reference. It demonstrates the same private-app interaction
shape—signed-out gate, one owner, no records for a non-owner, plants, watering
history, photo previews, delete cascades, and undo—without Pilely runtime code,
credentials, `fetch`, or `XMLHttpRequest`.

Use it for local UX review and tests only. Its fixture is in memory and resets
on refresh (and every test); it is not deployable and must not replace `spa/`.

```sh
npm ci
npm run typecheck
npm test
VITE_BASE=/reference-code/plant-tracker/ npm run build
```

The public-repository sync publishes the complete bundle; this repository has
no private demo publisher.
