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
// `useRecords` pages newest-first with a cursor, so paging is direct: the
// first page of 50 when the list mounts, "Load more" (`fetchNextPage`)
// appends older rows while `hasNextPage`. The list mounts for the owner
// only, so nobody else ever asks for the table.

import { Icon } from "@iconify/react";
import { usePilelyAuth } from "@pilely/core";
import { useRecords } from "@pilely/simple-db";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "../components/ClassArt";
import { classNameFor } from "../config";
import { useIsOwner } from "../hooks/useIsOwner";
import type { InquiryRecord } from "../lib/records";
import { timeAgo } from "../lib/time";

const PAGE_SIZE = 50;

function InquiryList() {
  const { t, i18n } = useTranslation();
  const { data: rows, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useRecords<InquiryRecord>("inquiries", { limit: PAGE_SIZE });

  return (
    <>
      {isLoading && (
        <p className="py-5 text-center text-[13px]" style={{ color: "var(--faint)" }}>{t("common.loading")}</p>
      )}
      {error && (
        <p className="py-5 text-center text-[13px]" style={{ color: "var(--accent)" }}>{t("common.error", { reason: error.message })}</p>
      )}
      {rows !== undefined && rows.length === 0 && (
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

      {hasNextPage && (
        <div className="flex justify-center pt-6">
          <button type="button" className="inquire-btn" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {t("admin.loadMore")}
          </button>
        </div>
      )}
    </>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { ready } = usePilelyAuth();
  const isOwner = useIsOwner();

  useEffect(() => {
    if (ready && !isOwner) void navigate({ to: "/" });
  }, [ready, isOwner, navigate]);

  if (!ready || !isOwner) return null;

  return (
    <div className="page view-anim">
      <span className="eyebrow">{t("nav.inquiries")}</span>
      <h2 className="page-title">{t("admin.heading")}</h2>
      <p className="page-lead">{t("admin.lead")}</p>
      <InquiryList />
    </div>
  );
}
