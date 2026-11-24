// Zoho-style PDF customisation for transactions: the "Customize" menu on the PDF preview,
// the Choose Template drawer, the full-screen template editor, organisation logo & address,
// module custom fields and the notes / terms & conditions of a document.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Check, ChevronDown, ChevronRight, Copy, FileText, Image as ImageIcon, LayoutTemplate, Lock, Plus, RefreshCw, Rows3, Search, Settings, Sigma, Star, Table2, Trash2, Upload, X } from 'lucide-react';
import { DOC_META } from '@shared/docmeta';
import { COLOR_THEMES, CUSTOM_FIELD_TYPES, INDIAN_STATES, INDUSTRIES, PAPER, PDF_FONTS, PDF_LAYOUTS, applyTheme, customFieldsFor, docDefaults, makeTemplate, normalizeTemplate, resolveTemplate, sampleDoc, type CustomFieldDef, type CustomFieldType, type PdfLayout, type PdfTemplate } from '@shared/pdfTemplate';
import type { Contact, DocKind, Organization, TxnDoc } from '@shared/types';
import { api, useAction } from '../../api';
import { useBoot } from '../../lib/app';
import { toast } from '../../lib/toast';
import { DocumentPreview, FitPaper } from '../DocumentPreview';
import { Checkbox, Modal, Select, clsx, useConfirm, useOutside } from '../ui';

// ------------------------------------------------------------ helpers

export function useTemplates() {
  const { pdfTemplates } = useBoot();
  return useMemo(() => (pdfTemplates || []).map((t) => normalizeTemplate(t)), [pdfTemplates]);
}

/** Template a document prints with: its own choice, else the module default. */
export function useDocTemplate(kind: DocKind | 'payment', templateId?: string) {
  const { pdfTemplates, preferences } = useBoot();
  return useMemo(() => resolveTemplate(pdfTemplates, preferences, kind, templateId), [pdfTemplates, preferences, kind, templateId]);
}

function readImage(file: File, maxMB = 1): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|gif|bmp)$/.test(file.type)) return reject(new Error('Supported files: jpg, jpeg, png, gif, bmp'));
    if (file.size > maxMB * 1024 * 1024) return reject(new Error(`Maximum file size is ${maxMB}MB`));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

// ------------------------------------------------------------ Customize menu

export type CustomizeTarget = { doc: TxnDoc & { contact?: Contact }; kind: DocKind };

export function CustomizeMenu({ doc, kind }: CustomizeTarget) {
  const template = useDocTemplate(kind, doc.templateId);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<null | 'choose' | 'edit' | 'org' | 'fields' | 'terms'>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const item = (label: string, p: typeof panel) => (
    <button
      type="button"
      className="block w-full rounded-md px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-brand-600 hover:text-white"
      onClick={() => {
        setOpen(false);
        setPanel(p);
      }}
    >
      {label}
    </button>
  );
  return (
    <>
      <div ref={ref} className="relative">
        <button type="button" className="btn-primary h-8" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
          <Settings size={14} /> Customize <ChevronDown size={13} />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 z-40 mt-1.5 w-60 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
            <div className="truncate px-3 pb-1.5 pt-1 text-[13px] font-semibold text-slate-500">{template.name}</div>
            {item('Change Template', 'choose')}
            {item('Edit Template', 'edit')}
            <div className="my-1.5 border-t border-slate-100" />
            {item('Update Logo & Address', 'org')}
            {item('Manage Custom Fields', 'fields')}
            {item('Terms & Conditions', 'terms')}
          </div>
        )}
      </div>
      {panel === 'choose' && <ChooseTemplateDrawer doc={doc} kind={kind} onClose={() => setPanel(null)} onEdit={() => setPanel('edit')} />}
      {panel === 'edit' && <TemplateEditor template={template} doc={doc} onClose={() => setPanel(null)} />}
      {panel === 'org' && <OrgAddressModal onClose={() => setPanel(null)} />}
      {panel === 'fields' && <CustomFieldsDrawer kind={kind} onClose={() => setPanel(null)} />}
      {panel === 'terms' && <TermsModal doc={doc} kind={kind} onClose={() => setPanel(null)} />}
    </>
  );
}

// ------------------------------------------------------------ Choose Template drawer

export function TemplateThumb({ template, doc, org, contact, preferences, height = 250 }: { template: PdfTemplate; doc: TxnDoc; org: Organization; contact?: Contact; preferences?: Record<string, unknown>; height?: number }) {
  return (
    <div className="pointer-events-none overflow-hidden bg-slate-100 px-4 pt-4" style={{ height }}>
      <FitPaper t={template} maxHeight={height - 16}>
        <DocumentPreview doc={doc} org={org} contact={contact} template={template} preferences={preferences} fit={false} ribbon={false} />
      </FitPaper>
    </div>
  );
}

