// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { PilelyError, PilelyProvider, resetMock, usePilelyAuth } from "@pilely/core";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useCreateRecord, useFileUrl, useRecords } from "./index.js";
import type { DbFile, DbRecord } from "./index.js";

interface Comment extends DbRecord {
  body: string | null;
}

interface Photo extends DbRecord {
  image: DbFile | null;
}

let globalFetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetMock();
  globalFetchSpy = vi.fn();
  vi.stubGlobal("fetch", globalFetchSpy);
});

afterEach(() => {
  cleanup();
  expect(globalFetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  resetMock();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function wrapper({ children }: { children: ReactNode }): ReactNode {
  return <PilelyProvider>{children}</PilelyProvider>;
}

describe("hooks against the mock runtime", () => {
  it("a signed-out comment is refused with the bare 404 and rolls back; an in-place sign-in refreshes and the write lands", async () => {
    const { result } = renderHook(
      () => ({
        auth: usePilelyAuth(),
        comments: useRecords<Comment>("comments"),
        add: useCreateRecord<Comment>("comments"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.comments.isSuccess).toBe(true));
    expect(result.current.auth.user).toBeNull();
    expect(result.current.comments.data).toEqual([]);

    await act(async () => {
      await result.current.add.mutateAsync({ body: "hi" }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.add.isError).toBe(true));
    expect(result.current.add.error).toBeInstanceOf(PilelyError);
    expect(result.current.add.error).toMatchObject({ status: 404, code: null });
    expect(result.current.comments.data).toEqual([]);

    await act(() => result.current.auth.signIn());
    expect(result.current.auth.user?.handle).toBe("mock_user");
    await act(() => result.current.add.mutateAsync({ body: "hi" }));
    await waitFor(() => expect(result.current.comments.data?.map((c) => c.body)).toEqual(["hi"]));
    expect(result.current.comments.data?.[0]?._submitter_handle).toBe("mock_user");

    act(() => result.current.auth.signOut());
    expect(result.current.auth.user).toBeNull();
    await waitFor(() => expect(result.current.comments.data?.map((c) => c.body)).toEqual(["hi"]));
  });

  it("a File in useCreateRecord uploads to the fake and attaches; useFileUrl answers its link; nothing reaches the network", async () => {
    const { result } = renderHook(
      () => ({
        auth: usePilelyAuth(),
        photos: useRecords<Photo>("photos", { fileUrls: true }),
        add: useCreateRecord<Photo>("photos"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.photos.isSuccess).toBe(true));
    await act(() => result.current.auth.signIn());

    const file = new File(["png!"], "cat.png", { type: "image/png" });
    const created = await act(() => result.current.add.mutateAsync({ image: file }));
    expect(created.image).toEqual({ file_id: expect.stringMatching(/^[A-Za-z0-9]{22}$/), content_type: "image/png", size_bytes: 4 });
    await waitFor(() => expect(result.current.photos.data?.[0]?.image?.url).toEqual(expect.any(String)));

    const { result: link } = renderHook(() => useFileUrl("photos", created.id, "image"), { wrapper });
    await waitFor(() => expect(link.current.data).toMatchObject({ content_type: "image/png", size_bytes: 4 }));
  });
});
