// Banking: statement import, duplicate detection, rules, categorize / match, transfers and reconciliation.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { guessMapping, mapRows, parseAmount, parseDelimited, parseStatementDate } from '../shared/bankImport';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-books-test-uploads';

let app: Express;
const api = () => request(app);
const BANK = 'acc_bank_hdfc';

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
});

const balance = async (id: string) => ((await api().get(`/api/accounts/${id}`)).body as { balance: number }).balance;
const lines = async (status = 'all') => (await api().get(`/api/banking/accounts/${BANK}/statement-lines`).query({ status })).body as { id: string; description: string; status: string; ruleId?: string; deposit: number; withdrawal: number }[];

describe('statement parsing', () => {
  it('reads Indian bank formats', () => {
    expect(parseAmount('1,23,456.78')).toBe(123456.78);
    expect(parseAmount('(500.00)')).toBe(-500);
    expect(parseAmount('250.00 Dr')).toBe(-250);
    expect(parseStatementDate('05/11/2026', 'dd/MM/yyyy')).toBe('2026-11-05');
    expect(parseStatementDate('05 Nov 2026', 'dd MMM yyyy')).toBe('2026-11-05');
    expect(parseStatementDate('31/02/2026', 'dd/MM/yyyy')).toBeUndefined();
    const rows = parseDelimited('Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt\n"01/11/2026","UPI, Swiggy",R1,"1,200.00",\n');
    const map = guessMapping(rows[0]);
    expect(map).toMatchObject({ date: 0, description: 1, reference: 2, withdrawal: 3, deposit: 4 });
    expect(mapRows(rows.slice(1), map, 'dd/MM/yyyy')[0]).toMatchObject({ date: '2026-11-01', description: 'UPI, Swiggy', withdrawal: 1200, deposit: 0 });
  });
});

const CSV = [
  'Date,Narration,Ref,Withdrawal,Deposit',
  '02/11/2026,NEFT from Acme Corp,N123,,5000.00',
  '03/11/2026,AWS Services,A1,1500.00,',
  '04/11/2026,Bank interest,,,120.50',
  '05/11/2026,Office rent Nov,R11,25000.00,',
  'bad date,Broken,,10,',
].join('\n');

