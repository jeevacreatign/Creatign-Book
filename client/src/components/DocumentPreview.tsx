// Printable document templates (Standard / Spreadsheet / Elite) for every transaction type.
import { DOC_META } from '@shared/docmeta';
import { fmtDate, money, num, frequencyLabel } from '@shared/format';
import type { Address, Contact, Organization, PaymentReceived, PaymentMade, TxnDoc } from '@shared/types';
import { PAYMENT_TERMS } from '@shared/types';
import { clsx } from './ui';

export type Template = 'standard' | 'spreadsheet' | 'elite';
export const TEMPLATES: { value: Template; label: string }[] = [
  { value: 'standard', label: 'Standard Template' },
  { value: 'spreadsheet', label: 'Spreadsheet Template' },
  { value: 'elite', label: 'Elite Template' },
];

export function AddressBlock({ a }: { a?: Address }) {
  if (!a) return null;
  const lines = [a.attention, a.street1, a.street2, [a.city, a.pin].filter(Boolean).join(' '), a.state, a.country, a.phone].filter(Boolean);
  if (!lines.length) return <div className="text-slate-400">-</div>;
  return (
    <div className="leading-5">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

function OrgHeader({ org, title, number, template }: { org: Organization; title: string; number: string; template: Template }) {
  return (
    <div className={clsx('flex items-start justify-between pb-6', template === 'elite' && '-mx-10 -mt-10 mb-6 bg-ink-900 px-10 pt-10 text-white')}>
      <div className="flex items-start gap-3">
        <div className={clsx('flex h-12 w-12 items-center justify-center rounded-lg text-xl font-bold', template === 'elite' ? 'bg-white text-ink-900' : 'bg-brand-600 text-white')}>{org.logoText || org.name[0]}</div>
        <div>
          <div className="text-base font-bold">{org.name}</div>
          <div className={clsx('text-xs leading-5', template === 'elite' ? 'text-slate-300' : 'text-slate-600')}>
            {org.address?.street1 && <div>{org.address.street1}</div>}
            <div>
              {org.state}, {org.country}
            </div>
            <div>{org.email}</div>
            {org.gstin && <div>GSTIN {org.gstin}</div>}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={clsx('text-2xl font-semibold tracking-wide', template === 'elite' ? 'text-white' : 'text-slate-800')}>{title}</div>
        <div className={clsx('mt-1 text-sm', template === 'elite' ? 'text-slate-300' : 'text-slate-600')}># {number}</div>
      </div>
    </div>
  );
}

export function DocumentPreview({ doc, org, contact, template = 'standard' }: { doc: TxnDoc; org: Organization; contact?: Contact; template?: Template }) {
  const meta = DOC_META[doc.kind];
  const sales = meta.side === 'sales';
  const showBalance = doc.kind === 'invoice' || doc.kind === 'bill';
  const rows: [string, string | undefined][] = [
    [meta.dateLabel, fmtDate(doc.date)],
    ['Terms', PAYMENT_TERMS.find((t) => t.value === doc.paymentTerms)?.label],
    ['Due Date', fmtDate(doc.dueDate)],
    ['Expiry Date', fmtDate(doc.expiryDate)],
    ['Expected Shipment', fmtDate(doc.expectedShipmentDate)],
    ['Delivery Date', fmtDate(doc.deliveryDate)],
    ['Reference#', doc.referenceNumber],
    ['Order Number', doc.orderNumber],
    ['Challan Type', doc.challanType],
    ['Delivery Method', doc.deliveryMethod],
    ['Salesperson', doc.salesperson],
    ['Frequency', doc.repeatEvery ? frequencyLabel(doc.repeatEvery) : undefined],
  ];
  const adj = Math.round((doc.total - (doc.subTotal - doc.discountAmount - doc.tdsAmount + doc.tcsAmount)) * 100) / 100;
  const grid = template === 'spreadsheet';
  return (
    <div className="print-area mx-auto max-w-[820px] bg-white p-10 text-[12.5px] text-slate-800 shadow-sm ring-1 ring-slate-200">
      {doc.status === 'void' && <div className="mb-4 rounded border border-slate-300 bg-slate-50 py-1 text-center text-xs font-bold tracking-widest text-slate-500">VOID</div>}
      <OrgHeader org={org} title={meta.title} number={doc.number || doc.profileName || ''} template={template} />
      <div className="flex justify-between gap-6 pb-6">
        <div className="flex gap-10">
          <div>
            <div className="mb-1 text-xs text-slate-500">{sales ? 'Bill To' : 'Vendor Address'}</div>
            <div className="font-semibold text-brand-700">{contact?.displayName}</div>
            <AddressBlock a={doc.billingAddress} />
          </div>
          {sales && doc.shippingAddress && Object.values(doc.shippingAddress).some(Boolean) && (
            <div>
              <div className="mb-1 text-xs text-slate-500">Ship To</div>
              <AddressBlock a={doc.shippingAddress} />
            </div>
          )}
          {doc.kind === 'purchase_order' && (
            <div>
              <div className="mb-1 text-xs text-slate-500">Deliver To</div>
              <div>{doc.deliveryAddressType === 'customer' ? 'Customer address' : org.name}</div>
              <div className="text-xs text-slate-600">
                {org.state}, {org.country}
              </div>
            </div>
          )}
        </div>
        <table className="h-fit text-right text-xs">
          <tbody>
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-4 text-slate-500">{k} :</td>
                  <td className="font-medium">{v}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {doc.subject && (
        <div className="mb-4">
          <div className="text-xs text-slate-500">Subject :</div>
          <div>{doc.subject}</div>
        </div>
      )}
      <table className={clsx('w-full text-left', grid && 'border border-slate-300')}>
        <thead>
          <tr className={clsx(template === 'elite' ? 'bg-ink-900 text-white' : 'bg-slate-700 text-white', grid && 'bg-slate-100 text-slate-700')}>
            <th className={clsx('w-10 px-2 py-2 text-xs font-medium', grid && 'border border-slate-300')}>#</th>
            <th className={clsx('px-2 py-2 text-xs font-medium', grid && 'border border-slate-300')}>Item & Description</th>
            <th className={clsx('w-20 px-2 py-2 text-right text-xs font-medium', grid && 'border border-slate-300')}>Qty</th>
            <th className={clsx('w-28 px-2 py-2 text-right text-xs font-medium', grid && 'border border-slate-300')}>Rate</th>
            {doc.lineItems.some((l) => l.discountPercent) && <th className="w-20 px-2 py-2 text-right text-xs font-medium">Discount</th>}
            <th className={clsx('w-32 px-2 py-2 text-right text-xs font-medium', grid && 'border border-slate-300')}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.lineItems.map((l, i) => (
            <tr key={l.id} className="border-b border-slate-200">
              <td className={clsx('px-2 py-2 align-top', grid && 'border border-slate-300')}>{i + 1}</td>
              <td className={clsx('px-2 py-2', grid && 'border border-slate-300')}>
                <div>{l.name}</div>
                {l.description && <div className="text-xs text-slate-500">{l.description}</div>}
              </td>
              <td className={clsx('px-2 py-2 text-right align-top', grid && 'border border-slate-300')}>
                {num(l.quantity).replace(/\.00$/, '')}
                {l.unit && <div className="text-xxs text-slate-500">{l.unit}</div>}
              </td>
              <td className={clsx('px-2 py-2 text-right align-top', grid && 'border border-slate-300')}>{num(l.rate)}</td>
              {doc.lineItems.some((x) => x.discountPercent) && <td className="px-2 py-2 text-right align-top">{l.discountPercent ? `${l.discountPercent}%` : '-'}</td>}
              <td className={clsx('px-2 py-2 text-right align-top', grid && 'border border-slate-300')}>{num(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex justify-end">
        <table className="w-72 text-sm">
          <tbody>
            <TotalRow k="Sub Total" v={doc.subTotal} />
            {doc.discountAmount > 0 && <TotalRow k={`Discount (${doc.discountPercent}%)`} v={-doc.discountAmount} />}
            {doc.tdsAmount > 0 && <TotalRow k={`TDS (${doc.tdsRate}%)`} v={-doc.tdsAmount} />}
            {doc.tcsAmount > 0 && <TotalRow k={`TCS (${doc.tcsRate}%)`} v={doc.tcsAmount} />}
            {adj !== 0 && <TotalRow k={doc.adjustmentLabel || 'Adjustment'} v={adj} />}
            <tr className="border-t border-slate-300 font-bold">
              <td className="py-2">Total</td>
              <td className="py-2 text-right">{money(doc.total)}</td>
            </tr>
            {showBalance && (doc.amountPaid ?? 0) > 0 && <TotalRow k="Payment Made" v={-(doc.amountPaid ?? 0)} className="text-red-600" />}
            {showBalance && (
              <tr className="bg-slate-100 font-bold">
                <td className="px-2 py-2">Balance Due</td>
                <td className="px-2 py-2 text-right">{money(doc.balance)}</td>
              </tr>
            )}
            {(doc.kind === 'credit_note' || doc.kind === 'vendor_credit') && (
              <tr className="bg-slate-100 font-bold">
                <td className="px-2 py-2">Credits Remaining</td>
                <td className="px-2 py-2 text-right">{money(doc.balance)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-8 space-y-4 text-xs">
        {(doc.customerNotes || doc.notes) && (
          <div>
            <div className="mb-1 text-slate-500">Notes</div>
            <div className="whitespace-pre-wrap">{doc.customerNotes || doc.notes}</div>
          </div>
        )}
        {doc.terms && (
          <div>
            <div className="mb-1 text-slate-500">Terms & Conditions</div>
            <div className="whitespace-pre-wrap">{doc.terms}</div>
          </div>
        )}
        <div className="pt-10 text-right text-slate-500">Authorized Signature ____________________</div>
      </div>
    </div>
  );
}

function TotalRow({ k, v, className }: { k: string; v: number; className?: string }) {
  return (
    <tr className={className}>
      <td className="py-1 text-slate-600">{k}</td>
      <td className="py-1 text-right tabular-nums">{money(v)}</td>
    </tr>
  );
}

export function ReceiptPreview({ payment, org, contact, kind, rows, template = 'elite' }: { payment: PaymentReceived | PaymentMade; org: Organization; contact?: Contact; kind: 'received' | 'made'; rows: { number: string; date: string; total: number; amount: number }[]; template?: Template }) {
  return (
    <div className="print-area mx-auto max-w-[820px] bg-white p-10 text-[12.5px] text-slate-800 shadow-sm ring-1 ring-slate-200">
      <OrgHeader org={org} title={kind === 'received' ? 'PAYMENT RECEIPT' : 'PAYMENTS MADE'} number={payment.number} template={template} />
      <div className="flex items-start justify-between gap-8">
        <table className="text-sm">
          <tbody>
            <KVRow k="Payment Date" v={fmtDate(payment.date)} />
            <KVRow k="Reference Number" v={payment.referenceNumber || '-'} />
            <KVRow k="Payment Mode" v={payment.mode} />
            {'tdsDeducted' in payment && payment.tdsDeducted && <KVRow k="TDS Deducted" v={money(payment.tdsAmount)} />}
          </tbody>
        </table>
        <div className="w-56 rounded-md bg-emerald-600 p-5 text-center text-white">
          <div className="text-xs">{kind === 'received' ? 'Amount Received' : 'Amount Paid'}</div>
          <div className="mt-1 text-xl font-bold">{money(payment.amount)}</div>
        </div>
      </div>
      <div className="mt-6">
        <div className="text-xs text-slate-500">{kind === 'received' ? 'Received From' : 'Paid To'}</div>
        <div className="font-semibold text-brand-700">{contact?.displayName}</div>
        <AddressBlock a={contact?.billingAddress} />
      </div>
      {rows.length > 0 && (
        <div className="mt-8">
          <div className="mb-2 font-semibold">Payment for</div>
          <table className="table border border-slate-200">
            <thead>
              <tr>
                <th>{kind === 'received' ? 'Invoice Number' : 'Bill Number'}</th>
                <th>{kind === 'received' ? 'Invoice Date' : 'Bill Date'}</th>
                <th className="text-right">{kind === 'received' ? 'Invoice Amount' : 'Bill Amount'}</th>
                <th className="text-right">Payment Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.number}>
                  <td>{r.number}</td>
                  <td>{fmtDate(r.date)}</td>
                  <td className="text-right">{money(r.total)}</td>
                  <td className="text-right">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {'unusedAmount' in payment && payment.unusedAmount > 0 && <div className="mt-4 text-right text-sm">Amount in Excess: {money(payment.unusedAmount)}</div>}
      <div className="pt-16 text-right text-xs text-slate-500">Authorized Signature ____________________</div>
    </div>
  );
}

function KVRow({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td className="py-1 pr-6 text-slate-500">{k}</td>
      <td className="py-1 font-medium">{v}</td>
    </tr>
  );
}
