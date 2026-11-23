import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Pencil, Mail, Share2, FileText, Printer, ChevronDown, MoreHorizontal, X, Lock, Unlock, Copy, Trash2, Ban, BookOpen, Repeat, Bell, CreditCard, Truck, ArrowRightLeft, CheckCircle2, RotateCcw, Paperclip, MessageSquare } from 'lucide-react';
import { DOC_META } from '@shared/docmeta';
import { fmtDate, fmtDateTime, frequencyLabel, money, today } from '@shared/format';
import { PAYMENT_MODES, PAYMENT_TERMS, type Contact, type DocKind, type Journal, type TxnDoc } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { AccountSelect, DateInput, Dropdown, Field, KV, MenuItem, Modal, MoneyInput, Pill, Select, Spinner, Status, Tabs, clsx, useConfirm } from '../../components/ui';
import { EmailModal, JournalTable, ShareModal, Timeline, Comments } from '../../components/shared';
import { AddressBlock, DocumentPreview, TEMPLATES, type Template } from '../../components/DocumentPreview';

type Related = {
  quote?: TxnDoc;
  salesOrder?: TxnDoc;
  deliveryChallan?: TxnDoc;
  purchaseOrder?: TxnDoc;
  invoice?: TxnDoc;
  profile?: TxnDoc;
  children: TxnDoc[];
  payments: { id: string; number: string; date: string; mode: string; status: string; amount: number }[];
  creditsApplied: { id: string; creditId: string; creditNumber: string; amount: number; date: string }[];
  appliedTo: { id: string; invoiceId: string; number?: string; amount: number; date: string }[];
};
export type DocDetailData = TxnDoc & { contactName: string; contact?: Contact; related: Related; journals: Journal[] };

const pdfLabel = (k: DocKind) => `${DOC_META[k].label.replace('Recurring ', '')} PDF`;

