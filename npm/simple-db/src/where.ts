// `records/list`'s order and `where` semantics over values as a read returns
// them, shared by the optimistic cache (placing and dropping rows in a
// cached list) and the mock (answering a list). Pure functions: no types
// beyond the JS shape of each value, which is what a read answers.
//
// Order: `null` before every value, then `false` before `true`, numbers
// numerically, text by its UTF-8 bytes (a sort orders by the first 900).
// `where`: every key of one object is ANDed; a column key holds an operator
// object or a bare value (`eq`); `and` / `or` hold arrays, `not` one
// condition. A comparison on a `null` value never holds; `ne` and
// `is_null: true` do.

import type { DbWhere } from "./types.js";

/** The most UTF-8 bytes of a text a sort orders by. */
export const TEXT_SORT_BYTES = 900;

/** The operators `where` knows, in the service's order. */
export const WHERE_OPERATORS = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "between",
  "in",
  "begins_with",
  "contains",
  "is_null",
] as const;

export type WhereOperator = (typeof WHERE_OPERATORS)[number];

const encoder = new TextEncoder();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `a` against `b` by their UTF-8 bytes. */
export function compareBytes(a: string, b: string): number {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const length = Math.min(x.length, y.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** A text's first `TEXT_SORT_BYTES` UTF-8 bytes, cut on a character
 *  boundary: the part a sort orders it by. */
export function textSortPart(text: string): string {
  if (encoder.encode(text).length <= TEXT_SORT_BYTES) return text;
  let bytes = 0;
  let cut = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > TEXT_SORT_BYTES) break;
    bytes += size;
    cut += char.length;
  }
  return text.slice(0, cut);
}

/** A JSON value with its object keys sorted: two values are equal exactly
 *  when their canonical forms are. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Whether two read values are equal: numbers numerically, text exactly,
 *  json by its serialized form. */
export function sameReadValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object" && a !== null && b !== null) return canonical(a) === canonical(b);
  return a === b;
}

/** `a` against `b` when both are numbers or both text; `null` when they
 *  have no order. */
function order(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") return compareBytes(a, b);
  return null;
}

/** Where a value's kind stands in a sort: `null` first. */
function kindRank(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "string") return 3;
  return 4;
}

/** Two sorted values in ascending order: `null` before every value, `false`
 *  before `true`, numbers numerically, text by its first 900 bytes. */
export function compareSortValues(a: unknown, b: unknown): number {
  const rank = kindRank(a) - kindRank(b);
  if (rank !== 0) return rank < 0 ? -1 : 1;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  if (typeof a === "string" && typeof b === "string") return compareBytes(textSortPart(a), textSortPart(b));
  return order(a, b) ?? 0;
}

/** Two rows in a sort's ascending order: the sorted value, ties by `id`
 *  ascending. Descending is the exact mirror. */
export function compareSorted(a: unknown, aId: string, b: unknown, bId: string): number {
  const byValue = compareSortValues(a, b);
  if (byValue !== 0) return byValue;
  return aId === bId ? 0 : aId < bId ? -1 : 1;
}

/** Whether operator `op` with `operand` holds on read value `value`. An
 *  unknown operator never holds. */
export function operatorHolds(op: string, operand: unknown, value: unknown): boolean {
  const read = value === undefined ? null : value;
  if (read === null) {
    return op === "ne" || (op === "is_null" && operand === true);
  }
  const cmp = (x: unknown) => order(read, x);
  switch (op) {
    case "eq":
      return sameReadValue(read, operand);
    case "ne":
      return !sameReadValue(read, operand);
    case "lt":
      return cmp(operand) === -1;
    case "lte": {
      const c = cmp(operand);
      return c === -1 || c === 0;
    }
    case "gt":
      return cmp(operand) === 1;
    case "gte": {
      const c = cmp(operand);
      return c === 1 || c === 0;
    }
    case "between": {
      if (!Array.isArray(operand) || operand.length !== 2) return false;
      const low = cmp(operand[0]);
      const high = cmp(operand[1]);
      return (low === 1 || low === 0) && (high === -1 || high === 0);
    }
    case "in":
      return Array.isArray(operand) && operand.some((x) => sameReadValue(read, x));
    case "begins_with":
      return typeof read === "string" && typeof operand === "string" && read.startsWith(operand);
    case "contains":
      return typeof read === "string" && typeof operand === "string" && read.includes(operand);
    case "is_null":
      return operand === false;
    default:
      return false;
  }
}

/** Whether `where` holds on a row whose fields `read` answers as a read
 *  returns them (`null` for a field that reads null). */
export function whereHolds(where: DbWhere | Record<string, unknown>, read: (field: string) => unknown): boolean {
  if (!isObject(where)) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === "and" || key === "or") {
      if (!Array.isArray(value)) return false;
      const parts = value as unknown[];
      const holds = (part: unknown) => whereHolds(part as DbWhere, read);
      return key === "and" ? parts.every(holds) : parts.some(holds);
    }
    if (key === "not") return !whereHolds(value as DbWhere, read);
    const ops = isObject(value) ? value : { eq: value };
    return Object.entries(ops).every(([op, operand]) => operatorHolds(op, operand, read(key)));
  });
}
