import { useEffect, useMemo, useState } from 'react';
import {
  addCommercialPart,
  addCommercialService,
  confirmCommercialPayment,
  createCommercialInvoice,
  decideCommercialQuote,
  loadCommercialOrder,
  markApprovedPartsOrdered,
  prepareCommercialQuote,
  removeCommercialPart,
  removeCommercialService,
  updateCommercialPart,
  updateCommercialService,
} from './commercialRepository.js';
import { supabase } from './supabaseClient.js';
import DeliveryNoteReader from './DeliveryNoteReader.jsx';
import ProfitabilityPanel from './ProfitabilityPanel.jsx';
import './commercialFlow.css';

const SEK = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyPart = { description: '', partNumber: '', quantity: '1', cost: '', salePrice: '', discount: '' };
const emptyService = { description: '', quantity: '1', hours: '', unitPrice: '1000' };

const statusLabels = {
  pending_approval: 'Väntar på godkännande', approved: 'Godkänd', ordered: 'Beställd',
  prepared: 'Offert förberedd', draft: 'Utkast', rejected: 'Avvisad',
  completed: 'Klar', quote: 'I offert',
};
function statusLabel(value) { return statusLabels[value] || value || ''; }

function dueDateFromDays(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + Number(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function money(value) { return `${SEK.format(Number(value || 0))} kr`; }
function quoteQuantity(line) { return line.item_type === 'service' ? `${SEK.format(Number(line.quantity || 0))} h` : line.quantity; }
function date(value) { return value ? new Intl.DateTimeFormat('sv-SE').format(new Date(value)) : '—'; }

function DocumentLinesTable({ lines, language, kind, showPrice, hideHourlyRate = false }) {
  if (!lines.length) return <p className="print-empty">{language === 'es' ? 'Inga rader registrerade.' : 'Inga rader registrerade.'}</p>;
  const isSpanish = language === 'es';
  return <table className="print-lines">
    <thead><tr>
      <th>{isSpanish ? 'Beskrivning' : 'Beskrivning'}</th>
      <th>{kind === 'service' ? (isSpanish ? 'Horas' : 'Timmar') : (isSpanish ? 'Cant.' : 'Antal')}</th>
      {showPrice && <>{!(hideHourlyRate && kind === 'service') && <th>{kind === 'service' ? (isSpanish ? 'Precio/h' : 'Pris/h') : (isSpanish ? 'Precio unit.' : 'Pris/st')}</th>}<th>{isSpanish ? 'Importe' : 'Belopp'}</th></>}
    </tr></thead>
    <tbody>{lines.map((line) => <tr key={line.id}>
      <td>{line.description}</td>
      <td>{quoteQuantity(line)}</td>
      {showPrice && <>{!(hideHourlyRate && kind === 'service') && <td>{Number(line.unit_price) > 0 ? money(line.unit_price) : '—'}</td>}<td>{Number(line.unit_price) > 0 ? money(Number(line.quantity) * Number(line.unit_price)) : '—'}</td></>}
    </tr>)}</tbody>
  </table>;
}

function ServiceLineEditor({ item, busy, onSave, onDelete }) {
  const [draft, setDraft] = useState({
    description: item.description || '',
    hours: (Number(item.estimated_minutes || 0) / 60).toFixed(2),
    unitPrice: String(item.unit_price ?? ''),
  });
  useEffect(() => setDraft({
    description: item.description || '',
    hours: (Number(item.estimated_minutes || 0) / 60).toFixed(2),
    unitPrice: String(item.unit_price ?? ''),
  }), [item.description, item.estimated_minutes, item.unit_price]);
  return <li className="commercial-edit-line">
    <label>Arbete<textarea rows="2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
    <label>Timmar<input type="number" min="0" step="0.01" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} /></label>
    <label>Pris/h<input type="number" min="0" step="0.01" value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })} /></label>
    <small>{statusLabel(item.status)} · {Number(draft.hours || 0).toFixed(2).replace('.', ',')} h × {Number(draft.unitPrice) > 0 ? money(Number(draft.unitPrice)) + '/h = ' + money(Number(draft.unitPrice) * Number(draft.hours || 0)) : 'Pris saknas'}</small>
    <div className="commercial-line-actions"><button type="button" disabled={busy} onClick={() => onSave(draft)}>Spara</button><button type="button" className="reject-button" disabled={busy} onClick={onDelete}>Ta bort</button></div>
  </li>;
}

function PartLineEditor({ item, busy, onSave, onDelete }) {
  const [draft, setDraft] = useState({
    description: item.description_snapshot || '',
    partNumber: item.part_number_snapshot || '',
    quantity: String(item.quantity ?? 1),
    cost: item.actual_cost ?? '',
    salePrice: item.sale_price ?? '',
    discount: item.discount_percent ?? '',
  });
  useEffect(() => setDraft({
    description: item.description_snapshot || '',
    partNumber: item.part_number_snapshot || '',
    quantity: String(item.quantity ?? 1),
    cost: item.actual_cost ?? '',
    salePrice: item.sale_price ?? '',
    discount: item.discount_percent ?? '',
  }), [item.description_snapshot, item.part_number_snapshot, item.quantity, item.actual_cost, item.sale_price, item.discount_percent]);
  return <li className="commercial-edit-line commercial-part-line">
    <label>Reservdel<textarea rows="2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
    <label>Artikelnummer<input value={draft.partNumber} onChange={(e) => setDraft({ ...draft, partNumber: e.target.value })} /></label>
    <label>Antal<input type="number" min="0.001" step="0.001" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} /></label>
    <label>Inköpspris<input type="number" min="0" step="0.01" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} /></label>
    <label>Pris<input type="number" min="0" step="0.01" value={draft.salePrice} onChange={(e) => setDraft({ ...draft, salePrice: e.target.value })} /></label>
    <label>Rabatt %<input type="number" min="0" max="100" step="0.01" value={draft.discount} onChange={(e) => setDraft({ ...draft, discount: e.target.value })} /></label>
    <small>{statusLabel(item.status)} · {Number(draft.salePrice) > 0 ? `Totalt ${money(Number(draft.salePrice) * Number(draft.quantity || 0))}` : 'Pris saknas'}</small>
    <div className="commercial-line-actions"><button type="button" disabled={busy} onClick={() => onSave(draft)}>Spara</button><button type="button" className="reject-button" disabled={busy} onClick={onDelete}>Ta bort</button></div>
  </li>;
}