function ChooseTemplateDrawer({ doc, kind, onClose, onEdit }: { doc: TxnDoc & { contact?: Contact }; kind: DocKind; onClose: () => void; onEdit: () => void }) {
  const { organization, preferences } = useBoot();
  const templates = useTemplates();
  const current = useDocTemplate(kind, doc.templateId);
  const moduleDefault = ((preferences.defaultTemplates || {}) as Record<string, string>)[kind] || 'tpl_standard';
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const pick = useAction((templateId: string) => api(`/docs/${doc.id}/print-settings`, { method: 'PATCH', body: { templateId } }), 'Template applied');
  const setDefault = useAction((templateId: string) => api('/pdf-templates/defaults', { method: 'PUT', body: { kind, templateId } }), `Default template for ${DOC_META[kind].plural.toLowerCase()} updated`);
  const shown = templates.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()) || t.layout.includes(q.toLowerCase()));
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-900/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-[620px] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <div className="text-lg font-semibold text-slate-900">Choose Template</div>
          <button onClick={onClose} aria-label="Close" className="text-red-500 hover:text-red-600">
            <X size={20} />
          </button>
        </div>
        <div className="flex gap-2 border-b border-slate-200 px-6 pb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input className="input h-9 pl-9" placeholder="Search Template" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <button className="btn-secondary h-9" onClick={() => setCreating(true)}>
            <Plus size={14} /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-slate-50/60 px-6 py-5">
          <div className="grid grid-cols-2 gap-5">
            {shown.map((t) => {
              const selected = t.id === current.id;
              return (
                <div key={t.id} className={clsx('group overflow-hidden rounded-lg border bg-white transition-shadow hover:shadow-md', selected ? 'border-brand-400 ring-2 ring-brand-100' : 'border-slate-200')}>
                  <button type="button" className="block w-full text-left" onClick={() => !selected && pick.mutate(t.id)} title={selected ? 'Selected' : `Use ${t.name}`}>
                    <div className="relative">
                      <TemplateThumb template={t} doc={doc} org={organization} contact={doc.contact} preferences={preferences} height={230} />
                      {!selected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/0 opacity-0 transition group-hover:bg-slate-900/30 group-hover:opacity-100">
                          <span className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow">Use this template</span>
                        </div>
                      )}
                    </div>
                    {selected ? (
                      <div className="flex items-center justify-center gap-1.5 bg-brand-50 py-2 text-xs font-semibold tracking-wider text-brand-700">
                        <BadgeCheck size={14} /> SELECTED
                      </div>
                    ) : (
                      <div className="border-t border-slate-100 py-2 text-center text-xs text-slate-400">{PDF_LAYOUTS.find((l) => l.value === t.layout)?.label} layout</div>
                    )}
                  </button>
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-slate-800">{t.name}</div>
                      {t.id === moduleDefault && <div className="text-[11px] text-emerald-600">Default for {DOC_META[kind].plural}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {t.id !== moduleDefault && (
                        <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-amber-500" title={`Make default for ${DOC_META[kind].plural.toLowerCase()}`} onClick={() => setDefault.mutate(t.id)}>
                          <Star size={14} />
                        </button>
                      )}
                      {selected && (
                        <button className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50" onClick={onEdit}>
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {!shown.length && <div className="py-16 text-center text-slate-400">No templates match “{q}”.</div>}
        </div>
      </div>
      {creating && <NewTemplateModal onClose={() => setCreating(false)} onCreated={(t) => pick.mutate(t.id)} />}
    </div>
  );
}

export function NewTemplateModal({ onClose, onCreated, from }: { onClose: () => void; onCreated?: (t: PdfTemplate) => void; from?: PdfTemplate }) {
  const [layout, setLayout] = useState<PdfLayout>(from?.layout || 'standard');
  const [name, setName] = useState(from ? `${from.name} (Copy)` : '');
  const { organization } = useBoot();
  const create = useAction(() => api<PdfTemplate>('/pdf-templates', { body: from ? { from: from.id, name } : { name, layout } }), 'Template created');
  return (
    <Modal
      open
      onClose={onClose}
      title={from ? 'Clone Template' : 'New Template'}
      width="max-w-3xl"
      footer={
        <>
          <button
            className="btn-primary"
            disabled={!name.trim() || create.isPending}
            onClick={() =>
              create.mutate(undefined, {
                onSuccess: (t) => {
                  onCreated?.(t);
                  onClose();
                },
              })
            }
          >
            Create
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <label className="label-req">Template Name*</label>
      <input className="input mb-4 mt-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Invoice - Blue" />
      {!from && (
        <>
          <div className="label mb-2">Start from a layout</div>
          <div className="grid grid-cols-3 gap-3">
            {PDF_LAYOUTS.map((l) => {
              const t = makeTemplate(l.value, { id: l.value, name: l.label });
              return (
                <button key={l.value} type="button" onClick={() => setLayout(l.value)} className={clsx('overflow-hidden rounded-lg border text-left transition', layout === l.value ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300')}>
                  <TemplateThumb template={t} doc={sampleDoc('invoice')} org={organization} contact={{ displayName: 'Rob & Joe Traders', companyName: 'Rob & Joe Traders' } as Contact} height={170} />
                  <div className="px-2.5 py-2">
                    <div className="flex items-center gap-1 text-[13px] font-medium">
                      {layout === l.value && <Check size={13} className="text-brand-600" />}
                      {l.label}
                    </div>
                    <div className="text-[11px] leading-4 text-slate-500">{l.blurb}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------ Template editor

type EditorTab = 'general' | 'header' | 'details' | 'table' | 'total' | 'other';

const EDITOR_TABS: { value: EditorTab; label: string; icon: ReactNode }[] = [
  { value: 'general', label: 'General', icon: <FileText size={18} /> },
  { value: 'header', label: 'Header & Footer', icon: <LayoutTemplate size={18} /> },
  { value: 'details', label: 'Transaction Details', icon: <Rows3 size={18} /> },
  { value: 'table', label: 'Table', icon: <Table2 size={18} /> },
  { value: 'total', label: 'Total', icon: <Sigma size={18} /> },
  { value: 'other', label: 'Other Details', icon: <FileText size={18} /> },
];

function Collapse({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b-8 border-slate-50">
      <button type="button" className="flex w-full items-center justify-between px-6 py-4 text-left text-[15px] font-medium text-slate-900" onClick={() => setOpen((o) => !o)}>
        {title}
        {open ? <ChevronDown size={16} className="text-brand-600" /> : <ChevronRight size={16} className="text-brand-600" />}
      </button>
      {open && <div className="space-y-4 px-6 pb-6">{children}</div>}
    </div>
  );
}

function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] text-slate-700">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function ColorInput({ value, onChange, allowAuto, autoLabel = 'Theme colour' }: { value: string; onChange: (v: string) => void; allowAuto?: boolean; autoLabel?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" className="h-8 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      <input className="input w-28 font-mono uppercase" value={value} placeholder={allowAuto ? 'Auto' : '#000000'} onChange={(e) => onChange(e.target.value)} />
      {allowAuto && value && (
        <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => onChange('')}>
          Use {autoLabel.toLowerCase()}
        </button>
      )}
    </div>
  );
}

function RadioRow<T extends string>({ value, onChange, options, name }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-5">
      {options.map((o) => (
        <label key={o.value} className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
          <input type="radio" name={name} className="h-4 w-4 accent-brand-600" checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function ThemePicker({ value, onPick }: { value: string; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const cur = COLOR_THEMES.find((c) => c.key === value);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn-secondary h-9 text-brand-700" onClick={() => setOpen((o) => !o)}>
        {cur && <span className="flex h-4 w-7 overflow-hidden rounded-sm ring-1 ring-slate-200"><span className="w-1/2" style={{ background: cur.primary }} /><span className="w-1/2" style={{ background: cur.tint }} /></span>}
        Select Color Theme <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-80 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
          {COLOR_THEMES.map((c) => (
            <button
              key={c.key}
              type="button"
              className={clsx('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px]', c.key === value ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50')}
              onClick={() => {
                onPick(c.key);
                setOpen(false);
              }}
            >
              <span className="flex h-5 w-12 overflow-hidden rounded-sm ring-1 ring-black/10">
                <span className="w-1/2" style={{ background: c.primary }} />
                <span className="w-1/2" style={{ background: c.tint }} />
              </span>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplateEditor({ template, doc, onClose }: { template: PdfTemplate; doc?: TxnDoc & { contact?: Contact }; onClose: () => void }) {
  const { organization, preferences } = useBoot();
  const [t, setT] = useState<PdfTemplate>(template);
  const [shown, setShown] = useState<PdfTemplate>(template);
  const [auto, setAuto] = useState(true);
  const [tab, setTab] = useState<EditorTab>('general');
  const [dirty, setDirty] = useState(false);
  const confirm = useConfirm();
  const save = useAction(() => api<PdfTemplate>(`/pdf-templates/${t.id}`, { method: 'PUT', body: t }), 'Template saved');
  const preview = doc || sampleDoc('invoice');
  const previewContact = doc?.contact || ({ displayName: 'Rob & Joe Traders', companyName: 'Rob & Joe Traders' } as Contact);

  useEffect(() => {
    if (auto) setShown(t);
  }, [t, auto]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const set = (patch: Partial<PdfTemplate>) => {
    setT((cur) => ({ ...cur, ...patch }));
    setDirty(true);
  };
  const setIn = <K extends 'header' | 'details' | 'table' | 'total' | 'other' | 'margins'>(k: K, patch: Partial<PdfTemplate[K]>) => {
    setT((cur) => ({ ...cur, [k]: { ...cur[k], ...patch } }));
    setDirty(true);
  };
  const setLabel = (k: keyof PdfTemplate['table']['labels'], v: string) => setIn('table', { labels: { ...t.table.labels, [k]: v } });
  const close = () => (dirty ? confirm.ask('Discard changes?', 'Your changes to this template have not been saved.', onClose, { label: 'Discard', danger: true }) : onClose());
  const text = (v: string, on: (v: string) => void, placeholder?: string) => <input className="input h-9" value={v} placeholder={placeholder} onChange={(e) => on(e.target.value)} />;
  const check = (v: boolean, on: (v: boolean) => void, label: string) => <Checkbox checked={v} onChange={on} label={label} />;

  return (
    <div className="no-print fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <div className="text-xl font-medium text-slate-900">Edit Template</div>
          <div className="text-[13px] text-slate-400">{t.name}</div>
        </div>
        <div className="flex items-center gap-2.5">
          <ThemePicker value={t.theme} onPick={(key) => { setT((cur) => applyTheme(cur, key)); setDirty(true); }} />
          <label className="ml-1 hidden items-center gap-1.5 text-xs text-slate-500 lg:flex">
            <input type="checkbox" className="accent-brand-600" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Live preview
          </label>
          <button className="btn-secondary h-9" onClick={() => setShown({ ...t })}>
            <RefreshCw size={14} /> Refresh Preview
          </button>
          <button
            className="btn-primary h-9 px-4"
            disabled={!t.name.trim() || save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  setDirty(false);
                  onClose();
                },
              })
            }
          >
            Save
          </button>
          <button onClick={close} aria-label="Close" className="ml-1 text-red-500 hover:text-red-600">
            <X size={22} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-[92px] shrink-0 space-y-1 border-r border-slate-200 bg-slate-50 p-1.5">
          {EDITOR_TABS.map((x) => (
            <button key={x.value} type="button" onClick={() => setTab(x.value)} className={clsx('flex w-full flex-col items-center gap-1 rounded-lg px-1 py-3 text-center text-[11.5px] leading-tight', tab === x.value ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white')}>
              {x.icon}
              {x.label}
            </button>
          ))}
        </nav>
        <div className="w-[400px] shrink-0 overflow-y-auto border-r border-slate-200">
          {tab === 'general' && (
            <>
              <Collapse title="Template Properties" defaultOpen>
                <Row label={<span className="text-red-600">Template Name*</span>}>{text(t.name, (v) => set({ name: v }))}</Row>
                <Row label="Paper Size">
                  <RadioRow name="paper" value={t.paperSize} onChange={(v) => set({ paperSize: v })} options={(Object.keys(PAPER) as (keyof typeof PAPER)[]).sort((a, b) => (a === 'A5' ? -1 : b === 'A5' ? 1 : a.localeCompare(b))).map((k) => ({ value: k, label: PAPER[k].label }))} />
                </Row>
                <Row label="Orientation">
                  <RadioRow name="orientation" value={t.orientation} onChange={(v) => set({ orientation: v })} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
                </Row>
                <Row label={<>Margins <span className="text-slate-400">(in inches)</span></>}>
                  <div className="grid grid-cols-4 gap-2.5">
                    {(['top', 'bottom', 'left', 'right'] as const).map((k) => (
                      <label key={k} className="text-[12px] capitalize text-slate-600">
                        {k}
                        <input type="number" step="0.05" min="0" max="2" className="input mt-1 h-9 text-right" value={t.margins[k]} onChange={(e) => setIn('margins', { [k]: Number(e.target.value) })} />
                      </label>
                    ))}
                  </div>
                </Row>
              </Collapse>
              <Collapse title="Layout" defaultOpen>
                <div className="grid grid-cols-2 gap-2">
                  {PDF_LAYOUTS.map((l) => (
                    <button key={l.value} type="button" title={l.blurb} onClick={() => set({ layout: l.value, ...(l.value === 'spreadsheet' ? { table: { ...t.table, borders: 'grid', headerBg: t.tintColor, headerText: t.textColor } } : l.value === 'classic' || l.value === 'minimal' ? { table: { ...t.table, borders: 'rows', headerBg: '#ffffff', headerText: l.value === 'classic' ? t.accentColor : '#6b7280' } } : { table: { ...t.table, borders: 'rows', headerBg: '', headerText: '#ffffff' } }) })} className={clsx('rounded-md border px-3 py-2 text-left text-[13px]', t.layout === l.value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 hover:bg-slate-50')}>
                      <div className="font-medium">{l.label}</div>
                      <div className="text-[11px] leading-4 text-slate-500">{l.blurb}</div>
                    </button>
                  ))}
                </div>
              </Collapse>
              <Collapse title="Font">
                <Row label="Font Family">
                  <Select className="h-9" value={t.font} onChange={(e) => set({ font: e.target.value as PdfTemplate['font'] })} options={PDF_FONTS.map((f) => ({ value: f.value, label: `${f.label} (${f.kind === 'serif' ? 'Serif' : 'Sans-serif'})` }))} />
                </Row>
                <Row label="Font Size (pt)">
                  <div className="flex items-center gap-3">
                    <input type="range" min="7" max="12" step="0.5" value={t.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} className="flex-1 accent-brand-600" />
                    <span className="w-10 text-right text-[13px] tabular-nums">{t.fontSize}</span>
                  </div>
                </Row>
                <Row label="Font Color">
                  <ColorInput value={t.textColor} onChange={(v) => set({ textColor: v })} />
                </Row>
                <Row label="Label Color">
                  <ColorInput value={t.labelColor} onChange={(v) => set({ labelColor: v })} />
                </Row>
              </Collapse>
              <Collapse title="Background">
                <Row label="Background Color">
                  <ColorInput value={t.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
                </Row>
                <Row label="Accent Color" hint="Set by the colour theme; fine-tune it here.">
                  <ColorInput value={t.accentColor} onChange={(v) => set({ accentColor: v })} />
                </Row>
                <Row label="Background Image" hint="JPG or PNG, up to 1 MB. Covers the whole page.">
                  <ImagePicker value={t.backgroundImage} onChange={(v) => set({ backgroundImage: v })} />
                </Row>
              </Collapse>
            </>
          )}
          {tab === 'header' && (
            <>
              <Collapse title="Header" defaultOpen>
                {check(t.header.showLogo, (v) => setIn('header', { showLogo: v }), 'Show Organization Logo')}
                {t.header.showLogo && (
                  <Row label="Logo Size">
                    <div className="flex items-center gap-3">
                      <input type="range" min="24" max="96" step="2" value={t.header.logoSize} onChange={(e) => setIn('header', { logoSize: Number(e.target.value) })} className="flex-1 accent-brand-600" />
                      <span className="w-12 text-right text-[13px] tabular-nums">{t.header.logoSize}pt</span>
                    </div>
                  </Row>
                )}
                {check(t.header.showOrgName, (v) => setIn('header', { showOrgName: v }), 'Show Organization Name')}
                {check(t.header.showOrgAddress, (v) => setIn('header', { showOrgAddress: v }), 'Show Organization Address')}
                {check(t.header.showOrgContact, (v) => setIn('header', { showOrgContact: v }), 'Show Phone, Email and Website')}
                {check(t.header.showGstin, (v) => setIn('header', { showGstin: v }), 'Show GSTIN')}
                {check(t.header.showTitle, (v) => setIn('header', { showTitle: v }), 'Show Document Title')}
                {t.header.showTitle && <Row label="Document Title" hint="Leave blank to use the transaction's own title (Tax Invoice, Sales Order, …).">{text(t.header.title, (v) => setIn('header', { title: v }), 'Default title')}</Row>}
              </Collapse>
              <Collapse title="Footer" defaultOpen>
                <Row label="Footer Text">
                  <textarea className="input" rows={2} value={t.header.footerText} placeholder="e.g. Creatign · www.creatign.in · Thank you for your business" onChange={(e) => setIn('header', { footerText: e.target.value })} />
                </Row>
                {check(t.header.showPageNumber, (v) => setIn('header', { showPageNumber: v }), 'Show Page Number')}
              </Collapse>
            </>
          )}
          {tab === 'details' && (
            <>
              <Collapse title="Customer & Vendor" defaultOpen>
                <Row label="Billing Address Label">{text(t.details.billToLabel, (v) => setIn('details', { billToLabel: v }))}</Row>
                <Row label="Vendor Address Label">{text(t.details.vendorLabel, (v) => setIn('details', { vendorLabel: v }))}</Row>
                {check(t.details.showShipTo, (v) => setIn('details', { showShipTo: v }), 'Show Shipping Address')}
                {t.details.showShipTo && <Row label="Shipping Address Label">{text(t.details.shipToLabel, (v) => setIn('details', { shipToLabel: v }))}</Row>}
              </Collapse>
              <Collapse title="Document Information" defaultOpen>
                <Row label="Number Label" hint="Shown before the document number, e.g. # or No.">{text(t.details.numberLabel, (v) => setIn('details', { numberLabel: v }))}</Row>
                {check(t.details.showReference, (v) => setIn('details', { showReference: v }), 'Show Reference# and Order Number')}
                {check(t.details.showPaymentTerms, (v) => setIn('details', { showPaymentTerms: v }), 'Show Payment Terms')}
                {check(t.details.showDueDate, (v) => setIn('details', { showDueDate: v }), 'Show Due Date')}
                {check(t.details.showSalesperson, (v) => setIn('details', { showSalesperson: v }), 'Show Salesperson')}
                {check(t.details.showSubject, (v) => setIn('details', { showSubject: v }), 'Show Subject')}
                {check(t.details.showCustomFields, (v) => setIn('details', { showCustomFields: v }), 'Show Custom Fields')}
              </Collapse>
            </>
          )}
          {tab === 'table' && (
            <>
              <Collapse title="Table Style" defaultOpen>
                <Row label="Header Background">
                  <ColorInput value={t.table.headerBg} allowAuto autoLabel="Theme colour" onChange={(v) => setIn('table', { headerBg: v })} />
                </Row>
                <Row label="Header Text Color">
                  <ColorInput value={t.table.headerText} onChange={(v) => setIn('table', { headerText: v })} />
                </Row>
                <Row label="Borders">
                  <RadioRow name="borders" value={t.table.borders} onChange={(v) => setIn('table', { borders: v })} options={[{ value: 'rows', label: 'Row lines' }, { value: 'grid', label: 'Full grid' }, { value: 'none', label: 'None' }]} />
                </Row>
                {check(t.table.stripes, (v) => setIn('table', { stripes: v }), 'Alternate row shading')}
              </Collapse>
              <Collapse title="Columns" defaultOpen>
                {check(t.table.showIndex, (v) => setIn('table', { showIndex: v }), 'Show Line Number (#)')}
                {check(t.table.showDescription, (v) => setIn('table', { showDescription: v }), 'Show Item Description')}
                {check(t.table.showUnit, (v) => setIn('table', { showUnit: v }), 'Show Unit below Quantity')}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {(
                    [
                      ['index', 'Line Number'],
                      ['item', 'Item'],
                      ['qty', 'Quantity'],
                      ['rate', 'Rate'],
                      ['discount', 'Discount'],
                      ['amount', 'Amount'],
                    ] as const
                  ).map(([k, l]) => (
                    <Row key={k} label={`${l} Label`}>
                      {text(t.table.labels[k], (v) => setLabel(k, v))}
                    </Row>
                  ))}
                </div>
              </Collapse>
            </>
          )}
          {tab === 'total' && (
            <Collapse title="Total Section" defaultOpen>
              {check(t.total.showSubTotal, (v) => setIn('total', { showSubTotal: v }), 'Show Sub Total')}
              {check(t.total.showAmountInWords, (v) => setIn('total', { showAmountInWords: v }), 'Show Total in Words')}
              {check(t.total.showPaymentMade, (v) => setIn('total', { showPaymentMade: v }), 'Show Payment Made')}
              {check(t.total.showBalanceDue, (v) => setIn('total', { showBalanceDue: v }), 'Show Balance Due')}
              <Row label="Total Label">{text(t.total.totalLabel, (v) => setIn('total', { totalLabel: v }))}</Row>
              <Row label="Balance Due Label">{text(t.total.balanceLabel, (v) => setIn('total', { balanceLabel: v }))}</Row>
            </Collapse>
          )}
          {tab === 'other' && (
            <>
              <Collapse title="Notes and Terms" defaultOpen>
                {check(t.other.showNotes, (v) => setIn('other', { showNotes: v }), 'Show Notes')}
                {t.other.showNotes && <Row label="Notes Label">{text(t.other.notesLabel, (v) => setIn('other', { notesLabel: v }))}</Row>}
                {check(t.other.showTerms, (v) => setIn('other', { showTerms: v }), 'Show Terms & Conditions')}
                {t.other.showTerms && <Row label="Terms Label">{text(t.other.termsLabel, (v) => setIn('other', { termsLabel: v }))}</Row>}
              </Collapse>
              <Collapse title="Bank Details" defaultOpen>
                {check(t.other.showBankDetails, (v) => setIn('other', { showBankDetails: v }), 'Show Bank Details')}
                {t.other.showBankDetails && <textarea className="input" rows={4} value={t.other.bankDetails} placeholder={'Bank: HDFC Bank\nA/c No: 50200012345678\nIFSC: HDFC0001234\nUPI: creatign@hdfcbank'} onChange={(e) => setIn('other', { bankDetails: e.target.value })} />}
              </Collapse>
              <Collapse title="Signature" defaultOpen>
                {check(t.other.showSignature, (v) => setIn('other', { showSignature: v }), 'Show Signature Line')}
                {t.other.showSignature && <Row label="Signature Label">{text(t.other.signatureLabel, (v) => setIn('other', { signatureLabel: v }))}</Row>}
              </Collapse>
            </>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto bg-slate-100 px-10 py-8">
          <div className="mx-auto" style={{ maxWidth: 900 }}>
            <DocumentPreview doc={preview} org={organization} contact={previewContact} template={shown} preferences={preferences} ribbon={false} />
          </div>
        </div>
      </div>
      {confirm.node}
    </div>
  );
}

function ImagePicker({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      {value ? <img src={value} alt="" className="h-14 w-20 rounded border border-slate-200 object-cover" /> : <div className="flex h-14 w-20 items-center justify-center rounded border border-dashed border-slate-300 text-slate-400"><ImageIcon size={18} /></div>}
      <div className="flex flex-col items-start gap-1">
        <button type="button" className="btn-secondary btn-sm" onClick={() => input.current?.click()}>
          <Upload size={12} /> {value ? 'Replace' : 'Upload'}
        </button>
        {value && (
          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onChange('')}>
            Remove
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            onChange(await readImage(f));
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------ Organization address & logo

export function OrgAddressModal({ onClose }: { onClose: () => void }) {
  const { organization } = useBoot();
  const [f, setF] = useState<Organization>({ ...organization, address: { ...organization.address } });
  const input = useRef<HTMLInputElement>(null);
  const save = useAction(() => api('/organization', { method: 'PUT', body: { logo: f.logo || null, address: f.address, phone: f.address?.phone || f.phone, fax: f.fax, website: f.website, industry: f.industry, state: f.address?.state || f.state } }), 'Organization address updated');
  const a = f.address || {};
  const setA = (patch: Partial<NonNullable<Organization['address']>>) => setF({ ...f, address: { ...a, ...patch } });
  const field = (k: keyof typeof a, placeholder: string, className?: string) => <input className={clsx('input h-10 bg-slate-50/70', className)} placeholder={placeholder} value={a[k] || ''} onChange={(e) => setA({ [k]: e.target.value })} />;
  return (
    <Modal
      open
      onClose={onClose}
      title="Organization Address"
      width="max-w-2xl"
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="flex gap-6 border-b border-slate-200 pb-6">
        <div className="group relative flex h-28 w-72 shrink-0 items-center justify-center rounded-md border border-dashed border-brand-300 bg-white">
          {f.logo ? (
            <>
              <img src={f.logo} alt="Organization logo" className="max-h-24 max-w-[260px] object-contain" />
              <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100">
                <button className="rounded bg-white p-1 text-slate-600 shadow ring-1 ring-slate-200 hover:text-brand-600" onClick={() => input.current?.click()} title="Change logo">
                  <Upload size={13} />
                </button>
                <button className="rounded bg-white p-1 text-slate-600 shadow ring-1 ring-slate-200 hover:text-red-600" onClick={() => setF({ ...f, logo: '' })} title="Remove logo">
                  <Trash2 size={13} />
                </button>
              </div>
            </>
          ) : (
            <button className="flex items-center gap-2 text-[14px] text-slate-700 hover:text-brand-600" onClick={() => input.current?.click()}>
              <Upload size={16} /> Upload Your Organization Logo
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/bmp"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                setF({ ...f, logo: await readImage(file) });
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          />
        </div>
        <div className="text-[13px] leading-6 text-slate-700">
          This logo will be displayed in transaction PDFs and email notifications.
          <div className="mt-1 text-[12px] leading-5 text-slate-500">
            Preferred Image Dimensions: 240 × 240 pixels @ 72 DPI
            <br />
            Supported Files: jpg, jpeg, png, gif, bmp
            <br />
            Maximum File Size: 1MB
            <br />
            <span className="text-slate-400">Emailed PDFs embed JPG and PNG logos.</span>
          </div>
        </div>
      </div>
      <div className="space-y-3 pt-6">
        {field('attention', 'Attention')}
        {field('street1', 'Street 1')}
        {field('street2', 'Street 2')}
        <div className="grid grid-cols-2 gap-3">
          {field('city', 'City')}
          {field('pin', 'Pin Code')}
          <Select className="h-10 bg-slate-50/70" value={a.state || f.state || ''} onChange={(e) => setA({ state: e.target.value })} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} placeholder="State" />
          {field('phone', 'Phone')}
        </div>
        <input className="input h-10 bg-slate-50/70" placeholder="Fax Number" value={f.fax || ''} onChange={(e) => setF({ ...f, fax: e.target.value })} />
        <div className="pt-3">
          <div className="mb-1.5 text-[13px] text-slate-700">Website URL</div>
          <input className="input h-10" placeholder="Website URL" value={f.website || ''} onChange={(e) => setF({ ...f, website: e.target.value })} />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] text-slate-700">Select Industry</div>
          <Select className="h-10" value={f.industry || ''} onChange={(e) => setF({ ...f, industry: e.target.value })} options={INDUSTRIES.map((s) => ({ value: s, label: s }))} placeholder="Select an industry" />
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ Custom fields

const blankField = (): CustomFieldDef => ({ id: '', label: '', dataType: 'text', mandatory: false, showInPdf: true, active: true });

export function CustomFieldsDrawer({ kind, onClose, initialTab = 'fields' }: { kind: DocKind; onClose: () => void; initialTab?: 'preferences' | 'fields' }) {
  const { preferences } = useBoot();
  const meta = DOC_META[kind];
  const fields = customFieldsFor(preferences, kind);
  const [tab, setTab] = useState<'preferences' | 'fields'>(initialTab);
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);
  const confirm = useConfirm();
  const saveAll = useAction((next: CustomFieldDef[]) => api(`/custom-fields/${kind}`, { method: 'PUT', body: { fields: next } }), 'Custom fields saved');
  const system: [string, string][] = [
    [meta.numberLabel, 'Text Box (Single Line)'],
    ...(meta.side === 'sales' ? ([['Salesperson', 'Text Box (Single Line)']] as [string, string][]) : []),
    ['Terms & Conditions', 'Text Box (Multi-line)'],
  ];
  const typeLabel = (t: CustomFieldType) => CUSTOM_FIELD_TYPES.find((x) => x.value === t)?.label || t;
  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-900/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-[820px] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-8 pt-4">
          <div className="flex gap-8">
            {(['preferences', 'fields'] as const).map((x) => (
              <button key={x} type="button" onClick={() => setTab(x)} className={clsx('-mb-px border-b-2 pb-3 text-[17px] capitalize', tab === x ? 'border-brand-600 font-semibold text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800')}>
                {x}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-5 pb-3">
            <Link to="/settings/preferences" className="text-[13px] text-brand-600 hover:underline" onClick={onClose}>
              All Preferences
            </Link>
            <button onClick={onClose} aria-label="Close" className="text-red-500 hover:text-red-600">
              <X size={20} />
            </button>
          </div>
        </div>
        {tab === 'fields' ? (
          <div className="flex-1 overflow-y-auto px-8 py-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="pr-4 text-[13px] text-slate-500">Custom fields appear on the {meta.label.toLowerCase()} form. Fields marked “Show in all PDFs” also print on the PDF.</div>
              <button className="btn-primary h-8 shrink-0" onClick={() => setEditing(blankField())}>
                <Plus size={14} /> New
              </button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Field Name</th>
                  <th>Data Type</th>
                  <th className="text-center">Mandatory</th>
                  <th className="text-center">Show in all PDFs</th>
                  <th>Status</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {system.map(([l, ty]) => (
                  <tr key={l}>
                    <td>
                      <Lock size={13} className="text-slate-400" />
                    </td>
                    <td>{l}</td>
                    <td className="text-slate-600">{ty}</td>
                    <td className="text-center">No</td>
                    <td className="text-center">Yes</td>
                    <td className="text-emerald-600">Active</td>
                    <td />
                  </tr>
                ))}
                {fields.map((f) => (
                  <tr key={f.id} className="row-link" onClick={() => setEditing(f)}>
                    <td />
                    <td className="font-medium text-brand-700">{f.label}</td>
                    <td className="text-slate-600">{typeLabel(f.dataType)}</td>
                    <td className="text-center">{f.mandatory ? 'Yes' : 'No'}</td>
                    <td className="text-center">{f.showInPdf ? 'Yes' : 'No'}</td>
                    <td className={f.active ? 'text-emerald-600' : 'text-slate-400'}>{f.active ? 'Active' : 'Inactive'}</td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete field" onClick={() => confirm.ask('Delete custom field?', `“${f.label}” and its values on existing ${meta.plural.toLowerCase()} will no longer be shown.`, () => saveAll.mutate(fields.filter((x) => x.id !== f.id)), { danger: true, label: 'Delete' })}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!fields.length && <div className="py-8 text-center text-[13px] text-slate-400">No custom fields yet. Click New to add one, such as “PO Date” or “Vehicle Number”.</div>}
          </div>
        ) : (
          <ModulePreferences kind={kind} />
        )}
      </div>
      {editing && (
        <FieldModal
          field={editing}
          onClose={() => setEditing(null)}
          onSave={(f) => {
            const next = f.id ? fields.map((x) => (x.id === f.id ? f : x)) : [...fields, f];
            saveAll.mutate(next, { onSuccess: () => setEditing(null) });
          }}
        />
      )}
      {confirm.node}
    </div>
  );
}

function FieldModal({ field, onClose, onSave }: { field: CustomFieldDef; onClose: () => void; onSave: (f: CustomFieldDef) => void }) {
  const [f, setF] = useState<CustomFieldDef>(field);
  const [opts, setOpts] = useState((field.options || []).join('\n'));
  return (
    <Modal
      open
      onClose={onClose}
      title={field.id ? 'Edit Custom Field' : 'New Custom Field'}
      footer={
        <>
          <button className="btn-primary" disabled={!f.label.trim()} onClick={() => onSave({ ...f, label: f.label.trim(), options: f.dataType === 'dropdown' ? opts.split('\n').map((o) => o.trim()).filter(Boolean) : undefined })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Row label={<span className="text-red-600">Label Name*</span>}>
          <input className="input h-9" value={f.label} autoFocus onChange={(e) => setF({ ...f, label: e.target.value })} />
        </Row>
        <Row label="Data Type">
          <Select className="h-9" value={f.dataType} onChange={(e) => setF({ ...f, dataType: e.target.value as CustomFieldType })} options={CUSTOM_FIELD_TYPES} />
        </Row>
        {f.dataType === 'dropdown' && (
          <Row label="Options" hint="One option per line.">
            <textarea className="input" rows={4} value={opts} onChange={(e) => setOpts(e.target.value)} />
          </Row>
        )}
        <Row label="Default Value">
          <input className="input h-9" value={f.defaultValue || ''} onChange={(e) => setF({ ...f, defaultValue: e.target.value })} />
        </Row>
        <div className="flex flex-col gap-2.5">
          <Checkbox checked={f.mandatory} onChange={(v) => setF({ ...f, mandatory: v })} label="Mandatory" />
          <Checkbox checked={f.showInPdf} onChange={(v) => setF({ ...f, showInPdf: v })} label="Show in all PDFs" />
          <Checkbox checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

function ModulePreferences({ kind }: { kind: DocKind }) {
  const { preferences } = useBoot();
  const templates = useTemplates();
  const meta = DOC_META[kind];
  const defs = docDefaults(preferences, kind);
  const [notes, setNotes] = useState(defs.notes || '');
  const [terms, setTerms] = useState(defs.terms || '');
  const defaultTpl = ((preferences.defaultTemplates || {}) as Record<string, string>)[kind] || 'tpl_standard';
  const [tpl, setTpl] = useState(defaultTpl);
  const save = useAction(async () => {
    await api(`/doc-defaults/${kind}`, { method: 'PUT', body: { notes, terms } });
    if (tpl !== defaultTpl) await api('/pdf-templates/defaults', { method: 'PUT', body: { kind, templateId: tpl } });
  }, `${meta.label} preferences saved`);
  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className="max-w-xl space-y-5">
        <Row label="Default PDF Template" hint={`Used for new and existing ${meta.plural.toLowerCase()} that have no template of their own.`}>
          <Select className="h-9" value={tpl} onChange={(e) => setTpl(e.target.value)} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
        </Row>
        <Row label={meta.side === 'sales' ? 'Customer Notes' : 'Notes'} hint={`Pre-filled on every new ${meta.label.toLowerCase()}.`}>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Row>
        <Row label="Terms & Conditions" hint={`Pre-filled on every new ${meta.label.toLowerCase()}.`}>
          <textarea className="input" rows={5} value={terms} onChange={(e) => setTerms(e.target.value)} />
        </Row>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Terms & Conditions

function TermsModal({ doc, kind, onClose }: { doc: TxnDoc; kind: DocKind; onClose: () => void }) {
  const meta = DOC_META[kind];
  const sales = meta.side === 'sales';
  const [notes, setNotes] = useState((sales ? doc.customerNotes : doc.notes) || '');
  const [terms, setTerms] = useState(doc.terms || '');
  const [notesDefault, setNotesDefault] = useState(false);
  const [termsDefault, setTermsDefault] = useState(false);
  const save = useAction(() => api(`/docs/${doc.id}/print-settings`, { method: 'PATCH', body: { notes, terms, notesDefault, termsDefault } }), 'Terms & Conditions updated');
  const everyone = `Use this in future for all ${meta.plural.toLowerCase()} of all ${sales ? 'customers' : 'vendors'}.`;
  return (
    <Modal
      open
      onClose={onClose}
      title="Update Terms & Conditions"
      width="max-w-2xl"
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-[14px] font-medium text-slate-800">Notes</div>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={sales ? 'Will be displayed on the PDF' : 'Notes for the vendor'} />
          <div className="mt-2">
            <Checkbox checked={notesDefault} onChange={setNotesDefault} label={everyone} />
          </div>
        </div>
        <div>
          <div className="mb-2 text-[14px] font-medium text-slate-800">Terms & Conditions</div>
          <textarea className="input" rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Enter the terms and conditions of your business to be displayed in your transaction" />
          <div className="mt-2">
            <Checkbox checked={termsDefault} onChange={setTermsDefault} label={everyone} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ Settings > PDF Templates

export function TemplatesSettings() {
  const { organization, preferences } = useBoot();
  const templates = useTemplates();
  const [editing, setEditing] = useState<PdfTemplate | null>(null);
  const [creating, setCreating] = useState<null | { from?: PdfTemplate }>(null);
  const confirm = useConfirm();
  const del = useAction((id: string) => api(`/pdf-templates/${id}`, { method: 'DELETE' }), 'Template deleted');
  const defaults = (preferences.defaultTemplates || {}) as Record<string, string>;
  const usedBy = (id: string) => Object.entries(defaults).filter(([, v]) => v === id).map(([k]) => (k === 'payment' ? 'Payments' : DOC_META[k as DocKind]?.plural)).filter(Boolean);
  const sample = sampleDoc('invoice');
  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1>PDF Templates</h1>
          <div className="mt-1 text-[13px] text-slate-500">Design how your quotes, sales orders, invoices, bills and receipts look when printed or emailed. Pick a template for a single transaction from its Customize menu.</div>
        </div>
        <button className="btn-primary" onClick={() => setCreating({})}>
          <Plus size={14} /> New Template
        </button>
      </div>
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4">
        {templates.map((t) => {
          const used = usedBy(t.id);
          const isStd = t.id === 'tpl_standard' && !used.length;
          return (
            <div key={t.id} className="group overflow-hidden rounded-lg border border-slate-200 bg-white hover:shadow-md">
              <button type="button" className="block w-full" onClick={() => setEditing(t)}>
                <TemplateThumb template={t} doc={sample} org={organization} contact={{ displayName: 'Rob & Joe Traders', companyName: 'Rob & Joe Traders' } as Contact} height={240} />
              </button>
              <div className="flex items-start justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{t.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{used.length ? `Default for ${used.join(', ')}` : isStd ? 'Default for all modules' : `${PDF_LAYOUTS.find((l) => l.value === t.layout)?.label} layout`}</div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600" title="Clone" onClick={() => setCreating({ from: t })}>
                    <Copy size={14} />
                  </button>
                  {!t.builtIn && (
                    <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete" onClick={() => confirm.ask('Delete template?', `Transactions using “${t.name}” will switch to their module's default template.`, () => del.mutate(t.id), { danger: true, label: 'Delete' })}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <DefaultTemplatesTable templates={templates} defaults={defaults} />
      {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} />}
      {creating && <NewTemplateModal from={creating.from} onClose={() => setCreating(null)} onCreated={(t) => setEditing(t)} />}
      {confirm.node}
    </div>
  );
}

function DefaultTemplatesTable({ templates, defaults }: { templates: PdfTemplate[]; defaults: Record<string, string> }) {
  const set = useAction((v: { kind: string; templateId: string }) => api('/pdf-templates/defaults', { method: 'PUT', body: v }), 'Default template updated');
  const kinds = (Object.keys(DOC_META) as DocKind[]).filter((k) => !DOC_META[k].recurring);
  return (
    <div className="mt-8 max-w-2xl">
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Default template per module</div>
      <table className="table rounded-md border border-slate-200">
        <tbody>
          {[...kinds.map((k) => [k, DOC_META[k].plural] as const), ['payment', 'Payment Receipts & Statements'] as const].map(([k, label]) => (
            <tr key={k}>
              <td className="w-1/2 align-middle">{label}</td>
              <td>
                <Select className="h-8" value={defaults[k] || 'tpl_standard'} onChange={(e) => set.mutate({ kind: k, templateId: e.target.value })} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