describe('import and categorize', () => {
  it('imports a statement, skips bad rows and duplicates', async () => {
    const pre = (await api().post('/api/banking/import/preview').send({ text: CSV })).body;
    expect(pre.headers).toHaveLength(5);
    expect(pre.dateFormat).toBe('dd/MM/yyyy');
    const r = await api().post(`/api/banking/accounts/${BANK}/import`).send({ text: CSV, fileName: 'nov.csv' });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(4);
    expect(r.body.errors).toHaveLength(1);
    const again = await api().post(`/api/banking/accounts/${BANK}/import`).send({ text: CSV, fileName: 'nov.csv' });
    expect(again.body.imported).toBe(0);
    expect(again.body.duplicates).toBe(4);
    expect((await api().get(`/api/banking/accounts/${BANK}`)).body.uncategorized).toBe(4);
  });

  it('categorizes a deposit as interest income and moves the bank balance', async () => {
    const before = await balance(BANK);
    const l = (await lines()).find((x) => x.description === 'Bank interest')!;
    const bad = await api().post(`/api/banking/statement-lines/${l.id}/categorize`).send({ as: 'expense', offsetAccountId: 'acc_rent' });
    expect(bad.body.error).toMatch(/withdrawals/);
    const r = await api().post(`/api/banking/statement-lines/${l.id}/categorize`).send({ as: 'interest_income', offsetAccountId: 'acc_interest_income' });
    expect(r.body.error ?? r.body.status).toBe('categorized');
    expect(await balance(BANK)).toBe(before + 120.5);
    // uncategorize removes the transaction it created
    await api().post(`/api/banking/statement-lines/${l.id}/uncategorize`).send({});
    expect(await balance(BANK)).toBe(before);
    expect((await lines('uncategorized')).some((x) => x.id === l.id)).toBe(true);
  });

  it('records a withdrawal as a real expense', async () => {
    const l = (await lines()).find((x) => x.description === 'AWS Services')!;
    const r = await api().post(`/api/banking/statement-lines/${l.id}/categorize`).send({ as: 'expense', offsetAccountId: 'acc_internet' });
    expect(r.status).toBe(200);
    const d = (await api().get(`/api/banking/statement-lines/${l.id}`)).body;
    expect(d.match.type).toBe('expense');
    const e = (await api().get(`/api/expenses/${d.match.id}`)).body;
    expect(e.amount).toBe(1500);
    expect(e.paidThroughAccountId).toBe(BANK);
    // deleting the expense elsewhere sends the line back to uncategorized
    await api().delete(`/api/expenses/${d.match.id}`);
    expect((await api().get(`/api/banking/statement-lines/${l.id}`)).body.status).toBe('uncategorized');
  });

  it('records a customer payment and matches an existing transaction', async () => {
    const l = (await lines()).find((x) => x.description === 'NEFT from Acme Corp')!;
    const r = await api().post(`/api/banking/statement-lines/${l.id}/categorize`).send({ as: 'customer_payment', contactId: 'cus_test' });
    expect(r.status).toBe(200);
    const d = (await api().get(`/api/banking/statement-lines/${l.id}`)).body;
    expect(d.match.type).toBe('payment_received');
    expect((await api().get(`/api/payments-received/${d.match.id}`)).body.depositToAccountId).toBe(BANK);

    // an expense recorded by hand is suggested as a match for the rent line
    const rent = (await lines()).find((x) => x.description === 'Office rent Nov')!;
    const e = await api().post('/api/expenses').send({ date: '2026-11-04', accountId: 'acc_rent', amount: 25000, paidThroughAccountId: BANK });
    const s = (await api().get(`/api/banking/statement-lines/${rent.id}`)).body.suggestions;
    const hit = s.find((x: { sourceId: string }) => x.sourceId === e.body.id);
    expect(hit).toBeTruthy();
    const before = await balance(BANK);
    const mt = await api().post(`/api/banking/statement-lines/${rent.id}/match`).send({ journalId: hit.journalId });
    expect(mt.body.status).toBe('matched');
    expect(await balance(BANK)).toBe(before); // matching adds nothing to the books
    // the same transaction cannot be matched twice
    const other = (await lines('uncategorized'))[0];
    expect((await api().post(`/api/banking/statement-lines/${other.id}/match`).send({ journalId: hit.journalId })).body.error).toBeTruthy();
  });

  it('excludes and restores lines', async () => {
    const l = (await lines('uncategorized'))[0];
    await api().post(`/api/banking/statement-lines/${l.id}/exclude`).send({});
    expect((await lines('excluded')).map((x) => x.id)).toContain(l.id);
    await api().post(`/api/banking/statement-lines/${l.id}/restore`).send({});
    expect((await lines('uncategorized')).map((x) => x.id)).toContain(l.id);
  });
});

describe('rules', () => {
  it('auto-categorizes matching lines on import', async () => {
    expect((await api().post('/api/banking/rules').send({ name: 'x', applyTo: 'deposits', criteria: [{ field: 'description', op: 'contains', value: 'swiggy' }], recordAs: 'expense', offsetAccountId: 'acc_meals' })).body.error).toMatch(/cannot be used/);
    const r = await api().post('/api/banking/rules').send({ name: 'Food delivery', applyTo: 'withdrawals', markAs: 'categorized', match: 'any', criteria: [{ field: 'description', op: 'contains', value: 'swiggy' }, { field: 'description', op: 'contains', value: 'zomato' }], recordAs: 'expense', offsetAccountId: 'acc_meals' });
    expect(r.status).toBe(200);
    const s = await api().post('/api/banking/rules').send({ name: 'Bank charges', applyTo: 'withdrawals', criteria: [{ field: 'description', op: 'starts_with', value: 'chg' }], recordAs: 'expense', offsetAccountId: 'acc_bank_charges' });
    const imp = await api().post(`/api/banking/accounts/${BANK}/import`).send({ text: 'Date,Narration,Withdrawal,Deposit\n10/11/2026,UPI-SWIGGY-123,450,\n11/11/2026,CHG SMS alerts,15,\n12/11/2026,Zomato order,300,', fileName: 'r.csv' });
    expect(imp.body).toMatchObject({ imported: 3, categorized: 2, recognized: 1 });
    const all = await lines();
    expect(all.find((x) => x.description === 'UPI-SWIGGY-123')?.status).toBe('categorized');
    const chg = all.find((x) => x.description === 'CHG SMS alerts')!;
    expect(chg.status).toBe('uncategorized');
    expect(chg.ruleId).toBe(s.body.id);
    const applied = await api().post(`/api/banking/statement-lines/${chg.id}/apply-rule`).send({});
    expect(applied.body.status).toBe('categorized');
  });
});