export default function CommercialOrderFlow({ order, onSaved }) {
  const [context, setContext] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [service, setService] = useState(emptyService);
  const [part, setPart] = useState(emptyPart);
  const [quoteSettings, setQuoteSettings] = useState({ notes: '', variablePrice: false, warrantyEnabled: false, warrantyMonths: '3', warrantyKm: '1000', documentLanguage: 'sv' });
  const [invoiceForm, setInvoiceForm] = useState({ email: '', paymentTermsDays: '15', reference: '', ocr: '', notes: '' });
  const [paymentForm, setPaymentForm] = useState({ method: 'Swish', amount: '', reference: '', invoiceId: '' });
  const [lastReceipt, setLastReceipt] = useState(null);
  const [lastInvoice, setLastInvoice] = useState(null);
  const [fortnoxInvoiceTest, setFortnoxInvoiceTest] = useState({ state: 'idle', message: '', result: null });
  const [printMode, setPrintMode] = useState(null);

  const orderId = order.relationalId;
  const refresh = async () => {
    if (!orderId) return;
    const data = await loadCommercialOrder(orderId);
    setContext(data);
    const quote = data.quotes[0];
    if (quote) setQuoteSettings({
      notes: quote.notes || '', variablePrice: Boolean(quote.variable_price), warrantyEnabled: Boolean(quote.warranty_enabled),
      warrantyMonths: String(quote.warranty_months ?? 3), warrantyKm: String(quote.warranty_km ?? 1000),
      documentLanguage: quote.document_language || 'sv',
    });
    const invoice = data.invoices?.find((item) => !['cancelled', 'credited'].includes(item.status)) || null;
    const accountingTotal = Number(invoice?.total ?? quote?.total ?? 0);
    const payableTotal = Math.round(accountingTotal);
    setPaymentForm((current) => ({
      ...current,
      amount: current.amount || (accountingTotal ? payableTotal.toFixed(2) : ''),
      reference: current.reference || String(data.workOrder.order_number || ''),
      invoiceId: current.invoiceId || invoice?.id || '',
    }));
  };

  useEffect(() => { refresh().catch((error) => setMessage(error.message || 'No se pudo cargar el flujo comercial.')); }, [orderId]);
  useEffect(() => {
    let cancelled = false;
    const restoreFortnoxTestInvoice = async () => {
      const { data, error } = await supabase.functions.invoke('fortnox-invoice-test-v2', { body: { action: 'get_latest' } });
      if (cancelled || error || !data?.ok || !data?.found) return;
      const result = data;
      setFortnoxInvoiceTest({ state: 'success', message: 'Senaste testfakturan hämtad från Fortnox Test.', result });
      setLastInvoice({
        invoice_number: result.invoiceNumber || '—',
        created_at: result.invoiceDate || new Date().toISOString(),
        due_at: result.dueDate || dueDateFromDays(15),
        total: Number(result.total || 0),
        ocr: result.ocr || '',
        reference: result.testReference || 'Fortnox Test',
        bankgiro: result.bankgiro || '',
        fortnox_test: true,
      });
    };
    restoreFortnoxTestInvoice().catch(() => {});
    return () => { cancelled = true; };
  }, [orderId]);
  useEffect(() => {
    const clearPrintMode = () => setPrintMode(null);
    window.addEventListener('afterprint', clearPrintMode);
    return () => window.removeEventListener('afterprint', clearPrintMode);
  }, []);
  const printDocument = (mode) => {
    const printedAt = new Date();
    const printDateTime = printedAt.toLocaleString('sv-SE', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    const className = mode === 'work-order' ? 'work-order-print' : mode === 'quote' ? 'quote-print' : mode === 'invoice' ? 'invoice-print' : 'receipt-print';
    const source = document.querySelector(`.commercial-flow .${className}`);
    if (!source) return;
    const popup = window.open('', '_blank', 'width=900,height=1100');
    if (!popup) return;
    const printableHtml = source.outerHTML.replace('__PRINT_DATETIME__', printDateTime);
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Bildiagnos OS</title><style>
      @page{size:A4;margin:14mm}html,body{margin:0;padding:0;font-family:Arial,sans-serif;color:#111;font-size:12px;line-height:1.3}
      header{border-bottom:2px solid #111;display:flex;justify-content:space-between;align-items:center;margin:0 0 12px;padding:0 0 8px}
      header>strong{font-size:28px!important;line-height:1!important;font-weight:900!important}h1{font-size:20px!important;line-height:1.1!important;margin:0}.print-info{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 16px;padding:8px 0;border-bottom:1px solid #bbb}.print-info-list{display:grid!important;grid-template-columns:1fr!important;gap:5px!important;align-items:start!important}.print-info-list span{display:block!important;text-align:left!important}
      table{width:100%;border-collapse:collapse;margin-top:8px}tr{break-inside:avoid}td{border-bottom:1px solid #ccc;padding:8px 4px;vertical-align:top}
      th{text-align:left;border-bottom:2px solid #555;padding:8px 4px}td{overflow-wrap:anywhere}
      th:not(:first-child),td:not(:first-child){text-align:right;white-space:nowrap}
      .print-lines th:first-child,.print-lines td:first-child{width:55%}
      .print-section{margin:14px 0}.print-section h2{font-size:14px;margin:0 0 5px}.print-empty{color:#666}.work-order-meta,.invoice-meta{display:grid;grid-template-columns:repeat(3,auto);gap:8px 24px;align-items:center}.work-order-meta p,.invoice-meta p{margin:4px 0}.work-order-approval{margin-top:24px;padding-top:12px;border-top:2px solid #111}.work-order-approval h2{font-size:14px;margin:0 0 8px}.approval-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}.approval-grid p{margin:3px 0}.approval-signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:18px;padding-top:8px}
      .print-totals,.print-totals p,.print-total{text-align:right!important}.print-total{font-size:15px;font-weight:700;margin:14px 0 0;padding-top:8px;border-top:2px solid #111}
      .invoice-classic{box-sizing:border-box;min-height:267mm;display:flex!important;flex-direction:column}.invoice-top{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start;border-bottom:2px solid #111;padding:8px 0 14px}.invoice-brand{border:2px solid #222;padding:16px 22px;display:flex;align-items:baseline;gap:10px;width:max-content}.invoice-brand strong{font-size:29px;letter-spacing:4px}.invoice-brand span{font-size:12px}.invoice-title{display:flex;justify-content:space-between;align-items:baseline;padding-top:7px}.invoice-title h1{font-size:24px!important}.invoice-classic>.invoice-meta{margin-top:13px;min-height:34px}.invoice-address{margin:15px 0 22px;display:grid;gap:5px;min-height:48px}.invoice-address strong{font-size:13px}.invoice-vehicle{margin-bottom:12px}.invoice-vehicle-strip{display:grid;grid-template-columns:.8fr .9fr 1.4fr .8fr 1fr 1.6fr;gap:10px;border-top:1px solid #555;border-bottom:1px solid #555;padding:8px 0;margin:4px 0 15px}.invoice-vehicle-strip span{display:grid;gap:3px}.invoice-vehicle-strip small{font-size:9px;color:#555}.invoice-vehicle-strip b{font-size:11px;overflow-wrap:anywhere}.invoice-classic>.print-section{margin:15px 0}.invoice-classic>.print-section:last-of-type{min-height:72mm}.invoice-bottom{display:grid;grid-template-columns:1fr 1fr;gap:42px;align-items:end;margin-top:auto;padding-top:18px}.invoice-payment-box{border:1px solid #333;padding:11px;min-height:62px}.invoice-payment-box p{margin:4px 0}.invoice-summary p{display:flex;justify-content:space-between;margin:5px 0}.invoice-summary h2{font-size:15px;margin-bottom:7px}.invoice-pay{border-top:2px solid #111;padding-top:10px!important;margin-top:11px!important;font-size:17px;font-weight:700}.invoice-footer{display:grid;grid-template-columns:1.2fr 1fr .8fr;gap:20px;border-top:2px solid #111;margin-top:18px;padding-top:9px;font-size:10px;line-height:1.45;min-height:36px}
      .receipt-classic{box-sizing:border-box;min-height:267mm;display:flex!important;flex-direction:column}.receipt-top{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start;border-bottom:2px solid #111;padding:8px 0 14px}.receipt-title{display:flex;justify-content:space-between;align-items:baseline;padding-top:7px}.receipt-title h1{font-size:24px!important}.receipt-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:14px 0 6px}.receipt-meta p{margin:0}.receipt-bottom{display:grid;grid-template-columns:1fr 1fr;gap:42px;align-items:end;margin-top:auto;padding-top:20px}.receipt-payment{border:1px solid #333;padding:11px;min-height:78px}.receipt-payment p{margin:5px 0}.receipt-thanks{text-align:center;font-weight:700;font-size:15px;margin:24px 0 6px}.receipt-preview-badge{border:2px dashed #777;padding:7px 10px;text-align:center;font-weight:800;letter-spacing:1px;margin:10px 0 14px}.commercial-print{display:block}
    </style></head><body>${printableHtml}</body></html>`);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  };


  const createFortnoxTestInvoice = async () => {
    setFortnoxInvoiceTest({ state: 'loading', message: 'Skapar testfaktura i Fortnox Test…', result: null });
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token) {
      setFortnoxInvoiceTest({ state: 'error', message: 'Sessionen har gått ut. Logga in igen.', result: null });
      return;
    }
    const { data, error } = await supabase.functions.invoke('fortnox-invoice-test-v2', {
      body: { workOrderId: orderId },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error || !data?.ok) {
      setFortnoxInvoiceTest({
        state: 'error',
        message: data?.error || error?.message || 'No se pudo crear la factura de prueba.',
        result: null,
      });
      return;
    }
    setFortnoxInvoiceTest({
      state: 'success',
      message: 'Testfaktura skapad i Fortnox Test. Den har inte skickats eller bokförts.',
      result: data,
    });
    setLastInvoice({
      invoice_number: data.invoiceNumber || '—',
      created_at: data.invoiceDate || new Date().toISOString(),
      due_at: data.dueDate || dueDateFromDays(15),
      total: Number(data.total || 0),
      ocr: data.ocr || '',
      reference: data.reference || 'Fortnox Test',
      bankgiro: data.bankgiro || '',
      fortnox_test: true,
    });
  };

  const quote = context?.quotes[0];
  const quoteLines = useMemo(() => context?.quoteItems.filter((item) => item.quote_id === quote?.id) || [], [context, quote]);
  const serviceLines = quoteLines.filter((item) => item.item_type === 'service');
  const partLines = quoteLines.filter((item) => item.item_type === 'part');
  const pricePending = quoteLines.length > 0 && quoteLines.some((item) => Number(item.unit_price) === 0);
  const liveLines = useMemo(() => {
    if (!context) return [];
    const services = context.services
      .filter((item) => !['rejected', 'removed'].includes(item.status))
      .map((item) => ({
        quantity: Number(item.estimated_minutes || 0) / 60,
        unit_price: Number(item.unit_price || 0),
      }));
    const parts = context.parts
      .filter((item) => !['rejected', 'removed'].includes(item.status))
      .map((item) => ({
        quantity: Number(item.quantity || 1),
        unit_price: Number(item.sale_price || 0),
      }));
    return [...services, ...parts];
  }, [context]);
  // Work/service and part prices are entered excluding VAT. Keep the live
  // order calculation in the same basis as Fortnox: net + 25% VAT.
  const liveSubtotal = liveLines.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const liveVat = liveSubtotal * 0.25;
  const liveTotal = liveSubtotal + liveVat;
  const quoteMatchesLiveOrder = quoteLines.length === liveLines.length &&
    Math.abs(Number(quote?.subtotal || 0) - liveSubtotal) < 0.005 &&
    Math.abs(Number(quote?.total || 0) - liveTotal) < 0.005;
  const displayedSubtotal = quoteMatchesLiveOrder ? Number(quote?.subtotal || 0) : liveSubtotal;
  const displayedVat = quoteMatchesLiveOrder ? Number(quote?.vat_total || 0) : liveVat;
  const displayedTotal = quoteMatchesLiveOrder ? Number(quote?.total || 0) : liveTotal;
  const invoice = context?.invoices[0];
  const invoicePreview = lastInvoice || invoice || {
    invoice_number: 'FÖRHANDSVISNING',
    created_at: new Date().toISOString(),
    due_at: dueDateFromDays(invoiceForm.paymentTermsDays),
    total: displayedTotal,
    reference: invoiceForm.reference || String(context?.workOrder?.order_number || ''),
  };
  // Fortnox sandbox prints the actual order lines, never the old 100 kr placeholder.
  const testServiceLines = (context?.services || []).filter((item) => !['rejected', 'removed'].includes(item.status) && Number(item.estimated_minutes || 0) > 0).map((item) => ({ id: item.id, item_type: 'service', description: item.description, quantity: Number(item.estimated_minutes || 0) / 60, unit_price: Number(item.unit_price || 0) }));
  const testPartLines = (context?.parts || []).filter((item) => !['rejected', 'removed'].includes(item.status) && Number(item.quantity || 0) > 0).map((item) => ({ id: item.id, item_type: 'part', description: item.description_snapshot, quantity: Number(item.quantity || 0), unit_price: Number(item.sale_price || 0) }));
  const printedServiceLines = invoicePreview.fortnox_test ? testServiceLines : serviceLines;
  const printedPartLines = invoicePreview.fortnox_test ? testPartLines : partLines;
  const printedWork = printedServiceLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
  const printedParts = printedPartLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
  const printedSubtotal = printedWork + printedParts;
  const printedVat = Math.round(printedSubtotal * 25) / 100;
  const testPrintMismatch = Boolean(invoicePreview.fortnox_test && Math.abs(Math.round(printedSubtotal + printedVat) - Number(invoicePreview.total || 0)) > 0.01);
  const receiptInvoice = lastReceipt?.invoice || (lastReceipt?.payment?.invoice_id ? context?.invoices.find((item) => item.id === lastReceipt.payment.invoice_id) : null);
  const receiptLines = receiptInvoice ? context?.invoiceItems.filter((item) => item.invoice_id === receiptInvoice.id) || [] : [];
  const receiptSubtotal = receiptInvoice ? Number(receiptInvoice.subtotal || 0) : 0;
  const receiptVat = receiptInvoice ? Number(receiptInvoice.vat_total || 0) : 0;
  const receiptAccountingTotal = receiptInvoice ? Number(receiptInvoice.total || 0) : Number(lastReceipt?.payment?.amount || 0);
  const receiptPayable = Number(lastReceipt?.payment?.amount || Math.round(receiptAccountingTotal));
  const run = async (action, success) => {
    setBusy(true); setMessage('Guardando…');
    try { const value = await action(); await refresh(); await onSaved?.(); setMessage(success); return value; }
    catch (error) { setMessage(error.message || 'No se pudo guardar el cambio.'); return null; }
    finally { setBusy(false); }
  };

  if (!orderId) return <section className="commercial-flow card"><p>Esta orden todavía no está disponible en Supabase.</p></section>;
  if (!context) return <section className="commercial-flow card"><p>Cargando flujo comercial…</p>{message && <p className="commercial-error">{message}</p>}</section>;

  const workOrder = context.workOrder;
  const accepted = quote?.status === 'approved';
  const labels = quoteSettings.documentLanguage === 'es'
    ? { title: 'ORDEN DE TRABAJO', customer: 'Cliente', plate: 'Registreringsnummer', work: 'Trabajos', parts: 'Piezas', quote: 'Offert godkänd', warranty: 'Garanti', print: 'PDF / Imprimir orden' }
    : { title: 'ARBETSORDER', customer: 'Kund', plate: 'Registreringsnummer', work: 'Arbete', parts: 'Reservdelar', quote: 'Offert godkänd', warranty: 'Garanti', print: 'PDF / Skriv ut arbetsorder' };
  const vehicle = context.vehicle || {};
  const vehicleDescription = [vehicle.make, vehicle.model, vehicle.model_year].filter(Boolean).join(' ') || vehicle.raw_description || workOrder.vehicle_snapshot || '—';
  const vehicleInfo = <div className="print-info print-info-list">
    <span>{labels.customer}: <b>{workOrder.customer_name_snapshot || '—'}</b></span>
    <span>{labels.plate}: <b>{workOrder.plate_snapshot || vehicle.registration_plate || '—'}</b></span>
    <span>Fordon: <b>{vehicleDescription}</b></span>
    <span>Mätarställning: <b>{workOrder.mileage ? `${workOrder.mileage} km` : '—'}</b></span>
    {vehicle.vin && <span>VIN: <b>{vehicle.vin}</b></span>}
    {vehicle.engine && <span>Motor: <b>{vehicle.engine}</b></span>}
    {vehicle.fuel_type && <span>Bränsle: <b>{vehicle.fuel_type}</b></span>}
  </div>;

  return <section className="commercial-flow" data-print-mode={printMode || undefined}>
    <header className="commercial-heading">
      <div><p>Affärsflöde</p><h2>Offert, betalning och dokument</h2></div>
      {quote && <span className={`commercial-status commercial-status-${quote.status}`}>{statusLabel(quote.status)}</span>}
    </header>
    {message && <p className={message.includes('No se pudo') ? 'commercial-error' : 'commercial-message'}>{message}</p>}

    <div className="commercial-grid">
      <section className="commercial-card commercial-work-card">
        <h3>Arbeten i arbetsordern</h3>
        <form className="commercial-inline-form" onSubmit={(event) => { event.preventDefault(); run(() => addCommercialService(context, service), 'Arbete tillagt.').then((ok) => ok && setService(emptyService)); }}>
          <input required placeholder="Beskrivning av arbete" value={service.description} onChange={(e) => setService({ ...service, description: e.target.value })} />
          <input required type="number" min="0.01" step="0.01" placeholder="Timmar" value={service.hours} onChange={(e) => setService({ ...service, hours: e.target.value })} />
          <input required type="number" min="0" placeholder="Pris/h" value={service.unitPrice} onChange={(e) => setService({ ...service, unitPrice: e.target.value })} />
          <button disabled={busy}>Añadir</button>
        </form>
        <ul className="commercial-lines">{context.services.filter((item) => !['rejected', 'removed'].includes(item.status)).map((item) => <ServiceLineEditor key={item.id} item={item} busy={busy} onSave={(draft) => run(() => updateCommercialService(item.id, draft), 'Trabajo actualizado.')} onDelete={() => window.confirm('Ta bort detta arbete/tid från arbetsordern? Det tas även bort från den aktuella offerten, men historiska dokument sparas.') && run(() => removeCommercialService(item.id), 'Trabajo eliminado.')} />)}</ul>
      </section>

      <section className="commercial-card commercial-parts-card">
        <h3>Reservdelar i arbetsordern</h3>
        <form className="commercial-inline-form commercial-parts-form" onSubmit={(event) => { event.preventDefault(); run(() => addCommercialPart(context, part), 'Reservdel tillagd.').then((ok) => ok && setPart(emptyPart)); }}>
          <input required placeholder="Reservdel / beskrivning" value={part.description} onChange={(e) => setPart({ ...part, description: e.target.value })} />
          <input placeholder="Artikelnummer" value={part.partNumber} onChange={(e) => setPart({ ...part, partNumber: e.target.value })} />
          <input required type="number" min="1" step="1" placeholder="Cant." value={part.quantity} onChange={(e) => setPart({ ...part, quantity: e.target.value })} />
          <input type="number" min="0" placeholder="Inköpspris" value={part.cost} onChange={(e) => setPart({ ...part, cost: e.target.value })} />
          <input required type="number" min="0" placeholder="Pris" value={part.salePrice} onChange={(e) => setPart({ ...part, salePrice: e.target.value })} />
          <button disabled={busy}>Añadir</button>
        </form>
        <ul className="commercial-lines">{context.parts.filter((item) => !['rejected', 'removed'].includes(item.status)).map((item) => <PartLineEditor key={item.id} item={item} busy={busy} onSave={(draft) => run(() => updateCommercialPart(item.id, draft), 'Pieza actualizada.')} onDelete={() => window.confirm('Ta bort denna reservdel från arbetsordern? Den tas även bort från den aktuella offerten, men historiska dokument sparas.') && run(() => removeCommercialPart(item.id), 'Pieza eliminada.')} />)}</ul>
      </section>
    </div>

    <ProfitabilityPanel context={context} />
    <DeliveryNoteReader orderId={orderId} parts={context.parts} onSaved={async () => { await refresh(); await onSaved?.(); }} />

    <section className="commercial-card quote-card">
      <h3>Kundoffert</h3>
      <div className="commercial-settings">
        <label>Notas<textarea value={quoteSettings.notes} placeholder="Validez, disponibilidad u otras condiciones" onChange={(e) => setQuoteSettings({ ...quoteSettings, notes: e.target.value })} /></label>
        <label className="commercial-check"><input type="checkbox" checked={quoteSettings.variablePrice} onChange={(e) => setQuoteSettings({ ...quoteSettings, variablePrice: e.target.checked })} />Precio variable</label>
        <label className="commercial-check"><input type="checkbox" checked={quoteSettings.warrantyEnabled} onChange={(e) => setQuoteSettings({ ...quoteSettings, warrantyEnabled: e.target.checked })} />Garanti</label>
        {quoteSettings.warrantyEnabled && <><label>Meses<input type="number" min="0" value={quoteSettings.warrantyMonths} onChange={(e) => setQuoteSettings({ ...quoteSettings, warrantyMonths: e.target.value })} /></label><label>Kilometer<input type="number" min="0" step="100" value={quoteSettings.warrantyKm} onChange={(e) => setQuoteSettings({ ...quoteSettings, warrantyKm: e.target.value })} /></label></>}
      </div>
      <div className="commercial-totals commercial-totals-prominent">
        <span><small>Exkl. moms</small><strong>{money(displayedSubtotal)}</strong></span>
        <span><small>Moms 25%</small><strong>{money(displayedVat)}</strong></span>
        <span><small>{pricePending ? 'Känt belopp inkl. moms' : 'Total inkl. moms'}</small><strong>{money(displayedTotal)}</strong></span>
        {!pricePending && Math.abs(Math.round(displayedTotal) - displayedTotal) >= 0.005 && <span><small>Öresutjämning</small><strong>{money(Math.round(displayedTotal) - displayedTotal)}</strong></span>}
        <span className="commercial-grand-total"><small>{pricePending ? 'Känt belopp' : 'Att betala'}</small><strong>{money(pricePending ? displayedTotal : Math.round(displayedTotal))}</strong></span>
      </div>
      {pricePending && <p className="commercial-error">Faltan precios en las líneas marcadas con —. El subtotal conocido no es el precio final; completa las líneas pendientes antes de aceptar o cobrar.</p>}
      <div className="commercial-actions">
        <button disabled={busy} onClick={() => run(() => prepareCommercialQuote(context, quoteSettings), 'Offert förberedd.')}>{quoteMatchesLiveOrder ? 'Förbered offert' : 'Uppdatera offert'}</button>
        <button disabled={busy || !quote} onClick={() => printDocument('quote')}>PDF / Imprimir cotización</button>
        <button disabled={busy || !quote || pricePending} className="approve-button" onClick={() => window.confirm('Bekräfta att kunden har godkänt offerten?') && run(() => decideCommercialQuote(context, 'approved'), 'Offert godkänd.')}>Kunden godkänner</button>
        <button disabled={busy || !quote} className="reject-button" onClick={() => window.confirm('Bekräfta att kunden har avvisat offerten?') && run(() => decideCommercialQuote(context, 'rejected'), 'Offert avvisad.')}>Kunden avvisar</button>
        <button disabled={busy || !accepted} onClick={() => run(() => markApprovedPartsOrdered(context), 'Reservdelar markerade som beställda.')}>Markera reservdelar som beställda</button>
        {quote && <button onClick={() => printDocument('work-order')}>PDF / Skriv ut arbetsorder</button>}{accepted && <><select value={quoteSettings.documentLanguage} onChange={(e) => setQuoteSettings({ ...quoteSettings, documentLanguage: e.target.value })}><option value="sv">Svenska</option><option value="es">Español</option></select><button onClick={() => printDocument('work-order')}>{labels.print}</button></>}
      </div>
    </section>

    <div className="commercial-grid">
      <section className="commercial-card">
        <h3>Betalning och kvitto</h3>
        {invoice && <button type="button" className="secondary-button" onClick={() => {
          const previewPayment = {
            id: 'preview',
            invoice_id: invoice.id,
            method: paymentForm.method || 'Swish',
            amount: Math.round(Number(invoice.total || 0)),
            status: 'preview',
            receipt_reference: 'FÖRHANDSVISNING',
            external_reference: paymentForm.reference || invoice.invoice_number || '',
            accepted_at: new Date().toISOString(),
            preview: true,
          };
          setLastReceipt({ payment: previewPayment, order: workOrder, invoice });
          window.setTimeout(() => printDocument('receipt'), 0);
        }}>Vista previa Kvitto</button>}
        <form className="commercial-inline-form" onSubmit={(event) => { event.preventDefault(); run(() => confirmCommercialPayment(context, paymentForm), 'Betalning bekräftad och kvitto klart.').then((payment) => { if (payment) { setLastReceipt({ payment, order: workOrder, invoice: context.invoices.find((item) => item.id === payment.invoice_id) || invoice || null }); window.setTimeout(() => printDocument('receipt'), 0); } }); }}>
          <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}><option>Swish</option><option>Zettle / Kort</option></select>
          <input required type="number" min="0.01" step="0.01" placeholder="Belopp" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
          <input placeholder="Referens" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} />
          <button disabled={busy || pricePending}>Bekräfta betalning</button>
        </form>
        <ul className="commercial-lines">{context.payments.map((item) => {
          const paymentInvoice = context.invoices.find((inv) => inv.id === item.invoice_id) || null;
          return <li key={item.id}><span>{item.method} · {money(item.amount)}</span><small>{item.receipt_reference || 'Kvitto'} · {date(item.accepted_at)}</small><button type="button" onClick={() => { setLastReceipt({ payment: item, order: workOrder, invoice: paymentInvoice }); window.setTimeout(() => printDocument('receipt'), 0); }}>Imprimir Kvitto</button></li>;
        })}</ul>
      </section>

      <section className="commercial-card">
        <h3>Faktura</h3>
        <form className="commercial-inline-form invoice-form" onSubmit={(event) => { event.preventDefault(); run(() => createCommercialInvoice(context, { ...invoiceForm, dueDate: dueDateFromDays(invoiceForm.paymentTermsDays) }), 'Faktura skapad.').then((created) => created && setLastInvoice({ ...created, billing_snapshot: { ...(created.billing_snapshot || {}), email: invoiceForm.email } })); }}>
          <input required type="email" placeholder="Kundens e-post" value={invoiceForm.email} onChange={(e) => setInvoiceForm({ ...invoiceForm, email: e.target.value })} />
          <label className="invoice-terms">Betalningsvillkor
            <select value={invoiceForm.paymentTermsDays} onChange={(e) => setInvoiceForm({ ...invoiceForm, paymentTermsDays: e.target.value })}>
              <option value="10">10 dagar</option>
              <option value="15">15 dagar</option>
              <option value="20">20 dagar</option>
              <option value="30">30 dagar</option>
            </select>
            <small>Förfallodatum: {date(dueDateFromDays(invoiceForm.paymentTermsDays))}</small>
          </label>
          <input placeholder="Referens" value={invoiceForm.reference} onChange={(e) => setInvoiceForm({ ...invoiceForm, reference: e.target.value })} />
          <button disabled={busy || pricePending}>Skapa faktura</button>
        </form>
        <button type="button" disabled={busy} onClick={() => { setLastInvoice(null); window.setTimeout(() => printDocument('invoice'), 0); }}>Vista previa / Imprimir Faktura</button>
        <div className="fortnox-sandbox-test">
          <strong>Fortnox Test</strong>
          <div className="fortnox-test-customer">
            <span>Testkund:</span>
            <b>Testkund Bildiagnos</b>
          </div>
          <p>Prueba aislada. No usa ni modifica esta orden real.</p>
          <button type="button" className="secondary-button" disabled={fortnoxInvoiceTest.state === 'loading'} onClick={createFortnoxTestInvoice}>
            {fortnoxInvoiceTest.state === 'loading' ? 'Creando prueba…' : 'Skapa testfaktura i Fortnox Test'}
          </button>
          {fortnoxInvoiceTest.message && <p className={`fortnox-test-message ${fortnoxInvoiceTest.state}`}>{fortnoxInvoiceTest.message}</p>}
          {fortnoxInvoiceTest.result && <div className="fortnox-test-result">
            <button type="button" className="secondary-button" onClick={() => {
              setLastInvoice({
                invoice_number: fortnoxInvoiceTest.result.invoiceNumber || '—',
                created_at: fortnoxInvoiceTest.result.invoiceDate || new Date().toISOString(),
                due_at: fortnoxInvoiceTest.result.dueDate || dueDateFromDays(15),
                total: Number(fortnoxInvoiceTest.result.total || 0),
                ocr: fortnoxInvoiceTest.result.ocr || '',
                reference: fortnoxInvoiceTest.result.reference || 'Fortnox Test',
                bankgiro: fortnoxInvoiceTest.result.bankgiro || '',
                fortnox_test: true,
              });
              window.setTimeout(() => printDocument('invoice'), 0);
            }}>Skriv ut Fortnox Test-faktura</button>
            <span>Fakturanr: <b>{fortnoxInvoiceTest.result.invoiceNumber || '—'}</b></span>
            <span>OCR: <b>{fortnoxInvoiceTest.result.ocr || '—'}</b></span>
            <span>Bankgiro: <b>{fortnoxInvoiceTest.result.bankgiro || '—'}</b></span>
            <span>Förfallodatum: <b>{fortnoxInvoiceTest.result.dueDate || '—'}</b></span>
            <span>Total: <b>{money(fortnoxInvoiceTest.result.total)}</b></span>
          </div>}
        </div>
        <ul className="commercial-lines">{context.invoices.map((item) => <li key={item.id}><span>Faktura {item.invoice_number} · {money(item.total)}</span><small>{item.status} · vence {date(item.due_at)}</small><button type="button" onClick={() => { setLastInvoice(item); window.setTimeout(() => printDocument('invoice'), 0); }}>Imprimir</button>{item.status !== 'paid' && <button type="button" onClick={() => run(() => confirmCommercialPayment(context, { method: 'Faktura', amount: Math.round(Number(item.total || 0)), reference: item.invoice_number, invoiceId: item.id }), 'Factura marcada como pagada y Kvitto preparado.').then((payment) => { if (payment) { setLastReceipt({ payment, order: workOrder, invoice: item }); window.setTimeout(() => printDocument('receipt'), 0); } })}>Bekräfta betalning</button>}</li>)}</ul>
      </section>
    </div>

    {quote && <section className="commercial-print quote-print"><header><strong>BILDIAGNOS AB</strong><h1>{quoteSettings.documentLanguage === 'es' ? 'COTIZACIÓN' : 'OFFERT'}</h1></header>
      {vehicleInfo}<p>Offert: <b>#{quote.quote_number || '—'}</b></p>
      <div className="print-section"><h2>{labels.work}</h2><DocumentLinesTable lines={serviceLines} language={quoteSettings.documentLanguage} kind="service" showPrice /></div>
      <div className="print-section"><h2>{labels.parts}</h2><DocumentLinesTable lines={partLines} language={quoteSettings.documentLanguage} kind="part" showPrice /></div>
      <div className="print-totals">
        <p>Exkl. moms: <strong>{money(displayedSubtotal)}</strong></p>
        <p>Moms 25%: <strong>{money(displayedVat)}</strong></p>
        <p className="print-total">{pricePending ? (quoteSettings.documentLanguage === 'es' ? `Total conocido incl. IVA: ${money(displayedTotal)} · faltan precios` : `Känt belopp inkl. moms: ${money(displayedTotal)} · priser saknas`) : `Total inkl. moms: ${money(displayedTotal)}`}</p>
      </div>
    </section>}
    <section className="commercial-print work-order-print">
      <header><strong>BILDIAGNOS AB</strong><h1>{labels.title}</h1></header>
      <div className="work-order-meta">
        <p><strong>{quoteSettings.documentLanguage === 'es' ? 'Orden' : 'Arbetsorder'}: #{workOrder.order_number || '—'}</strong></p>
        <p><strong>Orderdatum:</strong> {date(workOrder.created_at)}</p>
        <p><strong>Utskriftsdatum:</strong> __PRINT_DATETIME__</p>
      </div>
      <p>{quoteSettings.documentLanguage === 'es' ? 'Offert' : 'Offert'}: #{quote?.quote_number || '—'} · {accepted ? (quoteSettings.documentLanguage === 'es' ? 'aceptada' : 'godkänd') : (quoteSettings.documentLanguage === 'es' ? 'väntar på godkännande' : 'inväntar godkännande')}</p>{vehicleInfo}
      <div className="print-section"><h2>{labels.work}</h2><DocumentLinesTable lines={serviceLines} language={quoteSettings.documentLanguage} kind="service" showPrice /></div>
      <div className="print-section"><h2>{labels.parts}</h2><DocumentLinesTable lines={partLines} language={quoteSettings.documentLanguage} kind="part" showPrice /></div>
      <div className="print-totals">
        <p>Exkl. moms: <strong>{money(displayedSubtotal)}</strong></p>
        <p>Moms 25%: <strong>{money(displayedVat)}</strong></p>
        <p className="print-total">{pricePending ? (quoteSettings.documentLanguage === 'es' ? `Total conocido incl. IVA: ${money(displayedTotal)} · faltan precios` : `Känt belopp inkl. moms: ${money(displayedTotal)} · priser saknas`) : `Total inkl. moms: ${money(displayedTotal)}`}</p>
      </div>{quote?.variable_price && <p>Priset kan ändras och ska inte betraktas som fast.</p>}
      <div className="work-order-approval">
        <h2>Godkännande</h2>
        <div className="approval-grid">
          <p><strong>Garanti på utfört arbete:</strong> 3 månader</p>
          <p><strong>Fast pris:</strong> ☐ Ja &nbsp; ☐ Nej</p>
          <p><strong>Maxpris:</strong> __________________ kr</p>
          <p><strong>Tilläggsarbete max:</strong> __________________ kr</p>
        </div>
        <p><strong>Jag godkänner ovanstående arbeten:</strong></p>
        <div className="approval-signatures">
          <span>Ort / datum: __________________________</span>
          <span>Kundens underskrift: __________________________</span>
        </div>
      </div>
    </section>
    {lastReceipt && <section className="commercial-print receipt-print receipt-classic">
      <div className="receipt-top">
        <div className="invoice-brand"><strong>BILDIAGNOS</strong><span>I UTBY AB</span></div>
        <div className="receipt-title"><h1>KVITTO</h1><b>{lastReceipt.payment.receipt_reference || '—'}</b></div>
      </div>
      {lastReceipt.payment.preview && <div className="receipt-preview-badge">FÖRHANDSVISNING · EJ REGISTRERAD BETALNING</div>}
      <div className="receipt-meta">
        <p><small>Datum</small><br/><b>{date(lastReceipt.payment.accepted_at)}</b></p>
        <p><small>Ordernr</small><br/><b>{lastReceipt.order.order_number || '—'}</b></p>
        <p><small>Fakturanr</small><br/><b>{receiptInvoice?.invoice_number || '—'}</b></p>
      </div>
      <div className="invoice-address">
        <small>Kund</small>
        <strong>{lastReceipt.order.customer_name_snapshot || '—'}</strong>
      </div>
      <div className="invoice-vehicle invoice-vehicle-strip">
        <span><small>Reg nr</small><b>{lastReceipt.order.plate_snapshot || vehicle.registration_plate || '—'}</b></span>
        <span><small>Fabrikat</small><b>{vehicle.make || '—'}</b></span>
        <span><small>Modell</small><b>{vehicle.model || vehicle.raw_description || '—'}</b></span>
        <span><small>Årsmodell</small><b>{vehicle.model_year || '—'}</b></span>
        <span><small>Mätarställning</small><b>{lastReceipt.order.mileage ? `${lastReceipt.order.mileage} km` : '—'}</b></span>
        <span><small>VIN</small><b>{vehicle.vin || '—'}</b></span>
      </div>
      {receiptLines.length > 0 && <div className="print-section"><h2>Betalda varor och tjänster</h2><table className="print-lines"><thead><tr><th>Benämning</th><th>Antal</th><th>Pris</th><th>Summa</th></tr></thead><tbody>{receiptLines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{Number(line.quantity || 0).toLocaleString('sv-SE',{maximumFractionDigits:2})}</td><td>{money(line.unit_price)}</td><td>{money(Number(line.quantity || 0) * Number(line.unit_price || 0))}</td></tr>)}</tbody></table></div>}
      <div className="receipt-bottom">
        <div className="receipt-payment">
          <p><strong>Betalsätt:</strong> {lastReceipt.payment.method}</p>
          {lastReceipt.payment.external_reference && <p><strong>Referens:</strong> {lastReceipt.payment.external_reference}</p>}
          <p><strong>Status:</strong> {lastReceipt.payment.preview ? 'Förhandsvisning – ej betald' : 'Betald'}</p>
        </div>
        <div className="invoice-summary">
          {receiptInvoice && <><p><span>Summa exkl. moms</span><b>{money(receiptSubtotal)}</b></p><p><span>Moms 25%</span><b>{money(receiptVat)}</b></p></>}
          {receiptInvoice && Math.abs(receiptPayable - receiptAccountingTotal) >= 0.005 && <p><span>Öresutjämning</span><b>{money(receiptPayable - receiptAccountingTotal)}</b></p>}
          {invoicePreview.fortnox_test && Math.abs(Number(invoicePreview.total || 0) - printedSubtotal - printedVat) >= 0.005 && <p><span>Öresutjämning</span><b>{money(Number(invoicePreview.total || 0) - printedSubtotal - printedVat)}</b></p>}
          <p className="invoice-pay"><span>Betalt</span><b>{money(receiptPayable)}</b></p>
        </div>
      </div>
      <p className="receipt-thanks">Tack för ditt besök!</p>
      <div className="invoice-footer">
        <div><strong>BILDIAGNOS I UTBY AB</strong><br/>VAGNMAKAREGATAN 8C<br/>415 72 GÖTEBORG</div>
        <div>Vat.nr: SE559082480001<br/>Mail: bildiagnosiutbyab@gmail.com<br/>Godkänd för F-skatt</div>
        <div>Tel: 072-975 77 52<br/>Bg: 5927-4746</div>
      </div>
    </section>}
    {<section className="commercial-print invoice-print invoice-classic">
      <div className="invoice-top">
        <div className="invoice-brand"><strong>BILDIAGNOS</strong><span>I UTBY AB</span></div>
        <div className="invoice-title"><h1>FAKTURA</h1><b>Nr: {invoicePreview.invoice_number || '—'}</b></div>
      </div>
      <div className="invoice-meta">
        <p><small>Ordernr</small><br/><b>{invoicePreview.fortnox_test ? 'TEST' : workOrder.order_number || '—'}</b></p>
        <p><small>Fakturadatum</small><br/><b>{date(invoicePreview.created_at)}</b></p>
        <p><small>Förfallodatum</small><br/><b>{date(invoicePreview.due_at)}</b></p>
      </div>
      <div className="invoice-address"><small>Faktureringsadress</small><strong>{invoicePreview.fortnox_test ? 'TESTKUND BILDIAGNOS' : workOrder.customer_name_snapshot || '—'}</strong></div>
      {!invoicePreview.fortnox_test && <div className="invoice-vehicle invoice-vehicle-strip">
        <span><small>Reg nr</small><b>{workOrder.plate_snapshot || vehicle.registration_plate || '—'}</b></span>
        <span><small>Fabrikat</small><b>{vehicle.make || '—'}</b></span>
        <span><small>Modell</small><b>{vehicle.model || vehicle.raw_description || '—'}</b></span>
        <span><small>Årsmodell</small><b>{vehicle.model_year || '—'}</b></span>
        <span><small>Mätarställning</small><b>{workOrder.mileage ? `${workOrder.mileage} km` : '—'}</b></span>
        <span><small>Chassinummer</small><b>{vehicle.vin || '—'}</b></span>
      </div>}
      <div className="print-section"><h2>Utfört arbete</h2><DocumentLinesTable lines={printedServiceLines} language="sv" kind="service" showPrice hideHourlyRate /></div>
      <div className="print-section"><h2>Artiklar</h2><DocumentLinesTable lines={printedPartLines} language="sv" kind="part" showPrice /></div>
      {testPrintMismatch && <p style={{ color: '#b00020', fontWeight: 'bold' }}>FEL: Fakturans rader stämmer inte med Fortnox total. Kontrollera originalfakturan. ANVÄND INTE DETTA DOKUMENT.</p>}
      <div className="invoice-bottom">
        <div className="invoice-payment-box">
          <p><strong>Ange OCR-nr vid betalning:</strong> {invoicePreview.ocr || invoicePreview.ocr_number || '—'}</p>
          <p>Betalningsvillkor: {invoiceForm.paymentTermsDays || 15} dagar netto</p>
          <p>Förfallodatum: {date(invoicePreview.due_at)}</p>
          {invoicePreview.fortnox_test && <p><strong>TESTFAKTURA – ej skickad eller bokförd</strong></p>}
        </div>
        <div className="invoice-summary">
          <h2>Summering:</h2>
          <p><span>Arbete</span><b>{money(printedWork)}</b></p>
          <p><span>Material</span><b>{money(printedParts)}</b></p>
          <p><span>Summa exkl. moms</span><b>{money(invoicePreview.fortnox_test ? printedSubtotal : displayedSubtotal)}</b></p>
          <p><span>Moms 25%</span><b>{money(invoicePreview.fortnox_test ? printedVat : displayedVat)}</b></p>
          {!invoicePreview.fortnox_test && Math.abs(Math.round(Number(invoicePreview.total || displayedTotal)) - Number(invoicePreview.total || displayedTotal)) >= 0.005 && <p><span>Öresutjämning</span><b>{money(Math.round(Number(invoicePreview.total || displayedTotal)) - Number(invoicePreview.total || displayedTotal))}</b></p>}
          <p className="invoice-pay"><span>Att betala</span><b>{money(invoicePreview.fortnox_test ? Number(invoicePreview.total || displayedTotal) : Math.round(Number(invoicePreview.total || displayedTotal)))}</b></p>
        </div>
      </div>
      <div className="invoice-footer">
        <div><strong>BILDIAGNOS I UTBY AB</strong><br/>VAGNMAKAREGATAN 8C<br/>415 72 GÖTEBORG</div>
        <div>Vat.nr: SE559082480001<br/>Mail: bildiagnosiutbyab@gmail.com<br/>Godkänd för F-skatt</div>
        <div>Tel: 072-975 77 52<br/>Bg: 5927-4746</div>
      </div>
    </section>}
  </section>;
}
