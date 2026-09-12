// The owner's drafts. Drafts live in their OWN owner-only table (both
// access groups point at an empty group — the "only me" idiom), never as a
// flag on `posts`: a shared-read table exposes every record it holds, so a
// "draft" flag would leak unpublished writing to anyone who lists the
// table. The route guard here is UI-only; the empty group is what actually
// denies everyone else (as a uniform 404).

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { DraftRecord } from "../lib/db";
import { useBlogStore } from "../stores/blog_store";
import { useSessionStore } from "../stores/session_store";
import { useToastStore } from "../stores/toast_store";

export function DraftsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { ready, isOwner } = useSessionStore();
  const drafts = useBlogStore((s) => s.drafts);
  const loadDrafts = useBlogStore((s) => s.loadDrafts);
  const deleteDraft = useBlogStore((s) => s.deleteDraft);
  const publishDraft = useBlogStore((s) => s.publishDraft);
  const show = useToastStore((s) => s.show);

  // UI-only guard: a non-owner who lands here is sent home. (If they
  // somehow called the API anyway, the empty group answers 404.)
  useEffect(() => {
    if (ready && !isOwner) void navigate({ to: "/" });
  }, [ready, isOwner, navigate]);

  useEffect(() => {
    if (isOwner) void loadDrafts();
  }, [isOwner, loadDrafts]);

  if (!isOwner) return null;

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
      await deleteDraft(d.id);
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

      {drafts !== null && drafts.length === 0 && (
        <p className="py-6 text-[14px]" style={{ color: "var(--faint)" }}>
          {t("drafts.empty")}
        </p>
      )}
    </div>
  );
}
