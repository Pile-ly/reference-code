import { beforeEach, describe, expect, it } from "vitest";
import { addComment, deletePost, freshState, likePost, publish, saveDraft, setRole, updatePost } from "./model";

// The mock must never acquire an accidental platform/API dependency.
beforeEach(() => {
  globalThis.fetch = (() => { throw new Error("network use is forbidden in spa_mock tests"); }) as typeof fetch;
  globalThis.XMLHttpRequest = class { constructor() { throw new Error("network use is forbidden in spa_mock tests"); } } as unknown as typeof XMLHttpRequest;
});

describe("resettable blog mock", () => {
  it("resets independent public-reading fixtures", () => {
    const first = freshState(); first.posts[0].title = "changed";
    expect(freshState().posts[0].title).toBe("A small place for considered notes");
    expect(freshState().drafts).toHaveLength(1);
  });

  it("requires a mocked member login for comments and likes", () => {
    const publicState = freshState();
    expect(() => addComment(publicState, "welcome", "hello")).toThrow("Sign in");
    const member = setRole(publicState, "member");
    const commented = addComment(member, "welcome", "hello");
    const liked = likePost(commented, "welcome");
    expect(liked.posts[0].comments.at(-1)).toMatchObject({ author: "sam", body: "hello" });
    expect(liked.posts[0].likes).toContain("sam");
  });

  it("keeps owner drafts distinct from published posts", () => {
    const owner = setRole(freshState(), "owner");
    const saved = saveDraft(owner, { title: "Private", subtitle: "", body: "only in drafts" });
    expect(saved.posts.some((post) => post.title === "Private")).toBe(false);
    const privateDraft = saved.drafts[1];
    const published = publish(saved, privateDraft, privateDraft.id);
    expect(published.posts[0].title).toBe("Private");
    expect(published.drafts.some((draft) => draft.title === "Private")).toBe(false);
  });

  it("lets only the owner manage published posts", () => {
    const owner = setRole(freshState(), "owner");
    const edited = updatePost(owner, "welcome", { title: "Edited", subtitle: "", body: "New copy" });
    expect(edited.posts[0].title).toBe("Edited");
    const afterDelete = deletePost(edited, "welcome");
    expect(afterDelete.posts.some((post) => post.id === "welcome")).toBe(false);
    expect(afterDelete.posts).toHaveLength(edited.posts.length - 1);
  });
});
