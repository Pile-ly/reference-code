import { serviceQueryKey, useServiceInfiniteQuery, useServiceMutation, useServiceQuery } from "@pilely/core";
import type { ChallengeOption } from "@pilely/core";
import type { QueryKey, UseInfiniteQueryResult, UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import {
  accountInfo,
  createAccount,
  createTemplate,
  deleteAccount,
  deleteTemplate,
  listAccounts,
  listTemplates,
  sendTemplate,
  setReplyTo,
  templateInfo,
  updateTemplate,
} from "./api.js";
import type { TemplateSendResult } from "./api.js";
import type { Account, AccountCursor, AccountInfoEnvelope, Template, TemplateCursor, TemplateMeta } from "./types.js";

/** `["pilely", "simple-email", "accounts", options]` */
const accountsKey = (): QueryKey => serviceQueryKey("simple-email", "accounts");
/** `["pilely", "simple-email", "account"]` — this app's account info. */
const accountKey = (): QueryKey => serviceQueryKey("simple-email", "account");
/** `["pilely", "simple-email", "templates", options]` */
const templatesKey = (): QueryKey => serviceQueryKey("simple-email", "templates");
/** `["pilely", "simple-email", "template", templateId]` */
const templateKey = (templateId: string | undefined): QueryKey => serviceQueryKey("simple-email", "template", templateId);

export interface PageOptions extends ChallengeOption {
  /** Rows per page; the server defaults to 50 and caps at 100. */
  limit?: number;
}

/** `recipient` is required: the ONE address the template's sends go to.
 *  An omitted (or `null`) group is empty: an empty `send_group` admits
 *  nobody, an empty `deny_group` refuses nobody. */
export interface CreateTemplateInput {
  /** `null` for a nameless template. */
  name: string | null;
  subject: string;
  html: string;
  recipient: string;
  /** An owner group, or the platform-wide anonymous or authenticated group. */
  send_group?: string | null;
  /** An owner group only. */
  deny_group?: string | null;
}

/** `useCreateEmailAccount`'s object form. An omitted (or `null`) `reply_to`
 *  means no reply-to. */
export interface CreateEmailAccountInput {
  /** The address recipients' replies go to. */
  reply_to?: string | null;
}

/** A full replace of both `subject` and `html`; `name` is not updatable. An
 *  omitted `recipient`, `send_group` or `deny_group` keeps the stored value;
 *  `null` empties a group. */
export interface UpdateTemplateInput {
  templateId: string;
  subject: string;
  html: string;
  recipient?: string;
  send_group?: string | null;
  deny_group?: string | null;
}

/** `useSendTemplate`'s variables: the template and its placeholder values. */
export interface SendTemplateInput {
  templateId: string;
  /** One string per placeholder of the template's subject and html; omitted
   *  is `{}`, for a template without placeholders. */
  variables?: Record<string, string>;
}

// ── Sending ──────────────────────────────────────────────────────────────

/** The template send, from a page: the template, filled from `variables`,
 *  to the one recipient its owner stored on it. Not optimistic: a send
 *  counts only once the server accepted it. The answer is `{ send_id }`,
 *  never the address. It counts toward the app's daily send cap, so it
 *  refreshes `useEmailAccount()`. */
export function useSendTemplate(
  options: ChallengeOption = {},
): UseMutationResult<TemplateSendResult, Error, SendTemplateInput> {
  const { challenge } = options;
  return useServiceMutation<TemplateSendResult, SendTemplateInput>("useSendTemplate", {
    mutationFn: ({ templateId, variables }) => sendTemplate(templateId, variables, { challenge }),
    invalidates: () => [accountKey()],
  });
}

// ── Accounts ─────────────────────────────────────────────────────────────

/** The caller's email accounts across apps, as an infinite query. */
export function useEmailAccounts(options: PageOptions = {}): UseInfiniteQueryResult<Account[], Error> {
  const { limit, challenge } = options;
  return useServiceInfiniteQuery<Account, AccountCursor>("useEmailAccounts", {
    queryKey: [...accountsKey(), { limit }],
    fetchPage: async (cursor) => {
      const page = await listAccounts({ limit, ...(cursor ?? {}) }, { challenge });
      return { rows: page.accounts, nextCursor: page.next_cursor };
    },
  });
}

/** This app's account with its live state: daily cap, sent today and
 *  credit. */
export function useEmailAccount(options: ChallengeOption = {}): UseQueryResult<AccountInfoEnvelope, Error> {
  const { challenge } = options;
  return useServiceQuery<AccountInfoEnvelope>("useEmailAccount", {
    queryKey: accountKey(),
    queryFn: () => accountInfo({ challenge }),
  });
}

/** Creates this app's account; the variable is optional, or
 *  `{ reply_to? }`. */
export function useCreateEmailAccount(
  options: ChallengeOption = {},
): UseMutationResult<Account, Error, void | CreateEmailAccountInput> {
  const { challenge } = options;
  return useServiceMutation<Account, void | CreateEmailAccountInput>("useCreateEmailAccount", {
    mutationFn: (input) => createAccount(input ? input.reply_to : undefined, { challenge }),
    invalidates: () => [accountsKey(), accountKey()],
  });
}

/** Deletes this app's account and the templates under it. */
export function useDeleteEmailAccount(options: ChallengeOption = {}): UseMutationResult<void, Error, void> {
  const { challenge } = options;
  return useServiceMutation<void, void>("useDeleteEmailAccount", {
    mutationFn: () => deleteAccount({ challenge }),
    invalidates: () => [accountsKey(), accountKey(), templatesKey(), serviceQueryKey("simple-email", "template")],
  });
}

/** Sets this app's reply-to address — where recipients' replies go; every
 *  send from the account carries it as its `Reply-To` — or clears it with
 *  `null`. The variable is required: there is no "keep" form. */
export function useSetEmailReplyTo(options: ChallengeOption = {}): UseMutationResult<Account, Error, string | null> {
  const { challenge } = options;
  return useServiceMutation<Account, string | null>("useSetEmailReplyTo", {
    mutationFn: (replyTo) => setReplyTo(replyTo, { challenge }),
    invalidates: () => [accountsKey(), accountKey()],
  });
}

// ── Templates ────────────────────────────────────────────────────────────

/** This app's templates (metadata only), as an infinite query. */
export function useTemplates(options: PageOptions = {}): UseInfiniteQueryResult<TemplateMeta[], Error> {
  const { limit, challenge } = options;
  return useServiceInfiniteQuery<TemplateMeta, TemplateCursor>("useTemplates", {
    queryKey: [...templatesKey(), { limit }],
    fetchPage: async (cursor) => {
      const page = await listTemplates({ limit, ...(cursor ?? {}) }, { challenge });
      return { rows: page.templates, nextCursor: page.next_cursor };
    },
  });
}

/** One template with its `html`. An `undefined` id disables the query. */
export function useTemplate(
  templateId: string | undefined,
  options: ChallengeOption = {},
): UseQueryResult<Template, Error> {
  const { challenge } = options;
  return useServiceQuery<Template>("useTemplate", {
    queryKey: templateKey(templateId),
    queryFn: () => templateInfo(templateId as string, { challenge }),
    enabled: templateId !== undefined,
  });
}

export function useCreateTemplate(
  options: ChallengeOption = {},
): UseMutationResult<TemplateMeta, Error, CreateTemplateInput> {
  const { challenge } = options;
  return useServiceMutation<TemplateMeta, CreateTemplateInput>("useCreateTemplate", {
    mutationFn: (input) => createTemplate(input, { challenge }),
    invalidates: () => [templatesKey()],
  });
}

export function useUpdateTemplate(
  options: ChallengeOption = {},
): UseMutationResult<TemplateMeta, Error, UpdateTemplateInput> {
  const { challenge } = options;
  return useServiceMutation<TemplateMeta, UpdateTemplateInput>("useUpdateTemplate", {
    mutationFn: ({ templateId, ...body }) => updateTemplate(templateId, body, { challenge }),
    invalidates: (_template, { templateId }) => [templatesKey(), templateKey(templateId)],
  });
}

export function useDeleteTemplate(options: ChallengeOption = {}): UseMutationResult<void, Error, string> {
  const { challenge } = options;
  return useServiceMutation<void, string>("useDeleteTemplate", {
    mutationFn: (templateId) => deleteTemplate(templateId, { challenge }),
    invalidates: (_none, templateId) => [templatesKey(), templateKey(templateId)],
  });
}
