import { serviceQueryKey, useServiceInfiniteQuery, useServiceMutation, useServiceQuery } from "@pilely/core";
import type { QueryKey, UseInfiniteQueryResult, UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import {
  accountInfo,
  createAccount,
  createTemplate,
  deleteAccount,
  deleteTemplate,
  listAccounts,
  listSends,
  listTemplates,
  send,
  setAccountAccess,
  templateInfo,
  updateTemplate,
} from "./api.js";
import type { SendInput, SendResult } from "./api.js";
import type {
  Account,
  AccountCursor,
  AccountInfoEnvelope,
  AccountSenders,
  SendCursor,
  SendRow,
  Template,
  TemplateCursor,
  TemplateMeta,
} from "./types.js";

/** `["pilely", "simple-email", "sends", options]` */
const sendsKey = (): QueryKey => serviceQueryKey("simple-email", "sends");
/** `["pilely", "simple-email", "accounts", options]` */
const accountsKey = (): QueryKey => serviceQueryKey("simple-email", "accounts");
/** `["pilely", "simple-email", "account"]` — this app's account info. */
const accountKey = (): QueryKey => serviceQueryKey("simple-email", "account");
/** `["pilely", "simple-email", "templates", options]` */
const templatesKey = (): QueryKey => serviceQueryKey("simple-email", "templates");
/** `["pilely", "simple-email", "template", templateId]` */
const templateKey = (templateId: string | undefined): QueryKey => serviceQueryKey("simple-email", "template", templateId);

export interface PageOptions {
  /** Rows per page; the server defaults to 50 and caps at 100. */
  limit?: number;
}

export interface CreateTemplateInput {
  /** `null` for a nameless template. */
  name: string | null;
  subject: string;
  html: string;
}

/** `useCreateEmailAccount`'s object form. Both keys are optional: an omitted
 *  `send_group` means owner-only, an omitted `account_senders` means
 *  `"send_group"`. */
export interface CreateEmailAccountInput {
  send_group?: string | null;
  account_senders?: AccountSenders;
}

/** `useSetEmailAccountAccess`'s object form. `send_group` is required (`null`
 *  = owner-only); an omitted `account_senders` keeps the current value. */
export interface SetEmailAccountAccessInput {
  send_group: string | null;
  account_senders?: AccountSenders;
}

/** A full replace of both `subject` and `html`; `name` is not updatable. */
export interface UpdateTemplateInput {
  templateId: string;
  subject: string;
  html: string;
}

// ── Sending ──────────────────────────────────────────────────────────────

/** Sends one email from this app's account: a raw send (`to`) or an account
 *  send (`to_account: "self" | "owner"`). Not optimistic: a send counts only
 *  once the server accepted it. A repeat carrying the same `idempotency_key`
 *  answers the first send with `replayed: true`. */
export function useSend(): UseMutationResult<SendResult, Error, SendInput> {
  return useServiceMutation<SendResult, SendInput>("useSend", {
    mutationFn: send,
    invalidates: () => [sendsKey()],
  });
}

/** This app's outbox, newest first, as an infinite query. */
export function useSends(options: PageOptions = {}): UseInfiniteQueryResult<SendRow[], Error> {
  const { limit } = options;
  return useServiceInfiniteQuery<SendRow, SendCursor>("useSends", {
    queryKey: [...sendsKey(), { limit }],
    fetchPage: async (cursor) => {
      const page = await listSends({ limit, ...(cursor ?? {}) });
      return { rows: page.sends, nextCursor: page.next_cursor };
    },
  });
}

// ── Accounts ─────────────────────────────────────────────────────────────

/** The caller's email accounts across apps, as an infinite query. */
export function useEmailAccounts(options: PageOptions = {}): UseInfiniteQueryResult<Account[], Error> {
  const { limit } = options;
  return useServiceInfiniteQuery<Account, AccountCursor>("useEmailAccounts", {
    queryKey: [...accountsKey(), { limit }],
    fetchPage: async (cursor) => {
      const page = await listAccounts({ limit, ...(cursor ?? {}) });
      return { rows: page.accounts, nextCursor: page.next_cursor };
    },
  });
}

/** This app's account with its live state: daily cap, sent today, credit
 *  and phone verification. */
export function useEmailAccount(): UseQueryResult<AccountInfoEnvelope, Error> {
  return useServiceQuery<AccountInfoEnvelope>("useEmailAccount", { queryKey: accountKey(), queryFn: accountInfo });
}

/** Creates this app's account; the variable is its optional send group
 *  (`null` or omitted: owner-only), or `{ send_group?, account_senders? }`. */
export function useCreateEmailAccount(): UseMutationResult<Account, Error, string | null | void | CreateEmailAccountInput> {
  return useServiceMutation<Account, string | null | void | CreateEmailAccountInput>("useCreateEmailAccount", {
    mutationFn: (input) =>
      typeof input === "object" && input !== null
        ? createAccount(input.send_group, input.account_senders)
        : createAccount(input ?? undefined),
    invalidates: () => [accountsKey(), accountKey()],
  });
}

/** Deletes this app's account and the templates under it. */
export function useDeleteEmailAccount(): UseMutationResult<void, Error, void> {
  return useServiceMutation<void, void>("useDeleteEmailAccount", {
    mutationFn: () => deleteAccount(),
    invalidates: () => [accountsKey(), accountKey(), templatesKey(), serviceQueryKey("simple-email", "template")],
  });
}

/** Replaces this app's send group (`null` means owner-only); the object form
 *  `{ send_group, account_senders? }` also sets who may make account sends. */
export function useSetEmailAccountAccess(): UseMutationResult<Account, Error, string | null | SetEmailAccountAccessInput> {
  return useServiceMutation<Account, string | null | SetEmailAccountAccessInput>("useSetEmailAccountAccess", {
    mutationFn: (input) =>
      typeof input === "object" && input !== null
        ? setAccountAccess(input.send_group, input.account_senders)
        : setAccountAccess(input),
    invalidates: () => [accountsKey(), accountKey()],
  });
}

// ── Templates ────────────────────────────────────────────────────────────

/** This app's templates (metadata only), as an infinite query. */
export function useTemplates(options: PageOptions = {}): UseInfiniteQueryResult<TemplateMeta[], Error> {
  const { limit } = options;
  return useServiceInfiniteQuery<TemplateMeta, TemplateCursor>("useTemplates", {
    queryKey: [...templatesKey(), { limit }],
    fetchPage: async (cursor) => {
      const page = await listTemplates({ limit, ...(cursor ?? {}) });
      return { rows: page.templates, nextCursor: page.next_cursor };
    },
  });
}

/** One template with its `html`. An `undefined` id disables the query. */
export function useTemplate(templateId: string | undefined): UseQueryResult<Template, Error> {
  return useServiceQuery<Template>("useTemplate", {
    queryKey: templateKey(templateId),
    queryFn: () => templateInfo(templateId as string),
    enabled: templateId !== undefined,
  });
}

export function useCreateTemplate(): UseMutationResult<TemplateMeta, Error, CreateTemplateInput> {
  return useServiceMutation<TemplateMeta, CreateTemplateInput>("useCreateTemplate", {
    mutationFn: ({ name, subject, html }) => createTemplate(name, subject, html),
    invalidates: () => [templatesKey()],
  });
}

export function useUpdateTemplate(): UseMutationResult<TemplateMeta, Error, UpdateTemplateInput> {
  return useServiceMutation<TemplateMeta, UpdateTemplateInput>("useUpdateTemplate", {
    mutationFn: ({ templateId, subject, html }) => updateTemplate(templateId, { subject, html }),
    invalidates: (_template, { templateId }) => [templatesKey(), templateKey(templateId)],
  });
}

export function useDeleteTemplate(): UseMutationResult<void, Error, string> {
  return useServiceMutation<void, string>("useDeleteTemplate", {
    mutationFn: deleteTemplate,
    invalidates: (_none, templateId) => [templatesKey(), templateKey(templateId)],
  });
}
