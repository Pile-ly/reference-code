import { test } from "node:test";
import assert from "node:assert/strict";

import { OPTION_SCHEMA } from "./schema.js";

const EXPECTED = {
  projectDir: { required: true, default: undefined },
  services: { required: true, default: undefined },
  signIn: { required: false, default: false },
  appId: { required: false, default: null },
  install: { required: false, default: true },
  json: { required: false, default: false },
  yes: { required: false, default: false },
  help: { required: false, default: false },
};

test("every one of the 8 option keys is present with the exact required/default values", () => {
  assert.equal(OPTION_SCHEMA.length, 8);
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const entry = OPTION_SCHEMA.find((o) => o.key === key);
    assert.ok(entry, `missing schema entry for "${key}"`);
    assert.equal(entry.required, expected.required, `${key}.required`);
    assert.equal(entry.default, expected.default, `${key}.default`);
  }
});

test("services is the only required flag option (projectDir is the only required positional)", () => {
  const requiredFlags = OPTION_SCHEMA.filter((o) => o.required && !o.positional);
  assert.equal(requiredFlags.length, 1);
  assert.equal(requiredFlags[0].key, "services");

  const requiredPositionals = OPTION_SCHEMA.filter((o) => o.required && o.positional);
  assert.equal(requiredPositionals.length, 1);
  assert.equal(requiredPositionals[0].key, "projectDir");
});
