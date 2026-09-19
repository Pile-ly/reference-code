// The inquiry form — the write side of the inbox recipe, in three states:
//
//  1. signed out → the sign-in gate. Gated on `window.pilely.user() ===
//     null`, NEVER on a status code: a public app holds an anon token for
//     signed-out visitors, so a denied write would come back as the uniform
//     404, not a 401. The button runs the platform sign-in dance and returns.
//  2. signed in → the form. Email + question required; phone optional; the
//     "About" select is pre-filled when the visitor arrived via a class's
//     Inquire button (?class=<id>). Email is a FORM FIELD on purpose: the
//     token carries the submitter's handle, never their email.
//  3. sent → the confirmation. This is ALL a submitter ever sees of the
//     inbox — the empty read group means they can never read the table back.

import { Icon } from "@iconify/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BUSINESS, CLASSES } from "../config";
import { useInquiryStore } from "../stores/inquiry_store";
import { useSessionStore } from "../stores/session_store";
import { toast } from "../stores/toast_store";

interface Props {
  /** Class id from the route's ?class= search param (Inquire pre-fill). */
  prefillClassId?: string;
}

const INFO_ICONS = ["ph:clock", "ph:map-pin", "ph:envelope-simple"];

function InquiryForm({ prefillClassId, onSent }: Props & { onSent: () => void }) {
  const { t } = useTranslation();
  const user = useSessionStore((s) => s.user);
  const submit = useInquiryStore((s) => s.submit);
  const [cls, setCls] = useState(prefillClassId ?? "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !question.trim()) {
      toast(t("contact.required"));
      return;
    }
    setSending(true);
    try {
      await submit({ email: email.trim(), question: question.trim(), phone: phone.trim(), class: cls });
      onSent();
    } catch (e) {
      toast(t("contact.sendFailed", { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h3 className="form-title">{t("contact.heading")}</h3>
      <p className="mb-3.5 text-[13px]" style={{ color: "var(--muted)" }}>{t("contact.askingAs", { handle: user?.handle ?? "" })}</p>
      <label className="field-label" htmlFor="f-class">{t("contact.aboutLabel")}</label>
      <select id="f-class" className="field" value={cls} onChange={(e) => setCls(e.target.value)}>
        <option value="">{t("contact.aboutGeneral")}</option>
        {CLASSES.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
      </select>
      <label className="field-label" htmlFor="f-email">{t("contact.emailLabel")}</label>
      <input id="f-email" type="email" className="field" placeholder={t("contact.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="field-label" htmlFor="f-phone">{t("contact.phoneLabel")}</label>
      <input id="f-phone" type="tel" className="field" placeholder={t("contact.phonePlaceholder")} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label className="field-label" htmlFor="f-question">{t("contact.questionLabel")}</label>
      <textarea id="f-question" className="field min-h-[100px] resize-y" placeholder={t("contact.questionPlaceholder")} value={question} onChange={(e) => setQuestion(e.target.value)} />
      <button type="button" className="cta cta-lg w-full" disabled={sending} onClick={() => void onSubmit()}>{t("contact.send")}</button>
    </div>
  );
}

export function ContactPage({ prefillClassId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { ready, user, signIn } = useSessionStore();
  const [sent, setSent] = useState(false);

  return (
    <div className="page view-anim">
      <div className="contact-wrap">
        <div className="contact-info">
          <span className="eyebrow">{t("nav.contact")}</span>
          <h1>{t("contact.heading")}</h1>
          <p className="page-lead">{BUSINESS.contactLead}</p>
          <ul className="info-list">
            {BUSINESS.info.map((block, i) => (
              <li key={block.title}>
                <span className="ic"><Icon icon={INFO_ICONS[i] ?? "ph:info"} width={17} /></span>
                <div><b>{block.title}</b>{block.lines.map((line) => (<small key={line}>{line}</small>))}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="form-card">
          {sent ? (
            <div className="py-6 text-center">
              <div className="sent-title">{t("contact.sentTitle")}</div>
              <p className="mb-5 mt-2.5 text-[13.5px]" style={{ color: "var(--muted)" }}>{t("contact.sentBody")}</p>
              <button type="button" className="cta" onClick={() => void navigate({ to: "/" })}>{t("contact.backHome")}</button>
            </div>
          ) : ready && !user ? (
            <div className="gate">
              <span className="ic"><Icon icon="ph:envelope-simple" width={22} /></span>
              <h3>{t("contact.gateLead")}</h3>
              <p>{BUSINESS.contactLead}</p>
              <button type="button" className="cta" onClick={signIn}>{t("nav.signIn")}</button>
            </div>
          ) : ready && user ? (
            <InquiryForm key={prefillClassId ?? ""} prefillClassId={prefillClassId} onSent={() => setSent(true)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
