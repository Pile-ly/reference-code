// The editor, in three modes decided by the search params:
//   /write               → new post (Save draft · Publish)
//   /write?draft=<id>    → edit a draft (Save draft · Publish; publish
//                          creates the post THEN deletes the draft)
//   /write?post=<id>     → edit a PUBLISHED post (Update only — the owner
//                          may update any record; there is no draft twin)
//
// The ~16 KB cap is simple_db's per-record `fields` limit; the hint keeps
// it visible and the failure path reports it honestly instead of
// pretending the save happened.

import { useCreateRecord, useRecord, useUpdateRecord } from "@pilely/simple-db";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOwnerOnlyRoute } from "../hooks/useOwnerOnlyRoute";
import { usePublishDraft } from "../hooks/usePublishDraft";
import type { DraftRecord, PostFields, PostRecord } from "../lib/records";
import { useToastStore } from "../stores/toast_store";

interface Props {
  draftId?: string;
  postId?: string;
}

export function WritePage({ draftId, postId }: Props) {
  // UI-only guard, same as DraftsPage.
  const isOwner = useOwnerOnlyRoute();
  return isOwner ? <WriteSource draftId={draftId} postId={postId} /> : null;
}

/** Loads what is being edited (a post or a draft — an undefined id reads
 *  nothing), then hands it to the form as its starting value. */
function WriteSource({ draftId, postId }: Props) {
  const { t } = useTranslation();
  const postQuery = useRecord<PostRecord>("posts", postId);
  const draftQuery = useRecord<DraftRecord>("drafts", draftId);

  const loading =
    (postId !== undefined && postQuery.isPending) ||
    (draftId !== undefined && draftQuery.isPending);
  if (loading) {
    return (
      <p className="py-16 text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {t("common.loading")}
      </p>
    );
  }

  // A missing source (deleted, or the uniform 404) opens an empty form.
  const source = postId !== undefined ? postQuery.data : draftQuery.data;
  return <WriteForm draftId={draftId} postId={postId} initial={source} />;
}

function WriteForm({ draftId, postId, initial }: Props & { initial: PostFields | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createDraft = useCreateRecord<DraftRecord>("drafts");
  const updateDraft = useUpdateRecord<DraftRecord>("drafts");
  const updatePost = useUpdateRecord<PostRecord>("posts");
  const publishDraft = usePublishDraft();
  const show = useToastStore((s) => s.show);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [body, setBody] = useState(initial?.body_md ?? "");
  const [pending, setPending] = useState(false);

  const fields = (): PostFields => ({
    title: title.trim() || t("common.untitled"),
    subtitle: subtitle.trim(),
    body_md: body,
  });

  const run = async (fn: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    try {
      await fn();
    } catch (e) {
      show(t("editor.saveFailed", { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      setPending(false);
    }
  };

  const onSaveDraft = () =>
    run(async () => {
      if (draftId) {
        await updateDraft.mutateAsync({ id: draftId, patch: fields() });
      } else {
        await createDraft.mutateAsync(fields());
      }
      show(t("editor.draftSaved"));
      void navigate({ to: "/drafts" });
    });

  const onPublish = () =>
    run(async () => {
      if (postId) {
        await updatePost.mutateAsync({ id: postId, patch: fields() });
        show(t("editor.postUpdated"));
        void navigate({ to: "/post/$postId", params: { postId } });
      } else {
        const newId = await publishDraft(draftId ?? null, fields());
        show(t("editor.published"));
        void navigate({ to: "/post/$postId", params: { postId: newId } });
      }
    });

  return (
    <div className="mx-auto max-w-[640px] px-5 pb-15 pt-10 sm:px-7">
      <input
        className="w-full border-none bg-transparent text-[30px] font-bold outline-none"
        style={{ fontFamily: "var(--serif)", color: "var(--ink)" }}
        placeholder={t("editor.titlePlaceholder")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="mb-5 mt-1.5 w-full border-none bg-transparent text-[17px] outline-none"
        style={{ color: "var(--muted)" }}
        placeholder={t("editor.subtitlePlaceholder")}
        value={subtitle}
        onChange={(e) => setSubtitle(e.target.value)}
      />
      <textarea
        className="min-h-[260px] w-full resize-y border-t bg-transparent pt-5 text-[17px] leading-[1.7] outline-none"
        style={{
          fontFamily: "var(--serif)",
          borderColor: "var(--hairline)",
          color: "var(--ink)",
        }}
        placeholder={t("editor.bodyPlaceholder")}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
        <span className="mr-auto text-[12px]" style={{ color: "var(--faint)" }}>
          {t("editor.hint")}
        </span>
        {!postId && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => void onSaveDraft()}
          >
            {t("editor.saveDraft")}
          </button>
        )}
        <button
          type="button"
          className="btn btn-accent"
          disabled={pending}
          onClick={() => void onPublish()}
        >
          {postId ? t("editor.update") : t("editor.publish")}
        </button>
      </div>
    </div>
  );
}
