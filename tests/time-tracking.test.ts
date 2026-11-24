// Time tracking: projects with the four Zoho billing methods, timesheet entries, the timer,
// invoicing unbilled time, the project transaction tabs and budgets.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { fmtHours, hoursBetween, parseHours, timePeriodRange } from '../shared/projects';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-books-test-uploads';

let app: Express;
const api = () => request(app);

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(false);
  mod.boot();
  app = mod.createApp();
  await api().post('/api/contacts').send({ kind: 'customer', displayName: 'Kaveri Foods', id: 'x' });
});

const customer = async () => ((await api().get('/api/contacts').query({ kind: 'customer' })).body as { id: string; displayName: string }[]).find((c) => c.displayName === 'Kaveri Foods')!.id;

describe('time helpers', () => {
  it('reads and writes HH:MM', () => {
    expect(parseHours('1:30')).toBe(1.5);
    expect(parseHours('2h')).toBe(2);
    expect(parseHours('45m')).toBe(0.75);
    expect(parseHours('1.25')).toBe(1.25);
    expect(Number.isNaN(parseHours('abc'))).toBe(true);
    expect(fmtHours(1.5)).toBe('01:30');
    expect(fmtHours(10.25)).toBe('10:15');
    expect(hoursBetween('09:00', '17:30')).toBe(8.5);
    expect(hoursBetween('22:00', '01:00')).toBe(3);
  });
  it('builds timesheet periods with Monday weeks and fiscal quarters', () => {
    expect(timePeriodRange('this_week', '2026-11-26')).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    expect(timePeriodRange('previous_week', '2026-11-26')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(timePeriodRange('this_quarter', '2026-11-26')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(timePeriodRange('this_year', '2026-11-26')).toMatchObject({ from: '2026-04-01', to: '2027-03-31' });
  });
});

describe('projects', () => {
  let cus = '';
  let hourly = '';
  let staffId = '';
  it('requires a name, a customer and the rate for the billing method', async () => {
    cus = await customer();
    expect((await api().post('/api/projects').send({ customerId: cus })).body.error).toMatch(/Project Name/);
    expect((await api().post('/api/projects').send({ name: 'Site' })).body.error).toMatch(/Customer Name/);
    expect((await api().post('/api/projects').send({ name: 'Site', customerId: cus, billingMethod: 'fixed' })).body.error).toMatch(/Total Project Cost/);
    expect((await api().post('/api/projects').send({ name: 'Site', customerId: cus, billingMethod: 'task_hours' })).body.error).toMatch(/task/);
  });

  it('creates a project-hours project with tasks and the default user', async () => {
    const r = await api().post('/api/projects').send({ name: 'Website', code: 'WEB', customerId: cus, billingMethod: 'project_hours', rate: 2000, tasks: [{ id: 'new1', name: 'Design' }, { id: 'new2', name: 'Build' }], budgetHoursType: 'total', budgetHours: 10 });
    expect(r.status).toBe(200);
    hourly = r.body.id;
    expect(r.body.users).toHaveLength(1);
    expect(r.body.tasks.map((t: { name: string }) => t.name)).toEqual(['Design', 'Build']);
    expect((await api().post('/api/projects').send({ name: 'website', customerId: cus, billingMethod: 'project_hours', rate: 1 })).body.error).toMatch(/already exists/);
    const d = (await api().get(`/api/projects/${hourly}`)).body;
    expect(d.billingMethodLabel).toBe('Based on Project Hours');
    expect(d.budgetHours).toBe(10);
  });

  it('adds a user (creating them) and a task from the overview', async () => {
    const u = await api().post(`/api/projects/${hourly}/users`).send({ name: 'Ravi', email: 'ravi@example.com', role: 'Staff' });
    expect(u.status).toBe(200);
    staffId = u.body.userId;
    expect((await api().post(`/api/projects/${hourly}/users`).send({ userId: staffId })).body.error).toMatch(/already/);
    const t = await api().post(`/api/projects/${hourly}/tasks`).send({ name: 'QA' });
    expect(t.status).toBe(200);
    const acts = (await api().get('/api/activities').query({ entityId: hourly })).body.map((a: { message: string }) => a.message);
    expect(acts).toEqual(expect.arrayContaining(['Project created', 'User Ravi added', 'Task QA added']));
  });

  describe('timesheet and invoicing', () => {
    let design = '';
    let e1 = '';
    let e2 = '';
    it('logs time as HH:MM or start/end, requires a task, and shows billing status', async () => {
      const prj = (await api().get(`/api/projects/${hourly}`)).body;
      design = prj.tasks.find((t: { name: string }) => t.name === 'Design').id;
      expect((await api().post('/api/time-entries').send({ projectId: hourly, hours: '1:00' })).body.error).toMatch(/Task Name/);
      expect((await api().post('/api/time-entries').send({ projectId: hourly, taskId: design, hours: '0:00' })).body.error).toMatch(/time spent/);
      const a = await api().post('/api/time-entries').send({ projectId: hourly, taskId: design, hours: '2:30', date: '2026-11-02', notes: 'Wireframes' });
      expect(a.status).toBe(200);
      expect(a.body.hours).toBe(2.5);
      expect(a.body.billingStatus).toBe('unbilled');
      expect(a.body.amount).toBe(5000);
      e1 = a.body.id;
      const b = await api().post('/api/time-entries').send({ projectId: hourly, taskName: 'Build', userId: staffId, startTime: '10:00', endTime: '11:30', date: '2026-11-03' });
      expect(b.body.hours).toBe(1.5);
      expect(b.body.userName).toBe('Ravi');
      e2 = b.body.id;
      const nb = await api().post('/api/time-entries').send({ projectId: hourly, taskId: design, hours: 1, billable: false, date: '2026-11-03' });
      expect(nb.body.billingStatus).toBe('non_billable');
    });

    it('filters by status, user, period and customer and summarises', async () => {
      expect((await api().get('/api/time-entries').query({ status: 'unbilled', projectId: hourly })).body).toHaveLength(2);
      expect((await api().get('/api/time-entries').query({ userId: staffId })).body).toHaveLength(1);
      expect((await api().get('/api/time-entries').query({ period: 'custom', from: '2026-11-03', to: '2026-11-03' })).body).toHaveLength(2);
      expect((await api().get('/api/time-entries').query({ customerId: cus })).body).toHaveLength(3);
      const s = (await api().get('/api/time-entries/summary').query({ projectId: hourly })).body;
      expect(s.loggedHours).toBe(5);
      expect(s.billableHours).toBe(4);
      expect(s.unbilledAmount).toBe(8000);
      const d = (await api().get(`/api/projects/${hourly}`)).body;
      expect(d.unbilledAmount).toBe(8000);
      expect(d.users.find((u: { name: string }) => u.name === 'Ravi').loggedHours).toBe(1.5);
    });

    it('logs a week of time in one go', async () => {
      const r = await api().post('/api/time-entries/weekly').send({ weekStart: '2026-11-09', rows: [{ projectId: hourly, taskId: design, hours: ['1:00', '', '0:30', '', '', '', ''] }] });
      expect(r.body.created).toBe(2);
      expect(r.body.hours).toBe(1.5);
    });

    it('invoices unbilled time per task within a date range and locks it', async () => {
      const preview = (await api().get(`/api/projects/${hourly}/unbilled`).query({ from: '2026-11-01', to: '2026-11-05' })).body;
      expect(preview.entries).toHaveLength(2);
      const inv = await api().post(`/api/projects/${hourly}/invoice`).send({ from: '2026-11-01', to: '2026-11-05', groupBy: 'task' });
      expect(inv.status).toBe(200);
      expect(inv.body.projectId).toBe(hourly);
      expect(inv.body.lineItems.map((l: { name: string; quantity: number }) => [l.name, l.quantity])).toEqual([
        ['Website - Design', 2.5],
        ['Website - Build', 1.5],
      ]);
      expect(inv.body.subTotal).toBe(8000);
      expect(inv.body.projectFee).toBe(8000);
      const e = (await api().get(`/api/time-entries/${e1}`)).body;
      expect(e.billingStatus).toBe('invoiced');
      expect(e.invoiceNumber).toBe(inv.body.number);
      expect((await api().delete(`/api/time-entries/${e1}`)).body.error).toMatch(/Invoiced time/);
      const d = (await api().get(`/api/projects/${hourly}`)).body;
      expect(d.billedAmount).toBe(8000);
      const tx = (await api().get(`/api/projects/${hourly}/transactions`)).body;
      expect(tx.invoices).toHaveLength(1);
      // deleting the invoice returns the time to Unbilled
      await api().delete(`/api/docs/${inv.body.id}`);
      expect((await api().get(`/api/time-entries/${e2}`)).body.billingStatus).toBe('unbilled');
      expect((await api().get(`/api/projects/${hourly}`)).body.billedAmount).toBe(0);
    });

    it('bills staff-hours projects at each user rate', async () => {
      const r = await api().post('/api/projects').send({ name: 'Support', customerId: cus, billingMethod: 'staff_hours', users: [{ userId: 'usr_admin', ratePerHour: 3000 }, { userId: staffId, ratePerHour: 1000 }] });
      expect(r.status).toBe(200);
      await api().post('/api/time-entries').send({ projectId: r.body.id, hours: 2, date: '2026-11-04' });
      await api().post('/api/time-entries').send({ projectId: r.body.id, hours: 3, userId: staffId, date: '2026-11-04' });
      const inv = await api().post(`/api/projects/${r.body.id}/invoice`).send({ groupBy: 'staff' });
      expect(inv.body.subTotal).toBe(9000);
      expect(inv.body.lineItems).toHaveLength(2);
      // voiding the invoice returns its time to Unbilled
      await api().post(`/api/docs/${inv.body.id}/actions/mark_sent`);
      expect((await api().post(`/api/docs/${inv.body.id}/actions/void`)).status).toBe(200);
      const d = (await api().get(`/api/projects/${r.body.id}`)).body;
      expect(d.unbilledHours).toBe(5);
      expect(d.billedAmount).toBe(0);
    });
  });

  it('bills a fixed-cost project by project fee and tracks what is left', async () => {
    const r = await api().post('/api/projects').send({ name: 'Rebrand', customerId: cus, billingMethod: 'fixed', rate: 100000 });
    const id = r.body.id;
    expect((await api().get(`/api/projects/${id}`)).body.unbilledAmount).toBe(100000);
    const inv = await api().post(`/api/projects/${id}/invoice`).send({ fee: 100 });
    expect(inv.body.total).toBeGreaterThanOrEqual(100);
    const d = (await api().get(`/api/projects/${id}`)).body;
    expect(d.billedAmount).toBe(100);
    expect(d.unbilledAmount).toBe(99900);
    expect((await api().post(`/api/projects/${id}/invoice`).send({ fee: 200000 })).body.error).toMatch(/left to bill/);
    // linked invoice blocks deletion; inactive works
    expect((await api().delete(`/api/projects/${id}`)).body.error).toMatch(/inactive/);
    await api().post(`/api/projects/${id}/actions/deactivate`);
    expect((await api().get('/api/projects').query({ view: 'inactive' })).body.map((x: { id: string }) => x.id)).toContain(id);
  });

  it('runs the timer: start, pause, resume, stop saves an entry; row Start adds to an entry', async () => {
    const prj = (await api().get(`/api/projects/${hourly}`)).body;
    const s = await api().post('/api/timer/start').send({ projectId: hourly, taskId: prj.tasks[0].id, notes: 'Timer work' });
    expect(s.body.running).toBe(true);
    expect((await api().post('/api/timer/start').send({})).body.error).toMatch(/already running/);
    expect((await api().post('/api/timer/pause')).body.running).toBe(false);
    expect((await api().post('/api/timer/resume')).body.running).toBe(true);
    const e = await api().post('/api/timer/stop').send({});
    expect(e.status).toBe(200);
    expect(e.body.hours).toBeCloseTo(1 / 60);
    expect((await api().get('/api/timer')).body.timer).toBeNull();
    await api().post('/api/timer/start').send({ entryId: e.body.id });
    const again = await api().post('/api/timer/stop').send({});
    expect(again.body.id).toBe(e.body.id);
    expect(again.body.hours).toBeCloseTo(2 / 60);
    // a timer without a project needs one to save
    await api().post('/api/timer/start').send({});
    expect((await api().post('/api/timer/stop').send({})).body.error).toMatch(/Select a project/);
    await api().delete('/api/timer');
    expect((await api().get('/api/timer')).body.timer).toBeNull();
  });

  it('links documents and manual journals to the project by id', async () => {
    const q = await api().post('/api/docs').send({ kind: 'quote', mode: 'draft', contactId: cus, projectId: hourly, lineItems: [{ name: 'Extra pages', quantity: 1, rate: 5000 }] });
    expect(q.body.projectName).toBe('Website');
    const j = await api().post('/api/journals').send({ date: '2026-11-05', projectId: hourly, lines: [{ accountId: 'acc_general_income', credit: 500 }, { accountId: 'acc_petty_cash', debit: 500 }] });
    expect(j.status).toBe(200);
    const tx = (await api().get(`/api/projects/${hourly}/transactions`)).body;
    expect(tx.quotes.map((x: { id: string }) => x.id)).toContain(q.body.id);
    expect(tx.journals).toHaveLength(1);
  });

  it('creates a project budget and reports actuals from project journals', async () => {
    expect((await api().post('/api/budgets').send({ projectId: hourly, fiscalYearStart: '2026-04-01' })).body.error).toMatch(/Name/);
    const b = await api().post('/api/budgets').send({ name: 'FY27', projectId: hourly, fiscalYearStart: '2026-04-01', period: 'monthly', lines: [{ accountId: 'acc_general_income', amounts: [0, 0, 0, 0, 0, 0, 0, 10000] }] });
    expect(b.status).toBe(200);
    const v = (await api().get(`/api/budgets/${b.body.id}`)).body;
    expect(v.buckets).toHaveLength(12);
    expect(v.buckets[7].label).toBe('Nov 2026');
    expect(v.lines[0].total).toBe(10000);
    expect(v.lines[0].actuals[7]).toBe(500);
    expect((await api().post('/api/budgets').send({ name: 'Q', projectId: hourly, fiscalYearStart: '2026-04-01', period: 'quarterly', lines: [{ accountId: 'acc_petty_cash', amounts: [1] }] })).body.error).toMatch(/income and expense/);
  });
});
