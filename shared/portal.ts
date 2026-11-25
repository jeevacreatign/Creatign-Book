// Client portal settings and visibility rules (Settings > Client Portal).
import type { DocKind, TxnDoc } from './types';

export interface PortalSettings {
  enabled: boolean;
  /** shown in emails and the portal header */
  name: string;
  /** public address of this app, used for links in emails. Falls back to the browser's origin. */
  publicUrl?: string;
  bannerMessage?: string;
  allowQuoteAcceptance: boolean;
  allowStatements: boolean;
  allowPaymentNotices: boolean;
  /** quote accept/decline and payment notices can be done from shared links too */
  allowActionsOnSharedLinks: boolean;
  /** email the organization when a customer accepts/declines a quote or reports a payment */
  notifyOrganization: boolean;
  /** shown on unpaid invoices in the portal and on shared links */
  upiId?: string;
  upiPayeeName?: string;
  bankInstructions?: string;
  /** days an emailed "View" link stays valid */
  emailLinkDays: number;
}

export const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  enabled: true,
  name: 'Client Portal',
  bannerMessage: '',
  allowQuoteAcceptance: true,
  allowStatements: true,
  allowPaymentNotices: true,
  allowActionsOnSharedLinks: true,
  notifyOrganization: true,
  upiId: '',
  upiPayeeName: '',
  bankInstructions: '',
  emailLinkDays: 90,
};

export function portalSettings(preferences: Record<string, unknown>): PortalSettings {
  return { ...DEFAULT_PORTAL_SETTINGS, ...((preferences.portal as Partial<PortalSettings>) || {}) };
}

/** Transactions a customer can see in the portal. */
export const PORTAL_KINDS: DocKind[] = ['quote', 'sales_order', 'invoice', 'credit_note'];

const HIDDEN = new Set(['draft', 'pending_approval', 'approved', 'rejected']);

/** Drafts and documents still in approval are never shown to customers. */
export function visibleToCustomer(d: Pick<TxnDoc, 'kind' | 'status'>) {
  return PORTAL_KINDS.includes(d.kind) && !HIDDEN.has(d.status);
}

export interface CustomerResponse {
  action: 'accepted' | 'declined';
  by: string;
  email?: string;
  comment?: string;
  at: string;
  via: 'portal' | 'link';
}

export interface PortalUser {
  id: string;
  contactId: string;
  /** contact person this login belongs to; undefined for the contact's primary email */
  contactPersonId?: string;
  email: string;
  name: string;
  status: 'invited' | 'active' | 'disabled';
  passwordHash?: string;
  inviteTokenHash?: string;
  inviteExpiresAt?: string;
  invitedAt?: string;
  resetTokenHash?: string;
  resetExpiresAt?: string;
  lastLoginAt?: string;
  failedLogins?: number;
  lockedUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortalSession {
  id: string;
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface PaymentNotice {
  id: string;
  contactId: string;
  invoiceId: string;
  amount: number;
  date: string;
  mode: string;
  reference?: string;
  note?: string;
  submittedBy: string;
  submittedEmail?: string;
  via: 'portal' | 'link';
  status: 'pending' | 'recorded' | 'dismissed';
  paymentId?: string;
  createdAt: string;
  resolvedAt?: string;
}

/** upi:// deep link that Indian UPI apps open with the amount filled in. */
export function upiLink(s: Pick<PortalSettings, 'upiId' | 'upiPayeeName'>, amount: number, note: string) {
  if (!s.upiId) return undefined;
  const q = new URLSearchParams({ pa: s.upiId, pn: s.upiPayeeName || '', am: amount.toFixed(2), cu: 'INR', tn: note });
  return `upi://pay?${q.toString()}`;
}
