// Transaction approval workflow (Zoho Books style).
//   Draft -> Submit for Approval -> Pending Approval -> Approve -> Approved -> Send / Confirm / Open
//                                                    \-> Reject -> Rejected -> edit & resubmit
// Documents in any of the pre-approval states are "unposted": they never hit the ledger,
// receivables/payables or reports until they move on to their normal open status.
import type { DocKind } from './types';

/** Modules that support approvals (Settings > Approvals). */
export const APPROVAL_KINDS: DocKind[] = ['quote', 'sales_order', 'invoice', 'credit_note', 'purchase_order', 'bill', 'vendor_credit'];

/** Approvals that are on when the organization has never saved the setting. */
export const DEFAULT_APPROVALS: Partial<Record<DocKind, boolean>> = { sales_order: true };

export const PRE_APPROVAL_STATUSES = ['pending_approval', 'approved', 'rejected'];
const UNPOSTED = new Set(['draft', ...PRE_APPROVAL_STATUSES]);

/** Draft or somewhere in the approval workflow: not yet an open/confirmed/issued document. */
export const isUnposted = (status: string) => UNPOSTED.has(status);

/** Draft, pending or rejected: still needs an approval before it can be sent or opened. */
export const needsApproval = (status: string) => status === 'draft' || status === 'pending_approval' || status === 'rejected';

export function approvalEnabled(preferences: Record<string, unknown> | undefined, kind: DocKind): boolean {
  if (!APPROVAL_KINDS.includes(kind)) return false;
  const saved = (preferences?.approvals ?? {}) as Partial<Record<DocKind, boolean>>;
  return saved[kind] ?? DEFAULT_APPROVALS[kind] ?? false;
}

export function approvalSettings(preferences: Record<string, unknown> | undefined): Record<string, boolean> {
  return Object.fromEntries(APPROVAL_KINDS.map((k) => [k, approvalEnabled(preferences, k)]));
}

/** The status a document moves to once it is approved and then sent/confirmed/opened. */
export const POSTED_STATUS: Partial<Record<DocKind, string>> = {
  quote: 'sent',
  sales_order: 'confirmed',
  invoice: 'open',
  credit_note: 'open',
  purchase_order: 'issued',
  bill: 'open',
  vendor_credit: 'open',
  delivery_challan: 'open',
};
