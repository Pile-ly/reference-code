// The comment box — or, signed out, the sign-in gate.
//
// The gate renders on `usePilelyAuth().user === null` and NOTHING else: on
// a public app the runtime holds an anonymous token for signed-out
// visitors, so a denied write would come back as a uniform 404, never a
// 401 — waiting for an error status to prompt sign-in is the classic bug
// this reference app exists to head off.
//
// The create is optimistic: the comment shows in the thread at once and
// rolls back if the server refuses it, in which case the refusal renders
// under the box.

import { usePilelyAuth } from "@pilely/core";
import { useCreateRecord } from "@pilely/simple-db";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommentRecord } from "../lib/records";
import { useToastStore } from "../stores/toast_store";

export function CommentComposer({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const { user, signIn } = usePilelyAuth();
  const createComment = useCreateRecord<CommentRecord>("comments");
  const show = useToastStore((s) => s.show);
  const [body, setBody] = useState("");

  if (!user) {
    return (
      <div
        className="rounded-[10px] border border-dashed p-5 text-center"
        style={{ borderColor: "var(--hairline)" }}
      >
        <p className="mb-3 text-[13.5px]" style={{ color: "var(--muted)" }}>
          {t("post.gateLead")}
        </p>
        <button type="button" className="btn" onClick={() => void signIn()}>
          {t("nav.signIn")}
        </button>
      </div>
    );
  }

  const onSubmit = async () => {
    const text = body.trim();
    if (!text || createComment.isPending) return;
    try {
      await createComment.mutateAsync({ post_id: postId, body: text });
      setBody("");
      show(t("post.commentAdded"));
    } catch {
      // The refusal stays in createComment.error and renders below.
    }
  };

  return (
    <div>
      <textarea
        className="min-h-[70px] w-full resize-y rounded-[10px] border px-3.5 py-3 text-[14.5px] outline-none focus:border-[var(--ink)]"
        style={{ borderColor: "var(--hairline)", background: "var(--paper)", color: "var(--ink)" }}
        placeholder={t("post.composerPlaceholder", { handle: user.handle ?? "" })}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {createComment.error && (
        <p role="alert" className="mt-2 text-[13px]" style={{ color: "var(--accent)" }}>
          {t("post.commentRefused", { reason: createComment.error.message })}
        </p>
      )}
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          className="btn"
          disabled={createComment.isPending || !body.trim()}
          onClick={() => void onSubmit()}
        >
          {t("post.postComment")}
        </button>
      </div>
    </div>
  );
}