export function DocDetail({ kind }: { kind: DocKind }) {
  const { id } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const { organization: org, accounts } = useBoot();
  const meta = DOC_META[kind];
  const { data: d, isLoading, error } = useApi<DocDetailData>(`/docs/${id}`);
  const [tab, setTab] = useState<string>('document');
  const [template, setTemplate] = useState<Template>('standard');
  const [emailOpen, setEmailOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [modal, setModal] = useState<null | 'refund' | 'apply' | 'writeoff' | 'expected' | 'cancelItems'>(null);
  const confirm = useConfirm();
  const act = useAction((a: { action: string; body?: unknown }) => api<TxnDoc>(`/docs/${id}/actions/${a.action}`, { body: a.body || {} }), 'Done');
  const del = useAction(() => api(`/docs/${id}`, { method: 'DELETE' }), `${meta.label} deleted`);

  useEffect(() => {
    setTab(meta.recurring ? 'overview' : 'document');
  }, [id, meta.recurring]);
  useEffect(() => {
    if (search.get('send') === '1' && d) {
      setEmailOpen(true);
      search.delete('send');
      setSearch(search, { replace: true });
    }
  }, [search, d, setSearch]);

  if (isLoading) return <Spinner />;
  if (error || !d) return <div className="p-8 text-red-600">{(error as Error)?.message || 'Not found'}</div>;

  const run = (action: string, body?: unknown) => act.mutate({ action, body });
  const sales = meta.side === 'sales';
  const posted = !['draft', 'void'].includes(d.status);
  const unpaid = ['open', 'sent', 'overdue', 'due_today', 'partially_paid'].includes(d.status);
  const convert = (to: DocKind) => navigate(`${DOC_META[to].path}/new?from=${d.id}`);
  const lockItem = (
    <MenuItem icon={d.locked ? <Unlock size={13} /> : <Lock size={13} />} onClick={() => run(d.locked ? 'unlock' : 'lock')}>
      {d.locked ? `Unlock ${meta.label}` : `Lock ${meta.label}`}
    </MenuItem>
  );
  const cloneItem = (
    <MenuItem icon={<Copy size={13} />} onClick={() => convert(kind)}>
      Clone
    </MenuItem>
  );
  const deleteItem = (
    <MenuItem
      danger
      icon={<Trash2 size={13} />}
      onClick={() =>
        confirm.ask(`Delete ${meta.label}`, `${meta.label} ${d.number || d.profileName} will be deleted permanently. This cannot be undone.`, () => del.mutate(undefined, { onSuccess: () => navigate(meta.path) }), { danger: true, label: 'Delete' })
      }
    >
      Delete
    </MenuItem>
  );
  const voidItem = (
    <MenuItem icon={<Ban size={13} />} onClick={() => confirm.ask(`Void ${meta.label}`, `Voiding ${d.number} removes it from your books. The document stays for reference.`, () => run('void'), { danger: true, label: 'Void' })}>
      Void
    </MenuItem>
  );
  const journalItem = meta.posts ? (
    <MenuItem icon={<BookOpen size={13} />} onClick={() => setTab('journal')}>
      View Journal
    </MenuItem>
  ) : null;
  const prefsItem = (
    <MenuItem icon={<FileText size={13} />} onClick={() => navigate('/settings/preferences')}>
      {meta.label} Preferences
    </MenuItem>
  );

  // ------------------------------------------------------------ toolbar (per document type)
  const primary: ReactNode[] = [];
  let more: ReactNode = null;
  switch (kind) {
    case 'quote':
      if (d.status === 'draft' || d.status === 'sent')
        primary.push(
          <Dropdown key="mark" button={() => <ToolbarBtn icon={<CheckCircle2 size={14} />}>Mark as <ChevronDown size={12} /></ToolbarBtn>}>
            {d.status === 'draft' && <MenuItem onClick={() => run('mark_sent')}>Mark as Sent</MenuItem>}
            <MenuItem onClick={() => run('accept')}>Mark as Accepted</MenuItem>
            <MenuItem onClick={() => run('decline')}>Mark as Declined</MenuItem>
          </Dropdown>,
        );
      if (d.status !== 'invoiced' && d.status !== 'declined') primary.push(<ToolbarBtn key="inv" icon={<ArrowRightLeft size={14} />} onClick={() => convert('invoice')}>Convert to Invoice</ToolbarBtn>);
      more = (
        <>
          {d.status !== 'invoiced' && <MenuItem onClick={() => convert('sales_order')}>Convert to Sales Order</MenuItem>}
          {cloneItem}
          {deleteItem}
          {lockItem}
          {prefsItem}
        </>
      );
      break;
    case 'sales_order':
      if (d.status === 'draft') primary.push(<ToolbarBtn key="conf" icon={<CheckCircle2 size={14} />} onClick={() => run('confirm')}>Mark as Confirmed</ToolbarBtn>);
      if (d.status !== 'void' && d.invoiceStatus !== 'invoiced') primary.push(<ToolbarBtn key="inv" icon={<ArrowRightLeft size={14} />} onClick={() => convert('invoice')}>Convert to Invoice</ToolbarBtn>);
      more = (
        <>
          <MenuItem onClick={() => convert('purchase_order')}>Convert to Purchase Order</MenuItem>
          {d.shipmentStatus === 'fulfilled' ? <MenuItem icon={<RotateCcw size={13} />} onClick={() => run('undo_fulfillment')}>Undo Fulfillment</MenuItem> : <MenuItem icon={<Truck size={13} />} onClick={() => run('fulfill')}>Mark as Fulfilled</MenuItem>}
          <MenuItem onClick={() => setModal('cancelItems')}>Cancel Items</MenuItem>
          {d.status !== 'void' && voidItem}
          {cloneItem}
          {deleteItem}
          {lockItem}
        </>
      );
      break;
    case 'invoice':
      if (d.status === 'draft') primary.push(<ToolbarBtn key="sent" icon={<CheckCircle2 size={14} />} onClick={() => run('mark_sent')}>Mark as Sent</ToolbarBtn>);
      if (unpaid)
        primary.push(
          <Dropdown key="rem" button={() => <ToolbarBtn icon={<Bell size={14} />}>Reminders <ChevronDown size={12} /></ToolbarBtn>}>
            <MenuItem onClick={() => setEmailOpen(true)}>Send Email</MenuItem>
            <MenuItem onClick={() => run(d.remindersStopped ? 'enable_reminders' : 'stop_reminders')}>{d.remindersStopped ? 'Enable Reminders' : 'Stop Reminders'}</MenuItem>
            <MenuItem onClick={() => setModal('expected')}>Expected Payment Date</MenuItem>
          </Dropdown>,
          <Dropdown key="pay" button={() => <ToolbarBtn icon={<CreditCard size={14} />}>Record Payment <ChevronDown size={12} /></ToolbarBtn>}>
            <MenuItem onClick={() => navigate(`/sales/payments-received/new?invoiceId=${d.id}&contactId=${d.contactId}`)}>Record Payment</MenuItem>
            <MenuItem onClick={() => setModal('writeoff')}>Write Off</MenuItem>
          </Dropdown>,
        );
      if (d.writeOff) primary.push(<ToolbarBtn key="cwo" onClick={() => run('cancel_write_off')}>Cancel Write Off</ToolbarBtn>);
      more = (
        <>
          <MenuItem icon={<Repeat size={13} />} onClick={() => convert('recurring_invoice')}>Make Recurring</MenuItem>
          {posted && <MenuItem onClick={() => convert('credit_note')}>Create Credit Note</MenuItem>}
          {posted && <MenuItem onClick={() => navigate(`/sales/invoices/new?from=${d.id}`)}>Create Debit Note</MenuItem>}
          {cloneItem}
          {d.status !== 'void' && voidItem}
          {journalItem}
          {deleteItem}
          {lockItem}
          {prefsItem}
        </>
      );
      break;
    case 'delivery_challan':
      if (d.status === 'draft') primary.push(<ToolbarBtn key="open" onClick={() => run('convert_to_open')}>Convert to Open</ToolbarBtn>);
      if (d.status === 'open') primary.push(<ToolbarBtn key="del" icon={<Truck size={14} />} onClick={() => run('mark_delivered')}>Mark as Delivered</ToolbarBtn>);
      if (d.status !== 'void' && d.invoiceStatus !== 'invoiced') primary.push(<ToolbarBtn key="inv" icon={<ArrowRightLeft size={14} />} onClick={() => convert('invoice')}>Convert to Invoice</ToolbarBtn>);
      more = (
        <>
          {d.status === 'delivered' && <MenuItem onClick={() => run('revert_to_open')}>Revert to Open</MenuItem>}
          {cloneItem}
          {d.status !== 'void' && voidItem}
          {deleteItem}
          {lockItem}
        </>
      );
      break;
    case 'credit_note':
    case 'vendor_credit':
      if (d.status === 'draft') primary.push(<ToolbarBtn key="open" onClick={() => run('convert_to_open')}>Convert to Open</ToolbarBtn>);
      if (d.status === 'open') primary.push(<ToolbarBtn key="apply" onClick={() => setModal('apply')}>Apply to {sales ? 'Invoices' : 'Bills'}</ToolbarBtn>, <ToolbarBtn key="refund" onClick={() => setModal('refund')}>Refund</ToolbarBtn>);
      more = (
        <>
          {cloneItem}
          {d.status !== 'void' && voidItem}
          {journalItem}
          {deleteItem}
          {lockItem}
        </>
      );
      break;
    case 'purchase_order':
      if (d.status === 'draft') primary.push(<ToolbarBtn key="issue" onClick={() => run('mark_sent')}>Mark as Issued</ToolbarBtn>);
      if (d.status !== 'cancelled' && !d.received) primary.push(<ToolbarBtn key="recv" icon={<Truck size={14} />} onClick={() => run('mark_received')}>Receive Goods</ToolbarBtn>);
      if (d.status !== 'cancelled' && d.billedStatus !== 'billed') primary.push(<ToolbarBtn key="bill" icon={<ArrowRightLeft size={14} />} onClick={() => convert('bill')}>Convert to Bill</ToolbarBtn>);
      more = (
        <>
          {cloneItem}
          {d.status === 'cancelled' ? <MenuItem onClick={() => run('reopen')}>Reopen</MenuItem> : <MenuItem icon={<Ban size={13} />} onClick={() => run('cancel')}>Mark as Cancelled</MenuItem>}
          {deleteItem}
          {lockItem}
        </>
      );
      break;
    case 'bill':
      if (d.status === 'draft') primary.push(<ToolbarBtn key="open" onClick={() => run('convert_to_open')}>Convert to Open</ToolbarBtn>);
      if (unpaid) primary.push(<ToolbarBtn key="pay" icon={<CreditCard size={14} />} onClick={() => navigate(`/purchases/payments-made/new?billId=${d.id}&contactId=${d.contactId}`)}>Record Payment</ToolbarBtn>);
      more = (
        <>
          <MenuItem icon={<Repeat size={13} />} onClick={() => convert('recurring_bill')}>Make Recurring</MenuItem>
          {posted && <MenuItem onClick={() => convert('vendor_credit')}>Create Vendor Credits</MenuItem>}
          {cloneItem}
          {d.status !== 'void' && voidItem}
          {journalItem}
          {deleteItem}
          {lockItem}
        </>
      );
      break;
    case 'recurring_invoice':
    case 'recurring_bill':
      primary.push(<ToolbarBtn key="new" icon={<FileText size={14} />} onClick={() => run('create_child')}>Create {kind === 'recurring_invoice' ? 'Invoice' : 'Bill'}</ToolbarBtn>);
      primary.push(d.status === 'active' ? <ToolbarBtn key="stop" onClick={() => run('stop')}>Stop</ToolbarBtn> : <ToolbarBtn key="resume" onClick={() => run('resume')}>Resume</ToolbarBtn>);
      more = (
        <>
          {cloneItem}
          {deleteItem}
        </>
      );
      break;
  }

  const tabs: { value: string; label: string }[] = meta.recurring
    ? [
        { value: 'overview', label: 'Overview' },
        { value: 'activity', label: 'Recent Activities' },
      ]
    : [
        { value: 'document', label: kind === 'quote' ? 'Quote Details' : 'Details' },
        ...(kind === 'quote' || kind === 'sales_order' || kind === 'delivery_challan' ? [{ value: 'invoices', label: 'Invoices' }] : []),
        ...(kind === 'purchase_order' ? [{ value: 'invoices', label: 'Bills' }] : []),
        ...(kind === 'invoice' || kind === 'bill' ? [{ value: 'payments', label: 'Payments' }] : []),
        ...(kind === 'credit_note' || kind === 'vendor_credit' ? [{ value: 'payments', label: sales ? 'Invoices Credited' : 'Bills Credited' }] : []),
        ...(meta.posts ? [{ value: 'journal', label: 'Journal' }] : []),
        { value: 'comments', label: 'Comments' },
        { value: 'activity', label: 'Activity' },
      ];

  const contactEmail = d.contact?.email;
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="no-print flex items-center justify-between border-b border-slate-200 px-5 py-2.5">
        <div className="min-w-0">
          <div className="text-xs text-slate-500">{d.contactName}</div>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg">{meta.recurring ? d.profileName : d.number}</h1>
            {d.locked && <Lock size={14} className="text-amber-600" aria-label="Locked" />}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost w-8 px-0" title="Attachments" onClick={() => setTab('document')}>
            <Paperclip size={15} />
            {d.attachments.length > 0 && <span className="text-xxs">{d.attachments.length}</span>}
          </button>
          <button className="btn-ghost w-8 px-0" title="Comments" onClick={() => setTab('comments')}>
            <MessageSquare size={15} />
          </button>
          <button className="btn-ghost w-8 px-0 hover:text-red-500" title="Close" onClick={() => navigate(meta.path)}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="no-print flex flex-wrap items-center border-b border-slate-200 bg-slate-50/60 px-3 text-[13px]">
        {!d.locked && d.status !== 'void' && (
          <ToolbarBtn icon={<Pencil size={14} />} onClick={() => navigate(`${meta.path}/${d.id}/edit`)}>
            Edit
          </ToolbarBtn>
        )}
        {!meta.recurring && (
          <Dropdown button={() => <ToolbarBtn icon={<Mail size={14} />}>Send <ChevronDown size={12} /></ToolbarBtn>}>
            <MenuItem onClick={() => setEmailOpen(true)}>Send Email</MenuItem>
            {(kind === 'quote' || kind === 'invoice') && <MenuItem onClick={() => setShareOpen(true)}>Share Link</MenuItem>}
          </Dropdown>
        )}
        {(kind === 'quote' || kind === 'invoice' || kind === 'sales_order' || kind === 'credit_note') && (
          <ToolbarBtn icon={<Share2 size={14} />} onClick={() => setShareOpen(true)}>
            Share
          </ToolbarBtn>
        )}
        {!meta.recurring && (
          <Dropdown button={() => <ToolbarBtn icon={<FileText size={14} />}>PDF/Print <ChevronDown size={12} /></ToolbarBtn>}>
            <MenuItem icon={<FileText size={13} />} onClick={() => window.open(`/print/doc/${d.id}?template=${template}`, '_blank')}>
              PDF
            </MenuItem>
            <MenuItem icon={<Printer size={13} />} onClick={() => window.open(`/print/doc/${d.id}?template=${template}&auto=1`, '_blank')}>
              Print
            </MenuItem>
          </Dropdown>
        )}
        {primary}
        <Dropdown align="right" button={() => <button className="btn-ghost h-9 rounded-none border-x border-slate-200 px-2.5" aria-label="More"><MoreHorizontal size={16} /></button>}>
          {more}
        </Dropdown>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {d.related.salesOrder && kind === 'invoice' && (
          <details className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium">Associated sales orders (1)</summary>
            <div className="mt-2 flex items-center gap-4 text-[13px]">
              <Link className="link" to={`/sales/sales-orders/${d.related.salesOrder.id}`}>
                {d.related.salesOrder.number}
              </Link>
              <span>{fmtDate(d.related.salesOrder.date)}</span>
              <Status status={d.related.salesOrder.status} />
              <span>{money(d.related.salesOrder.total)}</span>
            </div>
          </details>
        )}
        {kind === 'sales_order' && (
          <div className="mb-3 flex flex-wrap gap-6 rounded-md border border-slate-200 px-4 py-2.5 text-[13px]">
            <span>
              Order Status: <Status status={d.status} />
            </span>
            <span>
              Invoice: <Status status={d.invoiceStatus || 'not_invoiced'} />
            </span>
            <span>
              Payment: <Status status={d.paymentStatus || 'unpaid'} />
            </span>
            <span>
              Shipment: <Status status={d.shipmentStatus || 'pending'} />
            </span>
          </div>
        )}
        {kind === 'invoice' && unpaid && (
          <div className="mb-3 flex items-center justify-between rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px]">
            <span>
              <span className="font-semibold">What's next?</span> {d.sentAt ? 'Record the payment once you receive it.' : 'Send this invoice to your customer or record a payment for it.'}
            </span>
            <span className="flex gap-2">
              {!d.sentAt && (
                <button className="btn-secondary btn-sm" onClick={() => setEmailOpen(true)}>
                  Send Invoice
                </button>
              )}
              <button className="btn-primary btn-sm" onClick={() => navigate(`/sales/payments-received/new?invoiceId=${d.id}&contactId=${d.contactId}`)}>
                Record Payment
              </button>
            </span>
          </div>
        )}
        {d.writeOff && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-[13px]">Written off {money(d.writeOff.amount)} on {fmtDate(d.writeOff.date)}{d.writeOff.reason ? ` · ${d.writeOff.reason}` : ''}</div>}

        <Tabs tabs={tabs} value={tab} onChange={setTab} className="no-print mb-4" />

        {tab === 'document' && (
          <div className="space-y-4">
            <div className="no-print flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pill status={d.status} />
                {d.sentAt && <span className="text-xs text-slate-500">Sent {fmtDateTime(d.sentAt)}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                PDF Template:
                <Select className="h-7 w-48 text-xs" value={template} onChange={(e) => setTemplate(e.target.value as Template)} options={TEMPLATES} />
              </div>
            </div>
            <DocumentPreview doc={d} org={org} contact={d.contact} template={template} />
            <MoreInformation d={d} />
          </div>
        )}
        {tab === 'overview' && <RecurringOverview d={d} />}
        {tab === 'invoices' && <ChildList docs={d.related.children.filter((c) => c.kind === (kind === 'purchase_order' ? 'bill' : 'invoice') || (kind === 'quote' && c.kind === 'sales_order'))} />}
        {tab === 'payments' && <PaymentsTab d={d} kind={kind} />}
        {tab === 'journal' && <JournalTable journals={d.journals} />}
        {tab === 'comments' && <Comments entityType={kind} entityId={d.id} />}
        {tab === 'activity' && <Timeline entityId={d.id} />}
      </div>

      {emailOpen && (
        <EmailModal
          open
          onClose={() => setEmailOpen(false)}
          title={`Email To ${d.contactName}`}
          to={contactEmail ? [contactEmail] : d.emailRecipients}
          subject={`${meta.label} - ${d.number} from ${org.name}`}
          body={`Dear ${d.contactName},\n\nThank you for your business. Your ${meta.label.toLowerCase()} ${d.number} can be viewed, printed and downloaded as PDF from the link below.\n\n${meta.label.toUpperCase()} AMOUNT: ${money(d.total)}${d.dueDate ? `\nDUE DATE: ${fmtDate(d.dueDate)}` : ''}\n\nRegards,\n${org.name}`}
          contactId={d.contactId}
          entityType={kind}
          entityId={d.id}
          showPayNow={kind === 'invoice' && unpaid}
          attachmentOptions={[{ key: 'pdf', label: `Attach ${pdfLabel(kind)}` }]}
        />
      )}
      {shareOpen && <ShareModal open onClose={() => setShareOpen(false)} entityType={kind} entityId={d.id} title={meta.label} />}
      {modal === 'refund' && <RefundModal d={d} onClose={() => setModal(null)} accounts={accounts} />}
      {modal === 'apply' && <ApplyCreditsModal d={d} onClose={() => setModal(null)} />}
      {modal === 'writeoff' && (
        <WriteOffModal
          d={d}
          onClose={() => setModal(null)}
          onSubmit={(body) => {
            run('write_off', body);
            setModal(null);
          }}
        />
      )}
      {modal === 'expected' && (
        <ExpectedDateModal
          d={d}
          onClose={() => setModal(null)}
          onSubmit={(date) => {
            run('expected_payment_date', { date });
            setModal(null);
          }}
        />
      )}
      {modal === 'cancelItems' && (
        <CancelItemsModal
          d={d}
          onClose={() => setModal(null)}
          onSubmit={(lineIds) => {
            run('cancel_items', { lineIds });
            setModal(null);
          }}
        />
      )}
      {confirm.node}
    </div>
  );
}

function ToolbarBtn({ children, icon, onClick }: { children: ReactNode; icon?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-1.5 border-r border-slate-200 px-3 text-slate-700 hover:bg-white hover:text-brand-700">
      {icon}
      {children}
    </button>
  );
}

function MoreInformation({ d }: { d: DocDetailData }) {
  const r = d.related;
  const links: { label: string; doc?: TxnDoc }[] = [
    { label: 'Quote', doc: r.quote },
    { label: 'Sales Order', doc: r.salesOrder },
    { label: 'Delivery Challan', doc: r.deliveryChallan },
    { label: 'Purchase Order', doc: r.purchaseOrder },
    { label: 'Invoice', doc: r.invoice },
    { label: 'Recurring Profile', doc: r.profile },
  ];
  const shown = links.filter((l) => l.doc);
  return (
    <div className="no-print mx-auto max-w-[820px] rounded-md border border-slate-200 p-4">
      <div className="mb-2 font-semibold">More Information</div>
      <div className="grid gap-x-8 md:grid-cols-2">
        <KV k="Salesperson" v={d.salesperson} />
        <KV k="Project" v={d.projectName} />
        <KV k="Payment Terms" v={PAYMENT_TERMS.find((t) => t.value === d.paymentTerms)?.label} />
        <KV k="Expected Payment" v={fmtDate(d.expectedPaymentDate)} />
        {shown.map((l) => (
          <KV
            key={l.label}
            k={`Associated ${l.label}`}
            v={
              <Link className="link" to={`${DOC_META[l.doc!.kind].path}/${l.doc!.id}`}>
                {l.doc!.number || l.doc!.profileName}
              </Link>
            }
          />
        ))}
        <KV k="Email Recipients" v={d.emailRecipients.join(', ')} />
      </div>
      {d.attachments.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Attachments</div>
          {d.attachments.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="link mr-4 inline-flex items-center gap-1 text-[13px]">
              <Paperclip size={12} /> {a.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ChildList({ docs }: { docs: TxnDoc[] }) {
  const navigate = useNavigate();
  if (!docs.length) return <div className="py-8 text-center text-slate-400">No associated documents yet.</div>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Number</th>
          <th>Type</th>
          <th>Status</th>
          <th className="text-right">Amount</th>
          <th className="text-right">Balance</th>
        </tr>
      </thead>
      <tbody>
        {docs.map((c) => (
          <tr key={c.id} className="row-link" onClick={() => navigate(`${DOC_META[c.kind].path}/${c.id}`)}>
            <td>{fmtDate(c.date)}</td>
            <td className="text-brand-600">{c.number}</td>
            <td>
              {DOC_META[c.kind].label}
              {c.manuallyAdded && <span className="ml-1 text-xxs text-slate-400">(Manually Added)</span>}
            </td>
            <td>
              <Status status={c.status} dueDate={c.dueDate} />
            </td>
            <td className="text-right">{money(c.total)}</td>
            <td className="text-right">{money(c.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecurringOverview({ d }: { d: DocDetailData }) {
  const navigate = useNavigate();
  const childKind = d.kind === 'recurring_invoice' ? 'invoice' : 'bill';
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div>
        <div className="rounded-md border border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-3">
            <Pill status={d.status} />
            <span className="text-lg font-semibold">{money(d.total)}</span>
            <span className="text-slate-500">· {frequencyLabel(d.repeatEvery)}</span>
          </div>
          <KV k="Profile Name" v={d.profileName} />
          <KV k={d.kind === 'recurring_invoice' ? 'Customer' : 'Vendor'} v={d.contactName} />
          <KV k="Start Date" v={fmtDate(d.startOn)} />
          <KV k="End Date" v={d.neverExpires ? 'Never Expires' : fmtDate(d.endsOn)} />
          <KV k="Next Date" v={d.status === 'active' ? fmtDate(d.nextDate) : '-'} />
          <KV k="Last Generated" v={fmtDate(d.lastGeneratedDate)} />
          <KV k="Payment Terms" v={PAYMENT_TERMS.find((t) => t.value === d.paymentTerms)?.label} />
          <KV k="Salesperson" v={d.salesperson} />
          <KV k={`${DOC_META[childKind].plural} Created`} v={String(d.childCount ?? d.related.children.length)} />
          <div className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600">{d.createAsDraft ? `${DOC_META[childKind].plural} will be created as drafts. You can review and send them.` : `${DOC_META[childKind].plural} will be created and saved as open.`}</div>
        </div>
        <div className="mt-4 rounded-md border border-slate-200 p-4 text-[13px]">
          <div className="mb-1 font-semibold">Address</div>
          <AddressBlock a={d.billingAddress} />
          {(d.customerNotes || d.notes) && (
            <>
              <div className="mb-1 mt-3 font-semibold">Notes</div>
              <div className="whitespace-pre-wrap text-slate-600">{d.customerNotes || d.notes}</div>
            </>
          )}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold">All Child {DOC_META[childKind].plural}</div>
        </div>
        <table className="table rounded-md border border-slate-200">
          <thead>
            <tr>
              <th>Date</th>
              <th>{DOC_META[childKind].numberLabel}</th>
              <th>Status</th>
              <th className="text-right">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.related.children.map((c) => (
              <tr key={c.id} className="row-link" onClick={() => navigate(`${DOC_META[c.kind].path}/${c.id}`)}>
                <td>{fmtDate(c.date)}</td>
                <td>
                  <span className="text-brand-600">{c.number}</span>
                  {c.manuallyAdded && <div className="text-xxs text-slate-400">Manually Added</div>}
                </td>
                <td>
                  <Status status={c.status} dueDate={c.dueDate} />
                </td>
                <td className="text-right">{money(c.total)}</td>
                <td className="text-right">
                  {!['paid', 'void', 'draft'].includes(c.status) && (
                    <button
                      className="link text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(childKind === 'invoice' ? `/sales/payments-received/new?invoiceId=${c.id}&contactId=${c.contactId}` : `/purchases/payments-made/new?billId=${c.id}&contactId=${c.contactId}`);
                      }}
                    >
                      Record Payment
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!d.related.children.length && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">
                  No {DOC_META[childKind].plural.toLowerCase()} created yet. They are generated automatically on each due date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaymentsTab({ d, kind }: { d: DocDetailData; kind: DocKind }) {
  const navigate = useNavigate();
  const remove = useAction((appId: string) => api(`/docs/${d.id}/credit-applications/${appId}`, { method: 'DELETE' }), 'Credit removed');
  if (kind === 'credit_note' || kind === 'vendor_credit')
    return (
      <div className="space-y-6">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>{kind === 'credit_note' ? 'Invoice#' : 'Bill#'}</th>
              <th className="text-right">Amount Credited</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.related.appliedTo.map((a) => (
              <tr key={a.id}>
                <td>{fmtDate(a.date)}</td>
                <td>{a.number}</td>
                <td className="text-right">{money(a.amount)}</td>
                <td className="text-right">
                  <button className="text-slate-400 hover:text-red-500" onClick={() => remove.mutate(a.id)} aria-label="Remove">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {!d.related.appliedTo.length && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-slate-400">
                  Credits have not been applied yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {d.refunds.length > 0 && (
          <div>
            <div className="mb-2 font-semibold">Refunds</div>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Mode</th>
                  <th>Reference#</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.refunds.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.mode}</td>
                    <td>{r.referenceNumber}</td>
                    <td className="text-right">{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  const base = kind === 'invoice' ? '/sales/payments-received' : '/purchases/payments-made';
  return (
    <div className="space-y-6">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Payment#</th>
            <th>Mode</th>
            <th>Status</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {d.related.payments.map((p) => (
            <tr key={p.id} className="row-link" onClick={() => navigate(`${base}/${p.id}`)}>
              <td>{fmtDate(p.date)}</td>
              <td className="text-brand-600">{p.number}</td>
              <td>{p.mode}</td>
              <td>
                <Status status={p.status} />
              </td>
              <td className="text-right">{money(p.amount)}</td>
            </tr>
          ))}
          {d.related.creditsApplied.map((c) => (
            <tr key={c.id}>
              <td>{fmtDate(c.date)}</td>
              <td>{c.creditNumber}</td>
              <td>Credits Applied</td>
              <td />
              <td className="text-right">{money(c.amount)}</td>
            </tr>
          ))}
          {!d.related.payments.length && !d.related.creditsApplied.length && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-slate-400">
                No payments recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RefundModal({ d, onClose, accounts }: { d: DocDetailData; onClose: () => void; accounts: ReturnType<typeof useBoot>['accounts'] }) {
  const [f, setF] = useState({ amount: String(d.balance), date: today(), mode: 'Cash', referenceNumber: '', accountId: 'acc_petty_cash', description: '' });
  const save = useAction(() => api(`/docs/${d.id}/refunds`, { body: f }), 'Refund recorded');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Refund (${d.number})`}
      width="max-w-2xl"
      footer={
        <>
          <button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="mb-4 flex gap-8 text-[13px]">
        <div>
          <div className="text-xs text-slate-500">{d.kind === 'credit_note' ? 'Customer Name' : 'Vendor Name'}</div>
          <div className="font-medium">{d.contactName}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Credit Note Number</div>
          <div className="font-medium">{d.number}</div>
        </div>
      </div>
      <div className="space-y-3">
        <Field label="Amount" required hint={`Balance : ${money(d.balance)}`}>
          <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label="Refunded On" required>
          <DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
        <Field label="Payment Mode">
          <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Reference#">
          <input className="input" value={f.referenceNumber} onChange={(e) => setF({ ...f, referenceNumber: e.target.value })} />
        </Field>
        <Field label={d.kind === 'credit_note' ? 'From Account' : 'Deposit To'} required>
          <AccountSelect accounts={accounts} value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} filter={(a) => ['cash', 'bank', 'credit_card'].includes(a.subType)} />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function ApplyCreditsModal({ d, onClose }: { d: DocDetailData; onClose: () => void }) {
  const target = d.kind === 'credit_note' ? 'invoice' : 'bill';
  const { data = [] } = useApi<TxnDoc[]>(`/docs${qs({ kind: target, contactId: d.contactId, status: 'unpaid' })}`);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const total = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0);
  const save = useAction(() => api(`/docs/${d.id}/apply-credits`, { body: { applications: Object.entries(amounts).map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) })) } }), 'Credits applied');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Apply credits from ${d.number}`}
      width="max-w-3xl"
      footer={
        <>
          <button className="btn-primary" disabled={!total} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <span className="ml-auto text-[13px]">
            Amount to Credit: <b>{money(total)}</b> · Remaining credits: <b>{money(d.balance - total)}</b>
          </span>
        </>
      }
    >
      <table className="table">
        <thead>
          <tr>
            <th>{target === 'invoice' ? 'Invoice#' : 'Bill#'}</th>
            <th>Date</th>
            <th className="text-right">Amount</th>
            <th className="text-right">Balance</th>
            <th className="w-36 text-right">Amount to Credit</th>
          </tr>
        </thead>
        <tbody>
          {data.map((i) => (
            <tr key={i.id}>
              <td>{i.number}</td>
              <td>{fmtDate(i.date)}</td>
              <td className="text-right">{money(i.total)}</td>
              <td className="text-right">{money(i.balance)}</td>
              <td>
                <input type="number" className="input text-right" value={amounts[i.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [i.id]: e.target.value })} />
              </td>
            </tr>
          ))}
          {!data.length && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-slate-400">
                There are no unpaid {target}s for {d.contactName}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  );
}

function WriteOffModal({ d, onClose, onSubmit }: { d: DocDetailData; onClose: () => void; onSubmit: (b: { date: string; reason: string }) => void }) {
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title={`Write off ${d.number}`} footer={<><button className="btn-danger" onClick={() => onSubmit({ date, reason })}>Write Off</button><button className="btn-secondary" onClick={onClose}>Cancel</button></>}>
      <div className="space-y-3">
        <div className="text-[13px]">
          Write off the balance of <b>{money(d.balance)}</b> as a bad debt.
        </div>
        <Field label="Write Off Date" required>
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Reason">
          <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ExpectedDateModal({ d, onClose, onSubmit }: { d: DocDetailData; onClose: () => void; onSubmit: (date: string) => void }) {
  const [date, setDate] = useState(d.expectedPaymentDate || d.dueDate || today());
  return (
    <Modal open onClose={onClose} title="Expected Payment Date" footer={<><button className="btn-primary" onClick={() => onSubmit(date)}>Save</button><button className="btn-secondary" onClick={onClose}>Cancel</button></>}>
      <Field label="Expected Payment Date">
        <DateInput value={date} onChange={setDate} />
      </Field>
    </Modal>
  );
}

function CancelItemsModal({ d, onClose, onSubmit }: { d: DocDetailData; onClose: () => void; onSubmit: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <Modal open onClose={onClose} title="Cancel Items" footer={<><button className="btn-danger" disabled={!sel.length} onClick={() => onSubmit(sel)}>Cancel Items</button><button className="btn-secondary" onClick={onClose}>Close</button></>}>
      <div className="space-y-2">
        {d.lineItems.map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="accent-brand-600" checked={sel.includes(l.id)} onChange={(e) => setSel(e.target.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} />
            {l.name} · {l.quantity} × {money(l.rate)}
          </label>
        ))}
      </div>
    </Modal>
  );
}
