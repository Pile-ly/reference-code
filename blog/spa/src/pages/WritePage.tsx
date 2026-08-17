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

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlogStore } from "../stores/blog_store";
import { useSessionStore } from "../stores/session_store";
import { useToastStore } from "../stores/toast_store";

interface Props {
  draftId?: string;
  postId?: string;
}

export function WritePage({ draftId, postId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { ready, isOwner } = useSessionStore();
  const loadDrafts = useBlogStore((s) => s.loadDrafts);
  const ensurePost = useBlogStore((s) => s.ensurePost);
  const saveDraft = useBlogStore((s) => s.saveDraft);
  const publishDraft = useBlogStore((s) => s.publishDraft);
  const updatePost = useBlogStore((s) => s.updatePost);
  const show = useToastStore((s) => s.show);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [pending, setPending] = useState(false);

  // UI-only guard, same as DraftsPage.
  useEffect(() => {
    if (ready && !isOwner) void navigate({ to: "/" });
  }, [ready, isOwner, navigate]);

  // Seed the form from what's being edited, once.
  useEffect(() => {
    let cancelled = false;
    setSourceLoaded(false);
    void (async () => {
      if (postId) {
        const p = await ensurePost(postId);
        if (cancelled) return;
        if (p) {
          setTitle(p.title);
          setSubtitle(p.subtitle);
          setBody(p.body_md);
        }
      } else if (draftId) {
        await loadDrafts();
        if (cancelled) return;
        const d = useBlogStore.getState().drafts?.find((x) => x.id === draftId);
        if (d) {
          setTitle(d.title);
          setSubtitle(d.subtitle);
          setBody(d.body_md);
        }
      }
      setSourceLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, postId, ensurePost, loadDrafts]);

  if (!isOwner) return null;
  if (!sourceLoaded) {
    return (
      <p className="py-16 text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {t("common.loading")}
      </p>
    );
  }

  const fields = () => ({
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
      await saveDraft(draftId ?? null, fields());
      show(t("editor.draftSaved"));
      void navigate({ to: "/drafts" });
    });

  const onPublish = () =>
    run(async () => {
      if (postId) {
        await updatePost(postId, fields());
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
