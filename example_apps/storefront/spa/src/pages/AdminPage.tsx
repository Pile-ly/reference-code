// The owner's inbox — the read side of the inbox recipe. A pure list, on
// purpose: no read/unread, no statuses, no reply UI. The collected email
// address is the follow-up channel; the gym replies from its own mail.
//
// Access is enforced twice, at different depths:
//  - here, as UI: a non-owner (or signed-out) visitor is routed back to the
//    landing page, and the nav never shows the link. Convenience only.
//  - in simple_db, as the actual rule: the `inquiries` read group is an EMPTY
//    group, so anyone else's records/list answers the uniform 404 no matter
//    what this component does.
//
// `records/list` answers newest-first with a cursor, so paging is direct:
// first page on mount, "Load more" appends older rows until the cursor runs
// out.

import { Icon } from "@iconify/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "../components/ClassArt";
import { classNameFor } from "../config";
import { timeAgo } from "../lib/time";
import { useInquiryStore } from "../stores/inquiry_store";
import { useSessionStore } from "../stores/session_store";

export function AdminPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { ready, isOwner } = useSessionStore();
  const { rows, nextCursor, loading, error, loadFirstPage, loadMore } = useInquiryStore();

  useEffect(() => {
    if (ready && !isOwner) void navigate({ to: "/" });
  }, [ready, isOwner, navigate]);

  useEffect(() => {
    if (isOwner && rows === null) void loadFirstPage();
  }, [isOwner, rows, loadFirstPage]);

  if (!ready || !isOwner) return null;

  return (
    <div className="page view-anim">
      <span className="eyebrow">{t("nav.inquiries")}</span>
      <h2 className="page-title">{t("admin.heading")}</h2>
      <p className="page-lead">{t("admin.lead")}</p>

      {loading && rows === null && (
        <p className="py-5 text-center text-[13px]" style={{ color: "var(--faint)" }}>{t("common.loading")}</p>
      )}
      {error && (
        <p className="py-5 text-center text-[13px]" style={{ color: "var(--accent)" }}>{t("common.error", { reason: error })}</p>
      )}
      {rows !== null && rows.length === 0 && (
        <p className="py-5 text-center text-[13px]" style={{ color: "var(--faint)" }}>{t("admin.empty")}</p>
      )}

      <div className="inbox-list">
        {(rows ?? []).map((inq) => (
          <article className="inquiry" key={inq.id}>
            <Avatar name={inq._submitter_handle} size={40} />
            <div className="iq-body">
              <div className="iq-head">
                <b>{"@" + inq._submitter_handle}</b>
                <a href={`mailto:${inq.email}`} className="iq-mail">{inq.email}</a>
                {inq.phone && (
                  <span className="iq-phone"><Icon icon="ph:phone" width={12} /> {inq.phone}</span>
                )}
                {inq.class && <span className="chip">{classNameFor(inq.class)}</span>}
                <span className="iq-time">{timeAgo(inq._created_at_ms, Date.now(), i18n.language)}</span>
              </div>
              <p className="q">{inq.question}</p>
            </div>
          </article>
        ))}
      </div>

      {nextCursor && (
        <div className="flex justify-center pt-6">
          <button type="button" className="inquire-btn" disabled={loading} onClick={() => void loadMore()}>
            {t("admin.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
