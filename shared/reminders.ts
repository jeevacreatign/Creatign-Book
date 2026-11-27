// Automatic payment reminders: emails sent a number of days before or after an invoice's due date.
// The rules live in preferences.paymentReminders; each invoice remembers which rules already fired.

export interface ReminderRule {
  id: string;
  name: string;
  when: 'before' | 'after';
  days: number;
  enabled: boolean;
  subject: string;
  body: string;
}

export interface ReminderSettings {
  enabled: boolean;
  /** also copy the organization's email on every reminder */
  ccOrganization: boolean;
  rules: ReminderRule[];
}

const BEFORE_BODY = `Dear %ContactName%,

This is a gentle reminder that invoice %DocumentNumber% for %BalanceDue% is due on %DueDate%.

You can view the invoice and pay using the link below. If you have already arranged payment, please ignore this email.

Regards,
%CompanyName%`;

const AFTER_BODY = `Dear %ContactName%,

Our records show that invoice %DocumentNumber% dated %DocumentDate% has a balance of %BalanceDue%, which was due on %DueDate% (%DaysOverdue% days ago).

We would be grateful if you could arrange the payment at the earliest. If you have already paid, please share the payment details so we can update our books.

Regards,
%CompanyName%`;

export const DEFAULT_REMINDER_RULES: ReminderRule[] = [
  { id: 'rem_before_3', name: 'Upcoming due date', when: 'before', days: 3, enabled: true, subject: 'Invoice %DocumentNumber% is due on %DueDate%', body: BEFORE_BODY },
  { id: 'rem_after_1', name: 'First overdue reminder', when: 'after', days: 1, enabled: true, subject: 'Payment reminder: invoice %DocumentNumber% is overdue', body: AFTER_BODY },
  { id: 'rem_after_7', name: 'Second overdue reminder', when: 'after', days: 7, enabled: true, subject: 'Second reminder: invoice %DocumentNumber% is %DaysOverdue% days overdue', body: AFTER_BODY },
  { id: 'rem_after_15', name: 'Final reminder', when: 'after', days: 15, enabled: false, subject: 'Final reminder: invoice %DocumentNumber% is %DaysOverdue% days overdue', body: AFTER_BODY },
];

export function reminderSettings(preferences: Record<string, unknown> | undefined): ReminderSettings {
  const saved = (preferences?.paymentReminders ?? {}) as Partial<ReminderSettings>;
  return { enabled: Boolean(saved.enabled), ccOrganization: Boolean(saved.ccOrganization), rules: Array.isArray(saved.rules) && saved.rules.length ? saved.rules : DEFAULT_REMINDER_RULES };
}

/** The day a rule fires for an invoice due on dueDate (yyyy-mm-dd). */
export function reminderDate(dueDate: string, rule: Pick<ReminderRule, 'when' | 'days'>): string {
  const d = new Date(`${dueDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (rule.when === 'before' ? -rule.days : rule.days));
  return d.toISOString().slice(0, 10);
}

export const describeRule = (r: Pick<ReminderRule, 'when' | 'days'>) => (r.days === 0 ? 'On the due date' : `${r.days} day${r.days === 1 ? '' : 's'} ${r.when} the due date`);