describe('money in / out and transfers', () => {
  it('transfers between accounts', async () => {
    const bank = await balance(BANK);
    const cash = await balance('acc_petty_cash');
    expect((await api().post('/api/banking/transactions').send({ type: 'transfer_out', accountId: BANK, offsetAccountId: 'acc_rent', amount: 100, date: '2026-11-15' })).body.error).toMatch(/bank, cash or credit card/);
    const t = await api().post('/api/banking/transactions').send({ type: 'transfer_out', accountId: BANK, offsetAccountId: 'acc_petty_cash', amount: 2000, date: '2026-11-15', description: 'Cash for office' });
    expect(t.status).toBe(200);
    expect(await balance(BANK)).toBe(bank - 2000);
    expect(await balance('acc_petty_cash')).toBe(cash + 2000);
    const tx = (await api().get('/api/banking/accounts/acc_petty_cash/transactions')).body;
    expect(tx[0]).toMatchObject({ type: 'Transfer To Another Account', deposit: 2000 });
    await api().delete(`/api/banking/transactions/${t.body.id}`);
    expect(await balance(BANK)).toBe(bank);
  });

  it("records an owner's contribution and respects banking locks", async () => {
    const r = await api().post('/api/banking/transactions').send({ type: 'owner_contribution', accountId: BANK, offsetAccountId: 'acc_owners_equity', amount: 50000, date: '2026-11-16' });
    expect(r.body.error ?? r.status).toBe(200);
    await api().post('/api/transaction-locks/banking/lock').send({ date: '2026-11-20', reason: 'Closed' });
    expect((await api().put(`/api/banking/transactions/${r.body.id}`).send({ amount: 1 })).body.error).toMatch(/locked/);
    await api().post('/api/transaction-locks/banking/unlock').send({ reason: 'reopen' });
  });
});

describe('reconciliation', () => {
  it('reconciles when the difference is zero and can be undone', async () => {
    const r = await api().post(`/api/banking/accounts/${BANK}/reconciliations`).send({ startDate: '2026-04-01', endDate: '2026-11-30', closingBalance: 0 });
    expect(r.status).toBe(200);
    const v = (await api().get(`/api/banking/reconciliations/${r.body.id}`)).body;
    expect(v.entries.length).toBeGreaterThan(0);
    // closing balance = books balance through the end date
    await api().put(`/api/banking/reconciliations/${r.body.id}`).send({ closingBalance: v.booksBalance });
    expect((await api().post(`/api/banking/reconciliations/${r.body.id}/complete`).send({ cleared: [] })).body.error ?? '').toMatch(v.booksBalance ? /difference/ : /^$/);
    const done = await api().post(`/api/banking/reconciliations/${r.body.id}/complete`).send({ cleared: v.entries.map((e: { journalId: string }) => e.journalId) });
    expect(done.body.status).toBe('reconciled');
    expect((await api().post(`/api/banking/accounts/${BANK}/reconciliations`).send({ startDate: '2026-11-01', endDate: '2026-12-31', closingBalance: 0 })).body.error).toMatch(/reconciled through/);
    const tx = (await api().get(`/api/banking/accounts/${BANK}/transactions`)).body;
    expect(tx.filter((e: { date: string }) => e.date <= '2026-11-30').every((e: { reconciled: boolean }) => e.reconciled)).toBe(true);
    expect((await api().post(`/api/banking/reconciliations/${r.body.id}/undo`).send({})).body.status).toBe('draft');
    expect((await api().delete(`/api/banking/reconciliations/${r.body.id}`)).status).toBe(200);
  });
});

describe('overview', () => {
  it('lists banking accounts with books and statement balances', async () => {
    const o = (await api().get('/api/banking/overview').query({ period: 'this_month' })).body;
    const hdfc = o.accounts.find((a: { id: string }) => a.id === BANK);
    expect(hdfc.statementBalance).toBeUndefined(); // no balance column imported yet
    // newest-first statement with a balance column: the closing balance is the top row's balance
    const r = await api().post(`/api/banking/accounts/${BANK}/import`).send({ text: 'Date,Narration,Withdrawal,Deposit,Closing Balance\n21/11/2026,Fee,10,,"1,00,490.00"\n20/11/2026,Credit,,500,"1,00,500.00"', fileName: 'bal.csv' });
    expect(r.body.import.closingBalance).toBe(100490);
    const again = (await api().get(`/api/banking/accounts/${BANK}`)).body;
    expect(again.statementBalance).toBe(100490);
    expect(o.series.length).toBeGreaterThan(0);
    expect(o.accounts.every((a: { subType: string }) => ['bank', 'cash', 'credit_card', 'payment_clearing'].includes(a.subType))).toBe(true);
  });
});
