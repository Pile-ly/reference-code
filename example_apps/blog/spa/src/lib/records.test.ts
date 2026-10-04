import { describe, expect, it } from "vitest";
import {
  byUpdatedDesc,
  type CommentRecord,
  commentsFor,
  type LikeRecord,
  likedBy,
  likesFor,
} from "./records";

function stamp(id: string, created: number, updated = created, handle = "sam") {
  return {
    id,
    _submitter_handle: handle,
    _created_at_ms: created,
    _updated_at_ms: updated,
  };
}

const comments: CommentRecord[] = [
  { ...stamp("c3", 30), post_id: "p1", body: "third" },
  { ...stamp("c1", 10), post_id: "p1", body: "first" },
  { ...stamp("c2", 20), post_id: "p2", body: "other post" },
];

const likes: LikeRecord[] = [
  { ...stamp("l1", 1, 1, "sam"), post_id: "p1" },
  { ...stamp("l2", 2, 2, "lena"), post_id: "p1" },
  { ...stamp("l3", 3, 3, "sam"), post_id: "p2" },
];

describe("commentsFor", () => {
  it("keeps one post's comments, oldest first", () => {
    expect(commentsFor(comments, "p1").map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("answers an empty thread before the list loaded", () => {
    expect(commentsFor(undefined, "p1")).toEqual([]);
  });
});

describe("likes", () => {
  it("counts one post's likes", () => {
    expect(likesFor(likes, "p1")).toHaveLength(2);
  });

  it("dedupes by submitter handle", () => {
    expect(likedBy(likes, "p1", "lena")).toBe(true);
    expect(likedBy(likes, "p2", "lena")).toBe(false);
    expect(likedBy(likes, "p1", null)).toBe(false);
  });
});

describe("byUpdatedDesc", () => {
  it("orders by last edit, newest first, without mutating the input", () => {
    const rows = [stamp("a", 1, 5), stamp("b", 2, 9), stamp("c", 3, 7)];
    expect(byUpdatedDesc(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
