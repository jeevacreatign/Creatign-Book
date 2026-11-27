// Automatic payment reminders. runReminders() looks at every unpaid invoice with a due date and
// sends the reminder rules (Settings > Payment Reminders) that fall due. Each invoice remembers the
// rules it has handled, so a reminder goes out once. A rule that was missed (the server was down)
// still goes out within CATCH_UP_DAYS; only the latest due rule is sent in one run so a client
// never gets several reminders for the same invoice on the same day.
import type { TxnDoc } from '../shared/types';
import { isUnposted } from '../shared/approval';
import { today } from '../shared/format';
import { reminderDate, reminderSettings, type ReminderRule, type ReminderSettings } from '../shared/reminders';
import { flushDb, getDb, now } from './db';
import { isEmail, publicOrigin, sendEmail } from './email';
import { logActivity } from './engine';
import { HttpError, commit } from './services';

const CATCH_UP_DAYS = 7;
const UNPAID = new Set(['open', 'sent', 'due_today', 'overdue', 'partially_paid']);

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export interface ReminderPlan {
  invoiceId: string;
  number: string;
  rule: ReminderRule;
  /** older rules that were missed and are now superseded */
  skip: ReminderRule[];
}

/** Which reminders are due on a day (nothing is sent). */
export function dueReminders(day = today()): ReminderPlan[] {
  const db = getDb();
  const settings = reminderSettings(db.preferences);
  if (!settings.enabled) return [];
  const rules = settings.rules.filter((r) => r.enabled && Number.isFinite(r.days) && r.days >= 0);
  const out: ReminderPlan[] = [];
  for (const d of db.docs) {
    if (d.kind !== 'invoice' || !d.dueDate || d.remindersStopped || isUnposted(d.status) || !UNPAID.has(d.status) || d.balance <= 0.004) continue;
    const done = new Set((d.remindersSent ?? []).map((x) => x.ruleId));
    const due = rules
      .filter((r) => !done.has(r.id))
      .map((r) => ({ r, on: reminderDate(d.dueDate!, r) }))
      .filter(({ r, on }) => on <= day && day <= addDays(on, CATCH_UP_DAYS) && (r.when === 'after' || day <= d.dueDate!))
      .sort((a, b) => a.on.localeCompare(b.on));
    if (!due.length) continue;
    const last = due[due.length - 1];
    out.push({ invoiceId: d.id, number: d.number, rule: last.r, skip: due.slice(0, -1).map((x) => x.r) });
  }
  return out;
}

function recipients(d: TxnDoc) {
  const db = getDb();
  const c = db.contacts.find((x) => x.id === d.contactId);
  const list = (d.emailRecipients?.length ? d.emailRecipients : c?.email ? [c.email] : []).filter(isEmail);
  return Array.from(new Set(list));
}

/** Send the reminders that are due. Safe to call often: each rule fires once per invoice. */
export async function runReminders(day = today(), origin = publicOrigin()) {
  const db = getDb();
  const settings = reminderSettings(db.preferences);
  const result = { sent: 0, outbox: 0, failed: 0, skipped: 0, noRecipient: 0 };
  for (const plan of dueReminders(day)) {
    const d = db.docs.find((x) => x.id === plan.invoiceId);
    if (!d) continue;
    d.remindersSent = d.remindersSent ?? [];
    for (const r of plan.skip) {
      d.remindersSent.push({ ruleId: r.id, at: now(), status: 'skipped' });
      result.skipped++;
    }
    const to = recipients(d);
    if (!to.length) {
      d.remindersSent.push({ ruleId: plan.rule.id, at: now(), status: 'skipped', error: 'The client has no email address' });
      result.noRecipient++;
      continue;
    }
    try {
      const mail = await sendEmail(
        { entityType: 'invoice', entityId: d.id, to, cc: settings.ccOrganization && isEmail(db.organization.email) ? [db.organization.email] : [], subject: plan.rule.subject, body: plan.rule.body, includeLink: true, attachPdf: true },
        origin,
      );
      mail.reminderRuleId = plan.rule.id;
      const status = mail.status === 'outbox' ? 'outbox' : 'sent';
      d.remindersSent.push({ ruleId: plan.rule.id, at: now(), status, mailId: mail.id });
      result[status]++;
      logActivity(db, 'invoice', d.id, d.contactId, 'Payment reminder sent', `${plan.rule.name} sent to ${to.join(', ')}${status === 'outbox' ? ' (kept in the outbox: email sending is not set up)' : ''}`);
    } catch (e) {
      d.remindersSent.push({ ruleId: plan.rule.id, at: now(), status: 'failed', error: e instanceof Error ? e.message : String(e) });
      result.failed++;
    }
  }
  commit();
  await flushDb();
  return result;
}

/** Validate and save Settings > Payment Reminders. */
export function saveReminderSettings(body: Partial<ReminderSettings>): ReminderSettings {
  const db = getDb();
  const cur = reminderSettings(db.preferences);
  const rules = (Array.isArray(body.rules) ? body.rules : cur.rules).map((r, i) => {
    const days = Math.round(Number(r.days));
    if (!Number.isFinite(days) || days < 0 || days > 365) throw new HttpError(400, 'Days must be between 0 and 365');
    if (r.when !== 'before' && r.when !== 'after') throw new HttpError(400, 'Choose before or after the due date');
    const subject = String(r.subject ?? '').trim();
    if (!subject) throw new HttpError(400, 'Every reminder needs a subject');
    if (/[\r\n]/.test(subject)) throw new HttpError(400, 'A subject cannot contain line breaks');
    return { id: String(r.id || `rem_${Date.now().toString(36)}_${i}`), name: String(r.name ?? '').trim() || `Reminder ${i + 1}`, when: r.when, days, enabled: Boolean(r.enabled), subject, body: String(r.body ?? '') };
  });
  if (rules.length > 10) throw new HttpError(400, 'You can have at most 10 reminders');
  const next: ReminderSettings = { enabled: body.enabled ?? cur.enabled, ccOrganization: body.ccOrganization ?? cur.ccOrganization, rules };
  db.preferences.paymentReminders = next;
  return next;
}

/** Reminders already sent (newest first). */
export function reminderLog(limit = 100) {
  const db = getDb();
  const rules = new Map(reminderSettings(db.preferences).rules.map((r) => [r.id, r.name]));
  return db.docs
    .filter((d) => d.kind === 'invoice' && d.remindersSent?.length)
    .flatMap((d) => d.remindersSent!.map((x) => ({ ...x, invoiceId: d.id, number: d.number, contactId: d.contactId, contactName: db.contacts.find((c) => c.id === d.contactId)?.displayName, ruleName: rules.get(x.ruleId) ?? 'Removed reminder' })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Check for due reminders now and then every hour (production server only). */
export function startReminderSchedule(everyMs = 60 * 60 * 1000) {
  if (timer) return;
  const tick = () => runReminders().catch((e) => console.error('[reminders]', e));
  setTimeout(tick, 15_000);
  timer = setInterval(tick, everyMs);
  timer.unref?.();
}
