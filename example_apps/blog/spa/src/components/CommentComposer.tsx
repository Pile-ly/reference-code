// The comment box — or, signed out, the sign-in gate.
//
// The gate renders on `window.pilely.user() === null` and NOTHING else: on
// a public app the runtime holds an anonymous token for signed-out
// visitors, so a denied write would come back as a uniform 404, never a
// 401 — waiting for an error status to prompt sign-in is the classic bug
// this reference app exists to head off.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlogStore } from "../stores/blog_store";
import { useSessionStore } from "../stores/session_store";
import { useToastStore } from "../stores/toast_store";

export function CommentComposer({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const user = useSessionStore((s) => s.user);
  const signIn = useSessionStore((s) => s.signIn);
  const addComment = useBlogStore((s) => s.addComment);
  const show = useToastStore((s) => s.show);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  if (!user) {
    return (
      <div
        className="rounded-[10px] border border-dashed p-5 text-center"
        style={{ borderColor: "var(--hairline)" }}
      >
        <p className="mb-3 text-[13.5px]" style={{ color: "var(--muted)" }}>
          {t("post.gateLead")}
        </p>
        <button type="button" className="btn" onClick={signIn}>
          {t("nav.signIn")}
        </button>
      </div>
    );
  }

  const onSubmit = async () => {
    const text = body.trim();
    if (!text || pending) return;
    setPending(true);
    try {
      await addComment(postId, text);
      setBody("");
      show(t("post.commentAdded"));
    } catch (e) {
      show(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <textarea
        className="min-h-[70px] w-full resize-y rounded-[10px] border px-3.5 py-3 text-[14.5px] outline-none focus:border-[var(--ink)]"
        style={{ borderColor: "var(--hairline)", background: "var(--paper)", color: "var(--ink)" }}
        placeholder={t("post.composerPlaceholder", { handle: user.handle })}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          className="btn"
          disabled={pending || !body.trim()}
          onClick={() => void onSubmit()}
        >
          {t("post.postComment")}
        </button>
      </div>
    </div>
  );
}
