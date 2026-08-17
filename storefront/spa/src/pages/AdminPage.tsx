// The owner's inbox — the read side of the inbox recipe. A pure list, on
// purpose: no read/unread, no statuses, no reply UI. The collected email
// address is the follow-up channel; the gym replies from its own mail.
//
// Access is enforced twice, at different depths:
//  - here, as UI: a non-owner (or signed-out) visitor is routed back to
//    the landing page, and the nav never shows the link. Convenience only.
//  - in simple_db, as the actual rule: the `inquiries` read group is an
//    EMPTY group, so anyone else's records/list answers the uniform 404
//    no matter what this component does.
//
// `records/list` answers newest-first with a cursor, so paging is direct:
// first page on mount, "Load more" appends older rows until the cursor
// runs out.

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { classNameFor } from "../config";
import { timeAgo } from "../lib/time";
import { useInquiryStore } from "../stores/inquiry_store";
import { useSessionStore } from "../stores/session_store";

export function AdminPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { ready, isOwner } = useSessionStore();
  const { rows, nextCursor, loading, error, loadFirstPage, loadMore } = useInquiryStore();

  // Not the owner? Nothing to see here — back to the landing page. (The
  // data is safe either way; this is navigation, not protection.)
  useEffect(() => {
    if (ready && !isOwner) void navigate({ to: "/" });
  }, [ready, isOwner, navigate]);

  useEffect(() => {
    if (isOwner && rows === null) void loadFirstPage();
  }, [isOwner, rows, loadFirstPage]);

  if (!ready || !isOwner) return null;

  return (
    <div className="page">
      <h2 className="page-title">{t("admin.heading")}</h2>
      <p className="page-lead">{t("admin.lead")}</p>

      {loading && rows === null && (
        <p className="py-5 text-center text-[13px]" style={{ color: "var(--faint)" }}>
          {t("common.loading")}
        </p>
      )}
      {error && (
        <p className="py-5 text-center text-[13px]" style={{ color: "var(--accent)" }}>
          {t("common.error", { reason: error })}
        </p>
      )}
      {rows !== null && rows.length === 0 && (
        <p className="py-5 text-center text-[13px]" style={{ color: "var(--faint)" }}>
          {t("admin.empty")}
        </p>
      )}

      {(rows ?? []).map((inq) => (
        <div key={inq.id} className="border-t py-3.5" style={{ borderColor: "var(--hairline)" }}>
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]"
            style={{ color: "var(--muted)" }}
          >
            <b className="font-semibold" style={{ color: "var(--ink)" }}>
              {"@" + inq._submitter_handle}
            </b>
            <span>·</span>
            <span>{inq.email}</span>
            {inq.phone && (
              <>
                <span>·</span>
                <span>{inq.phone}</span>
              </>
            )}
            {inq.class && <span className="chip">{classNameFor(inq.class)}</span>}
            <span className="ml-auto">{timeAgo(inq._created_at_ms, Date.now(), i18n.language)}</span>
          </div>
          <div className="mt-1.5 text-[14px] leading-relaxed" style={{ color: "var(--ink)" }}>
            {inq.question}
          </div>
        </div>
      ))}

      {nextCursor && (
        <div className="flex justify-center pt-5">
          <button
            type="button"
            className="inquire-btn"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {t("admin.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
