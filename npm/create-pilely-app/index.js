#!/usr/bin/env node
// Thin bin entry -- every real behavior lives in src/, starting from
// src/cli.js's run(). `npm create @pilely/pilely-app` (and the bare
// `create-pilely-app` bin) both execute this file directly.

import { run } from "./src/cli.js";

await run(process.argv);
