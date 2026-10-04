// The owner's drafts. Drafts live in their OWN owner-only table (both
// access groups point at an empty group — the "only me" idiom), never as a
// flag on `posts`: a shared-read table exposes every record it holds, so a
// "draft" flag would leak unpublished writing to anyone who lists the
// table. The route guard here is UI-only; the empty group is what actually
// denies everyone else (as a uniform 404).
//
// Publishing is two writes in order — create the post, THEN delete the
// draft — so failing halfway leaves the draft intact (a duplicate is
// recoverable; a lost draft is not). `usePublishDraft` holds that order.

import { useDeleteRecord } from "@pilely/simple-db";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useDrafts } from "../hooks/useBlogRecords";
import { useOwnerOnlyRoute } from "../hooks/useOwnerOnlyRoute";
import { usePublishDraft } from "../hooks/usePublishDraft";
import { byUpdatedDesc, type DraftRecord } from "../lib/records";
import { useToastStore } from "../stores/toast_store";

export function DraftsPage() {
  // UI-only guard: a non-owner who lands here is sent home. (If they
  // somehow called the API anyway, the empty group answers 404.)
  const isOwner = useOwnerOnlyRoute();
  return isOwner ? <DraftsList /> : null;
}

/** Mounted for the owner only, so only the owner reads `drafts`. */
function DraftsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const draftsQuery = useDrafts();
  const deleteDraft = useDeleteRecord("drafts");
  const publishDraft = usePublishDraft();
  const show = useToastStore((s) => s.show);

  // The service lists newest-created first; drafts read best by last edit.
  const drafts = draftsQuery.data ? byUpdatedDesc(draftsQuery.data) : undefined;

  const onPublish = async (d: DraftRecord) => {
    try {
      const postId = await publishDraft(d.id, {
        title: d.title,
        subtitle: d.subtitle,
        body_md: d.body_md,
      });
      show(t("editor.published"));
      void navigate({ to: "/post/$postId", params: { postId } });
    } catch (e) {
      show(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  const onDelete = async (d: DraftRecord) => {
    if (!window.confirm(t("drafts.confirmDelete"))) return;
    try {
      await deleteDraft.mutateAsync(d.id);
    } catch (e) {
      show(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="mx-auto max-w-[640px] px-5 pb-15 pt-10 sm:px-7">
      <h2 className="text-[24px] font-bold" style={{ fontFamily: "var(--serif)" }}>
        {t("drafts.heading")}
      </h2>
      <p className="mb-2.5 mt-2 text-[13.5px]" style={{ color: "var(--faint)" }}>
        {t("drafts.sub")}
      </p>

      {(drafts ?? []).map((d) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center gap-3 border-t py-4.5"
          style={{ borderColor: "var(--hairline)" }}
        >
          <div className="min-w-0">
            <div
              className="truncate text-[17px] font-bold"
              style={{ fontFamily: "var(--serif)" }}
            >
              {d.title || t("common.untitled")}
            </div>
            <div className="mt-0.5 truncate text-[13px]" style={{ color: "var(--faint)" }}>
              {d.subtitle || t("drafts.noSubtitle")}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="mini-btn"
              onClick={() => void navigate({ to: "/write", search: { draft: d.id } })}
            >
              {t("drafts.edit")}
            </button>
            <button type="button" className="mini-btn" onClick={() => void onPublish(d)}>
              {t("drafts.publish")}
            </button>
            <button
              type="button"
              className="mini-btn mini-btn-danger"
              onClick={() => void onDelete(d)}
            >
              {t("drafts.delete")}
            </button>
          </div>
        </div>
      ))}

      {draftsQuery.error && (
        <p role="alert" className="py-6 text-[14px]" style={{ color: "var(--accent)" }}>
          {t("common.error", { reason: draftsQuery.error.message })}
        </p>
      )}

      {drafts !== undefined && drafts.length === 0 && (
        <p className="py-6 text-[14px]" style={{ color: "var(--faint)" }}>
          {t("drafts.empty")}
        </p>
      )}

      {draftsQuery.hasNextPage && (
        <button
          type="button"
          className="mini-btn mt-4"
          disabled={draftsQuery.isFetchingNextPage}
          onClick={() => void draftsQuery.fetchNextPage()}
        >
          {t("drafts.more")}
        </button>
      )}
    </div>
  );
}
