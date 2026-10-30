import { useEffect, useMemo, useRef, useState } from 'react';
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
function quoteQuantity(line) { return line.item_type === 'service' ? `${SEK.format(Number(line.quantity || 0) * 100)} perioder` : line.quantity; }
function date(value) { return value ? new Intl.DateTimeFormat('sv-SE').format(new Date(value)) : '—'; }

function DocumentLinesTable({ lines, language, kind, showPrice, hideHourlyRate = false }) {
  if (!lines.length) return <p className="print-empty">{language === 'es' ? 'Inga rader registrerade.' : 'Inga rader registrerade.'}</p>;
  const isSpanish = language === 'es';
  return <table className="print-lines">
    <thead><tr>
      <th>{isSpanish ? 'Beskrivning' : 'Beskrivning'}</th>
      <th>{kind === 'service' ? (isSpanish ? 'Periodos' : 'Perioder') : (isSpanish ? 'Cant.' : 'Antal')}</th>
      {showPrice && <>{!(hideHourlyRate && kind === 'service') && <th>{kind === 'service' ? (isSpanish ? 'Precio/periodo' : 'Pris/period') : (isSpanish ? 'Precio unit.' : 'Pris/st')}</th>}<th>{isSpanish ? 'Importe' : 'Belopp'}</th></>}
    </tr></thead>
    <tbody>{lines.map((line) => <tr key={line.id}>
      <td>{line.description}</td>
      <td>{quoteQuantity(line)}</td>
      {showPrice && <>{!(hideHourlyRate && kind === 'service') && <td>{Number(line.unit_price) > 0 ? money(kind === 'service' ? Number(line.unit_price) / 100 : line.unit_price) : '—'}</td>}<td>{Number(line.unit_price) > 0 ? money(Number(line.quantity) * Number(line.unit_price)) : '—'}</td></>}
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
    <label>Perioder (100 = 1 h)<input type="number" min="0" step="1" value={Math.round(Number(draft.hours || 0) * 10000) / 100} onChange={(e) => setDraft({ ...draft, hours: String(Number(e.target.value || 0) / 100) })} /></label>
    <label>Pris/h<input type="number" min="0" step="0.01" value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })} /></label>
    <small>{statusLabel(item.status)} · {SEK.format(Number(draft.hours || 0) * 100)} perioder × {Number(draft.unitPrice) > 0 ? money(Number(draft.unitPrice) / 100) + '/period = ' + money(Number(draft.unitPrice) * Number(draft.hours || 0)) : 'Pris saknas'}</small>
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
  const [companyForm, setCompanyForm] = useState({ customer_type: 'company', display_name: '', personal_or_org_number: '', email: '', phone: '', address_line: '', postal_code: '', city: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [service, setService] = useState(emptyService);
  const [part, setPart] = useState(emptyPart);
  const [consumablesAmount, setConsumablesAmount] = useState('32');
  const [consumablesQuantity, setConsumablesQuantity] = useState('');
  const [wasteOilLitres, setWasteOilLitres] = useState('0');
  const [wasteOilRate, setWasteOilRate] = useState('15');
  const [quoteSettings, setQuoteSettings] = useState({ notes: '', variablePrice: false, warrantyEnabled: false, warrantyMonths: '3', warrantyKm: '1000', documentLanguage: 'sv' });
  const [invoiceForm, setInvoiceForm] = useState({ email: '', paymentTermsDays: '15', reference: '', ocr: '', notes: '' });
  const [paymentForm, setPaymentForm] = useState({ method: 'Swish', amount: '', reference: '', invoiceId: '' });
  const [paymentNotice, setPaymentNotice] = useState('');
  const paymentSubmitting = useRef(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [lastInvoice, setLastInvoice] = useState(null);
  const [fortnoxInvoiceTest, setFortnoxInvoiceTest] = useState({ state: 'idle', message: '', result: null });
  const [productionPreview, setProductionPreview] = useState(null);
  const [productionBusy, setProductionBusy] = useState(false);
  const [productionInvoice, setProductionInvoice] = useState(null);
  const [productionJob, setProductionJob] = useState({status:'loading'});
  const [productionStatusError, setProductionStatusError] = useState('');
  const [productionSending, setProductionSending] = useState(false);
  const productionRequest = useRef(0);
  const productionAction = useRef(false);
  const productionSendUncertain = useRef(false);
  const [productionStatusBusy, setProductionStatusBusy] = useState(true);
  const invokeProduction = async (body) => {
    const { data, error } = await supabase.functions.invoke('fortnox-production-invoice', { body });
    if (error || !data?.ok) { let detail = data?.error; if (!detail && error?.context?.json) { try { detail = (await error.context.json())?.error; } catch (_) {} } throw new Error(detail || error?.message || 'Fortnox connection failed'); }
    return data;
  };
  const createProductionInvoice = async () => {
    if (productionAction.current || productionStatusBusy || productionStatusError || productionBusy || productionJob || !productionPreview || !orderId) return;
    if (!window.confirm('Skapa en VERKLIG faktura i Fortnox? Fakturan skickas INTE till kunden ännu.')) return;
    productionAction.current = true;
    ++productionRequest.current;
    setProductionBusy(true);
    setProductionJob({ status: 'pending' });
    try {
      const result = await invokeProduction({action:'create',workOrderId:orderId,confirmReference:productionPreview.reference});
      setProductionInvoice(result);
      setProductionJob({status:'submitted',documentNumber:result.documentNumber});
      setProductionPreview(null);
      setMessage('Faktura skapad i Fortnox: ' + result.documentNumber + '. Ej skickad.');
    } catch (error) {
      setProductionJob({ status: 'unknown' });
      setProductionPreview(null);
      setProductionStatusError(error.message || 'Skapandestatus okänd. Kontrollera Fortnox.');
    } finally { productionAction.current = false; setProductionBusy(false); }
  };
  const sendProductionInvoice = async () => {
    if (productionAction.current || productionSendUncertain.current || productionStatusBusy || productionStatusError || productionSending || productionJob?.status !== 'submitted' || productionInvoice?.sent || !productionInvoice?.documentNumber) return;
    if (!window.confirm('Skicka faktura ' + productionInvoice.documentNumber + ' via Fortnox till kunden?')) return;
    productionAction.current = true;
    productionSendUncertain.current = true;
    ++productionRequest.current;
    setProductionSending(true);
    try {
      const result = await invokeProduction({action:'send',workOrderId:orderId,confirmDocumentNumber:productionInvoice.documentNumber});
      setProductionInvoice({...productionInvoice,...result});
      setProductionJob(current=>({...current,sentAt:new Date().toISOString()}));
      setMessage('Faktura skickad: ' + result.documentNumber);
    } catch (error) {
      setProductionStatusError(error.message || 'Utskick okänt. Kontrollera fakturan i Fortnox.');
    } finally { productionAction.current = false; setProductionSending(false); }
  };
  const previewProductionInvoice = async () => {
    if (productionAction.current || productionStatusBusy || productionStatusError || productionBusy || productionJob || !orderId) return;
    productionAction.current = true;
    setProductionBusy(true);
    setProductionPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke('fortnox-production-invoice', {
        body: { action: 'preview', workOrderId: orderId },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Fortnox preview failed');
      setProductionPreview(data.preview);
      setMessage('Fortnox produktion: säker förhandsgranskning klar. Ingen faktura skapad eller skickad.');
    } catch (error) {
      setMessage(error?.message || 'Fortnox kunde inte verifieras.');
    } finally {
      productionAction.current = false;
      setProductionBusy(false);
    }
  };
  const [printMode, setPrintMode] = useState(null);

  const orderId = order.relationalId;
  const reconcileProductionInvoice = async () => {
    if (!orderId || productionAction.current || productionBusy || productionStatusBusy || productionJob?.status !== 'failed') return;
    if (!window.confirm('Kontrollera BOS-700201 mot Fortnox produktion? Ingen faktura skapas eller skickas.')) return;
    productionAction.current = true;
    setProductionBusy(true);
    setProductionStatusError('');
    try {
      const result = await invokeProduction({ action: 'reconcile', workOrderId: orderId, confirmReference: 'BOS-' + order.orderNumber });
      setMessage(result.reconciled ? 'Fortnox kontrollerat: ingen tidigare faktura hittades. Avstämning registrerad.' : 'Fortnox-avstämning klar. Kontrollera status.');
    } catch (error) {
      const reason = error?.message || 'Avstämning misslyckades. Fakturering fortsatt blockerad.';
      setMessage('Fortnox-avstämning misslyckades: ' + reason);
      productionAction.current = false;
      setProductionBusy(false);
      await refreshProductionStatus();
      setProductionStatusError(reason);
      return;
    } finally {
      productionAction.current = false;
      setProductionBusy(false);
    }
    await refreshProductionStatus();
  };
  const refreshProductionStatus = async () => {
    if (!orderId || productionAction.current) return null;
    const request = ++productionRequest.current;
    setProductionStatusBusy(true);
    setProductionJob({ status: 'loading' });
    setProductionStatusError('');
    setProductionPreview(null);
    setProductionInvoice(null);
    try {
      const data = await invokeProduction({ action: 'status', workOrderId: orderId });
      if (!Object.prototype.hasOwnProperty.call(data, 'job') ||
          (data.job !== null && (typeof data.job !== 'object' || Array.isArray(data.job) || !data.job.status))) {
        throw new Error('Ogiltigt svar för Fortnox-status');
      }
      if (request !== productionRequest.current) return null;
      const job = data.job;
      setProductionJob(job);
      setProductionInvoice(job?.documentNumber ? {
        documentNumber: job.documentNumber, ocr: job.ocr,
        invoiceStatus: job.invoiceStatus, sent: Boolean(job.sentAt),
      } : null);
      return data;
    } catch (error) {
      if (request !== productionRequest.current) return null;
      setProductionJob({ status: 'unknown' });
      setProductionStatusError(error.message || 'Okänt fel');
      return null;
    } finally {
      if (request === productionRequest.current) setProductionStatusBusy(false);
    }
  };
  const refresh = async () => {
    if (!orderId) return;
    // Status must run even if loading the commercial data fails.
    void refreshProductionStatus();
    const data = await loadCommercialOrder(orderId);
    setContext(data);


    // Use the stored customer email by default, but preserve an address explicitly edited for this order.
    setInvoiceForm((current) => ({ ...current, email: current.email || data.customer?.email || '' }));
    if (data.customer) setCompanyForm({
      customer_type: data.customer.customer_type || 'company',
      display_name: data.customer.display_name || data.workOrder.customer_name_snapshot || '',
      personal_or_org_number: data.customer.personal_or_org_number || '',
      email: data.customer.email || '',
      phone: data.customer.phone || '',
      address_line: data.customer.address_line || '',
      postal_code: data.customer.postal_code || '',
      city: data.customer.city || '',
    });
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

  useEffect(() => {
    refresh().catch((error) => setMessage(error.message || 'No se pudo cargar el flujo comercial.'));
    return () => { ++productionRequest.current; };
  }, [orderId]);
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
      @page{size:A4;margin:10mm}html,body{margin:0;padding:0;font-family:Arial,sans-serif;color:#111;font-size:11px;line-height:1.25}
      .print-navigation{display:flex;gap:10px;justify-content:space-between;position:sticky;top:0;background:#fff;padding:10px 4px;border-bottom:1px solid #aaa;z-index:100}
      .print-navigation button{font-size:16px;padding:12px 18px;border:1px solid #666;border-radius:8px;background:#eee;color:#111}
      @media print{.print-navigation{display:none!important}}
      header{border-bottom:2px solid #111;display:flex;justify-content:space-between;align-items:center;margin:0 0 12px;padding:0 0 8px}
      header>strong{font-size:28px!important;line-height:1!important;font-weight:900!important}h1{font-size:20px!important;line-height:1.1!important;margin:0}.print-info{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 16px;padding:8px 0;border-bottom:1px solid #bbb}.print-info-list{display:grid!important;grid-template-columns:1fr!important;gap:5px!important;align-items:start!important}.print-info-list span{display:block!important;text-align:left!important}
      table{width:100%;border-collapse:collapse;margin-top:8px}tr{break-inside:avoid}td{border-bottom:1px solid #ccc;padding:8px 4px;vertical-align:top}
      th{text-align:left;border-bottom:2px solid #555;padding:8px 4px}td{overflow-wrap:anywhere}
      th:not(:first-child),td:not(:first-child){text-align:right;white-space:nowrap}
      .print-lines th:first-child,.print-lines td:first-child{width:55%}
      .print-section{margin:14px 0}.print-section h2{font-size:14px;margin:0 0 5px}.print-empty{color:#666}.work-order-meta,.invoice-meta{display:grid;grid-template-columns:repeat(3,auto);gap:8px 24px;align-items:center}.work-order-meta p,.invoice-meta p{margin:4px 0}.work-order-approval{margin-top:24px;padding-top:12px;border-top:2px solid #111}.work-order-approval h2{font-size:14px;margin:0 0 8px}.approval-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}.approval-grid p{margin:3px 0}.approval-signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:18px;padding-top:8px}
      .print-totals,.print-totals p,.print-total{text-align:right!important}.print-total{font-size:15px;font-weight:700;margin:14px 0 0;padding-top:8px;border-top:2px solid #111}
      .invoice-classic{box-sizing:border-box;min-height:267mm;display:flex!important;flex-direction:column}.invoice-top{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start;border-bottom:2px solid #111;padding:8px 0 14px}.invoice-brand{border:2px solid #222;padding:16px 22px;display:flex;align-items:baseline;gap:10px;width:max-content}.invoice-brand strong{font-size:29px;letter-spacing:4px}.invoice-brand span{font-size:12px}.invoice-title{display:flex;justify-content:space-between;align-items:baseline;padding-top:7px}.invoice-title h1{font-size:24px!important}.invoice-classic>.invoice-meta{margin-top:13px;min-height:34px}.invoice-address{margin:15px 0 22px;display:grid;gap:5px;min-height:48px}.invoice-address strong{font-size:13px}.invoice-vehicle{margin-bottom:12px}.invoice-vehicle-strip{display:grid;grid-template-columns:.8fr .9fr 1.4fr .8fr 1fr 1.6fr;gap:10px;border-top:1px solid #555;border-bottom:1px solid #555;padding:8px 0;margin:4px 0 15px}.invoice-vehicle-strip span{display:grid;gap:3px}.invoice-vehicle-strip small{font-size:9px;color:#555}.invoice-vehicle-strip b{font-size:11px;overflow-wrap:anywhere}.invoice-classic>.print-section{margin:15px 0}.invoice-classic>.print-section:last-of-type{min-height:72mm}.invoice-bottom{display:grid;grid-template-columns:1fr 1fr;gap:42px;align-items:end;margin-top:auto;padding-top:18px}.invoice-payment-box{border:1px solid #333;padding:11px;min-height:62px}.invoice-payment-box p{margin:4px 0}.invoice-summary p{display:flex;justify-content:space-between;margin:5px 0}.invoice-summary h2{font-size:15px;margin-bottom:7px}.invoice-pay{border-top:2px solid #111;padding-top:10px!important;margin-top:11px!important;font-size:15px;font-weight:700;display:flex!important;align-items:baseline;justify-content:space-between;gap:8px}.invoice-pay>span{flex:1 1 auto;min-width:0}.invoice-pay>b{flex:0 0 auto;white-space:nowrap!important;word-break:normal!important;overflow-wrap:normal!important;font-size:15px}.invoice-footer{display:grid;grid-template-columns:1.2fr 1fr .8fr;gap:20px;border-top:2px solid #111;margin-top:18px;padding-top:9px;font-size:10px;line-height:1.45;min-height:36px}
      .receipt-classic{box-sizing:border-box;min-height:0!important;display:flex!important;flex-direction:column}.receipt-classic .receipt-bottom{margin-top:18px;padding-top:0}.receipt-classic .invoice-address{margin:9px 0 12px;min-height:0}.receipt-classic .invoice-vehicle-strip{margin:4px 0 8px;padding:5px 0}.receipt-classic .print-section{margin:8px 0}.receipt-classic .print-lines td,.receipt-classic .print-lines th{padding:5px 4px}.receipt-classic .receipt-thanks{margin:12px 0 5px}.receipt-classic .invoice-footer{margin-top:9px;min-height:0;break-inside:avoid}.receipt-top{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:start;border-bottom:2px solid #111;padding:8px 0 14px}.receipt-title{display:flex;justify-content:space-between;align-items:baseline;padding-top:7px}.receipt-title h1{font-size:24px!important}.receipt-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:14px 0 6px}.receipt-meta p{margin:0}.receipt-bottom{display:grid;grid-template-columns:1fr 1fr;gap:42px;align-items:end;margin-top:auto;padding-top:20px}.receipt-payment{border:1px solid #333;padding:11px;min-height:78px}.receipt-payment p{margin:5px 0}.receipt-thanks{text-align:center;font-weight:700;font-size:15px;margin:24px 0 6px}.receipt-preview-badge{border:2px dashed #777;padding:7px 10px;text-align:center;font-weight:800;letter-spacing:1px;margin:10px 0 14px}.commercial-print{display:block}
    </style></head><body><nav class="print-navigation"><button onclick="window.close();setTimeout(function(){history.back()},100)">← Volver a Bildiagnos</button><button onclick="window.print()">Imprimir / PDF</button></nav>${printableHtml}</body></html>`);
    popup.document.close();
    popup.focus();
    // On iOS standalone PWAs the system print sheet may trap navigation.
    // Keep an explicit Back button in the preview instead of auto-opening print.
    const iosStandalone = /iPad|iPhone|iPod/.test(navigator.userAgent) && (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
    if (!iosStandalone) window.setTimeout(() => popup.print(), 250);
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
  // An invoice preview without a prepared quote must still print the actual
  // order services and parts. Do not depend on quoteItems existing.
  const printedServiceLines = invoicePreview.fortnox_test || !serviceLines.length ? testServiceLines : serviceLines;
  const printedPartLines = invoicePreview.fortnox_test || !partLines.length ? testPartLines : partLines;
  const printedWork = printedServiceLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
  const printedParts = printedPartLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
  const printedSubtotal = printedWork + printedParts;
  const printedVat = Math.round(printedSubtotal * 25) / 100;
  const testPrintMismatch = Boolean(invoicePreview.fortnox_test && Math.abs(Math.round(printedSubtotal + printedVat) - Number(invoicePreview.total || 0)) > 0.01);
  const receiptInvoice = lastReceipt?.invoice || (lastReceipt?.payment?.invoice_id ? context?.invoices.find((item) => item.id === lastReceipt.payment.invoice_id) : null);
  const receiptLines = receiptInvoice?.fortnox_test ? [...testServiceLines, ...testPartLines] : receiptInvoice ? context?.invoiceItems.filter((item) => item.invoice_id === receiptInvoice.id) || [] : lastReceipt ? [...testServiceLines, ...testPartLines] : [];
  // Fortnox Test returns the final total but not subtotal/VAT; derive them from the
  // same order rows used for the invoice, including the 25% VAT and ore rounding.
  const receiptSubtotal = receiptInvoice?.fortnox_test || !receiptInvoice ? receiptLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0) : Number(receiptInvoice.subtotal || 0);
  const receiptVat = receiptInvoice?.fortnox_test || !receiptInvoice ? Math.round(receiptSubtotal * 25) / 100 : Number(receiptInvoice.vat_total || 0);
  const receiptAccountingTotal = receiptInvoice?.fortnox_test || !receiptInvoice ? receiptSubtotal + receiptVat : Number(receiptInvoice.total || 0);
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
  const customer = context.customer || {};
  const invoiceCustomer = invoicePreview.fortnox_test ? {} : customer;
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

    <section className="commercial-card" style={{ marginBottom: 16 }}>
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 700, padding: '8px 0' }}>Företagsuppgifter / Datos de empresa — {customer.display_name || workOrder.customer_name_snapshot}</summary>
        <form className="commercial-settings" onSubmit={async (event) => {
          event.preventDefault();
          if (!workOrder.customer_id) { setMessage('Den här arbetsordern saknar en kopplad kund.'); return; }
          setBusy(true); setMessage('');
          try {
            const { error } = await supabase.from('customers').update({
              ...companyForm, customer_type: 'company'
            }).eq('id', workOrder.customer_id).eq('workshop_id', workOrder.workshop_id);
            if (error) throw error;
            await refresh();
            setMessage('Företagsuppgifter sparade / Datos de empresa guardados.');
          } catch (error) { setMessage(error.message || 'Kunde inte spara företagsuppgifterna.'); }
          finally { setBusy(false); }
        }}>
          <label>Företagsnamn<input required value={companyForm.display_name} onChange={(e) => setCompanyForm({ ...companyForm, display_name: e.target.value })} /></label>
          <label>Organisationsnummer<input value={companyForm.personal_or_org_number} onChange={(e) => setCompanyForm({ ...companyForm, personal_or_org_number: e.target.value })} /></label>
          <label>E-post<input type="email" value={companyForm.email} onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })} /></label>
          <label>Telefon<input value={companyForm.phone} onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })} /></label>
          <label>Adress<input value={companyForm.address_line} onChange={(e) => setCompanyForm({ ...companyForm, address_line: e.target.value })} /></label>
          <label>Postnummer<input value={companyForm.postal_code} onChange={(e) => setCompanyForm({ ...companyForm, postal_code: e.target.value })} /></label>
          <label>Ort<input value={companyForm.city} onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })} /></label>
          <button type="submit" disabled={busy}>Spara företagsuppgifter</button>
        </form>
      </details>
    </section>

    <div className="commercial-grid">
      <section className="commercial-card commercial-work-card">
        <h3>Arbeten i arbetsordern</h3>
        <form className="commercial-inline-form" onSubmit={(event) => { event.preventDefault(); run(() => addCommercialService(context, service), 'Arbete tillagt.').then((ok) => ok && setService(emptyService)); }}>
          <input required placeholder="Beskrivning av arbete" value={service.description} onChange={(e) => setService({ ...service, description: e.target.value })} />
          <input required type="number" min="0.01" step="0.01" placeholder="Perioder (100 = 1 h)" value={service.hours === '' ? '' : Math.round(Number(service.hours) * 10000) / 100} onChange={(e) => setService({ ...service, hours: String(Number(e.target.value || 0) / 100) })} />
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

    <section className="commercial-card" style={{marginBottom:16}}>
      <h3>Förbrukningsmaterial och miljöavgift (exkl. moms)</h3>
      <div className="commercial-inline-form">
        <label>Förbrukningsmaterial (antal)<input type="number" min="0.01" step="0.01" placeholder="Ange antal" value={consumablesQuantity} onChange={e=>setConsumablesQuantity(e.target.value)}/></label>
        <label>Pris per enhet (kr)<input type="number" min="0" step="0.01" value={consumablesAmount} onChange={e=>setConsumablesAmount(e.target.value)}/></label>
        <strong>{money(Number(consumablesQuantity||0)*Number(consumablesAmount||0))} exkl. moms</strong>
        <button type="button" disabled={busy || !(Number(consumablesQuantity)>0) || !Number.isFinite(Number(consumablesQuantity)*Number(consumablesAmount)) || Number(consumablesAmount)<0} onClick={()=>run(()=>addCommercialPart(context,{description:'Förbrukningsmaterial',partNumber:'',quantity:consumablesQuantity,cost:'0',salePrice:consumablesAmount}),'Förbrukningsmaterial añadido a la orden.')}>Bekräfta och lägg till material</button>
      </div>
      <div className="commercial-inline-form">
        <label>Spillolja (liter)<input type="number" min="0" step="0.01" value={wasteOilLitres} onChange={e=>setWasteOilLitres(e.target.value)}/></label>
        <label>Miljöavgift (kr/liter)<input type="number" min="0" step="0.01" value={wasteOilRate} onChange={e=>setWasteOilRate(e.target.value)}/></label>
        <strong>{money(Number(wasteOilLitres||0)*Number(wasteOilRate||0))} exkl. moms</strong>
        <button type="button" disabled={busy || Number(wasteOilLitres)<=0 || Number(wasteOilRate)<0 || !Number.isFinite(Number(wasteOilLitres)*Number(wasteOilRate))} onClick={()=>run(()=>addCommercialPart(context,{description:'Miljöavgift – spillolja',partNumber:'',quantity:wasteOilLitres,cost:'0',salePrice:wasteOilRate}),'Miljöavgift añadida a la orden.')}>Añadir miljöavgift</button>
      </div>
      <small>Estos cargos se añaden como líneas de la orden. Puedes corregirlos o eliminarlos en Reservdelar antes de facturar. No pulses Añadir dos veces para el mismo cargo.</small>
    </section>
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
        {(invoice || (testServiceLines.length + testPartLines.length > 0)) && <button type="button" className="secondary-button" onClick={() => {
          // The latest Fortnox Test invoice can belong to another order. Never use
          // its historical total for this order's receipt preview.
          const previewInvoice = invoice || {
            invoice_number: 'FÖRHANDSVISNING',
            total: displayedTotal,
            fortnox_test: true,
            reference: String(workOrder.order_number || ''),
          };
          const previewPayment = {
            id: 'preview',
            invoice_id: previewInvoice.id || null,
            method: paymentForm.method || 'Swish',
            amount: Math.round(Number(previewInvoice.total || 0)),
            status: 'preview',
            receipt_reference: 'FÖRHANDSVISNING',
            external_reference: paymentForm.reference || previewInvoice.invoice_number || '',
            accepted_at: new Date().toISOString(),
            preview: true,
          };
          setLastReceipt({ payment: previewPayment, order: workOrder, invoice: previewInvoice });
          window.setTimeout(() => printDocument('receipt'), 0);
        }}>Vista previa Kvitto {!invoice ? '(Test)' : ''}</button>}
        <form className="commercial-inline-form" onSubmit={(event) => event.preventDefault()}>
          <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}><option>Swish</option><option>Zettle / Kort</option></select>
          <input required type="number" min="0.01" step="0.01" placeholder="Belopp" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
          <input placeholder="Referens" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} />
          <button type="button" disabled={busy || pricePending || paymentSubmitting.current} onClick={async () => {
            if (paymentSubmitting.current || busy || pricePending) return;
            const amount = Number(paymentForm.amount);
            if (!Number.isFinite(amount) || amount <= 0) { setPaymentNotice('Ange ett giltigt belopp innan betalningen registreras.'); return; }
            paymentSubmitting.current = true;
            setPaymentNotice('Kontrollerar och registrerar betalningen…');
            try {
              const payment = await confirmCommercialPayment(context, paymentForm);
              setPaymentNotice('Betalning registrerad i Bildiagnos. Kvitto kan skrivas ut. Fortnox bokföring är inte verifierad.');
              setLastReceipt({ payment, order: workOrder, invoice: context.invoices.find((item) => item.id === payment.invoice_id) || invoice || null });
              await refresh();
              await onSaved?.();
              window.setTimeout(() => printDocument('receipt'), 0);
            } catch (error) {
              setPaymentNotice('Betalningen registrerades inte: ' + (error?.message || 'Okänt fel') + '. Kontrollera orderns betalningar före nytt försök.');
            } finally { paymentSubmitting.current = false; }
          }}>Bekräfta betalning</button>
        </form>
        {paymentNotice && <p role="status" className="commercial-error">{paymentNotice}</p>}
        {context.payments.length > 0 && <p role="status">Fortnox: bokföring ej verifierad. Detta kvitto och betalningen är registrerade i Bildiagnos, men ingen Fortnox-verifikation är bekräftad. Kontrollera med bokföringen innan överföring.</p>}
        <ul className="commercial-lines">{context.payments.map((item) => {
          const paymentInvoice = context.invoices.find((inv) => inv.id === item.invoice_id) || null;
          return <li key={item.id}><span>{item.method} · {money(item.amount)}</span><small>{item.receipt_reference || 'Kvitto'} · {date(item.accepted_at)}</small><button type="button" onClick={() => { setLastReceipt({ payment: item, order: workOrder, invoice: paymentInvoice }); window.setTimeout(() => printDocument('receipt'), 0); }}>Imprimir Kvitto</button></li>;
        })}</ul>
      </section>

      <section className="commercial-card">
        <h3>Faktura</h3>
        <form className="commercial-inline-form invoice-form" onSubmit={(event) => { event.preventDefault(); previewProductionInvoice(); }}>
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
          <button disabled={busy || pricePending || productionBusy || productionStatusBusy || Boolean(productionStatusError) || Boolean(productionJob)}>Skapa faktura – förhandsgranska i Fortnox</button>
        </form>
        {!productionStatusBusy && !productionStatusError && !productionJob && <p role="status">Ingen faktura skapad</p>}
        {productionJob?.status === 'loading' && <p role="status">Kontrollerar fakturastatus…</p>}
        {productionJob && !productionJob.documentNumber && productionJob.status !== 'loading' && <p role="alert">Fortnox: {productionJob.status}. Ny faktura blockerad tills status verifierats.</p>}
        {productionStatusError && <p role="alert">Kunde inte kontrollera Fortnox: {productionStatusError}. Fakturering blockerad.</p>}
        <button type="button" disabled={productionBusy || productionSending || productionStatusBusy} onClick={refreshProductionStatus}>Kontrollera Fortnox-status igen</button>
        {productionJob?.status === 'failed' && <button type="button" disabled={productionBusy || productionStatusBusy || Boolean(productionStatusError)} onClick={reconcileProductionInvoice}>Kontrollera och återställ Fortnox-faktura (ingen faktura skapas)</button>}
        {productionPreview && <div role="status" className="fortnox-test-result">
          <strong>Fortnox produktion – INGEN FAKTURA SKAPAD</strong>
          <p>Order {productionPreview.orderNumber} · Kund {productionPreview.customerName} · {money(productionPreview.total)} inkl. moms</p>
          <p>Referens: {productionPreview.reference} · {productionPreview.rows.length} fakturarader</p>
          <p>Utställning och utskick är spärrade under testningen.</p>
        </div>}
        {productionPreview && !productionStatusBusy && !productionStatusError && !productionInvoice && !productionJob && <button type="button" disabled={productionBusy} onClick={createProductionInvoice}>Bekräfta – skapa RIKTIG faktura i Fortnox (skickas inte)</button>}
        {productionInvoice && <div role="status" className="fortnox-test-result">
          <strong>Fortnox faktura {productionInvoice.documentNumber}</strong>
          <p>OCR: {productionInvoice.ocr || 'Ej tillgängligt'} · Skapande: {productionInvoice.invoiceStatus || productionJob?.status || 'Okänt'} · Utskick: {productionInvoice.sent ? 'Skickad' : productionStatusError || productionSendUncertain.current ? 'Okänt – kontrollera Fortnox' : 'Ej bekräftat skickad'}</p>
          {!productionInvoice.sent && <button type="button" disabled={productionSending || productionStatusBusy || Boolean(productionStatusError) || productionSendUncertain.current || productionJob?.status !== 'submitted'} onClick={sendProductionInvoice}>Skicka fakturan via Fortnox – separat bekräftelse</button>}
        </div>}
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
      {lastReceipt.payment.preview && <div className="receipt-preview-badge">{lastReceipt.invoice?.fortnox_test ? 'FORTNOX TEST · ' : ''}FÖRHANDSVISNING · EJ REGISTRERAD BETALNING</div>}
      <div className="receipt-meta">
        <p><small>Datum</small><br/><b>{date(lastReceipt.payment.accepted_at)}</b></p>
        <p><small>Ordernr</small><br/><b>{lastReceipt.order.order_number || '—'}</b></p>
        <p><small>Fakturanr</small><br/><b>{receiptInvoice?.invoice_number || '—'}</b></p>
      </div>
      <div className="invoice-address">
        <small>Kunduppgifter / Faktureringsadress</small>
        <strong>{lastReceipt.invoice?.fortnox_test ? 'TESTKUND BILDIAGNOS' : customer.display_name || lastReceipt.order.customer_name_snapshot || '—'}</strong>
        <div className="invoice-vehicle invoice-vehicle-strip">
          <span><small>Kundnr</small><b>{lastReceipt.invoice?.fortnox_test ? '—' : lastReceipt.invoice?.customer_number || lastReceipt.order.customer_number || '—'}</b></span>
          <span><small>Org.nr / Personnr</small><b>{lastReceipt.invoice?.fortnox_test ? '—' : customer.personal_or_org_number || '—'}</b></span>
          <span><small>Adress</small><b>{lastReceipt.invoice?.fortnox_test ? '—' : customer.address_line || '—'}</b></span>
          <span><small>Postnr / Ort</small><b>{lastReceipt.invoice?.fortnox_test ? '—' : [customer.postal_code, customer.city].filter(Boolean).join(' ') || '—'}</b></span>
          <span><small>Telefon</small><b>{lastReceipt.invoice?.fortnox_test ? '—' : customer.phone || '—'}</b></span>
          <span><small>E-post</small><b>{lastReceipt.invoice?.fortnox_test ? '—' : customer.email || '—'}</b></span>
        </div>
      </div>
      <div className="invoice-vehicle invoice-vehicle-strip">
        <span><small>Reg nr</small><b>{lastReceipt.order.plate_snapshot || vehicle.registration_plate || '—'}</b></span>
        <span><small>Fabrikat</small><b>{vehicle.make || '—'}</b></span>
        <span><small>Modell</small><b>{vehicle.model || vehicle.raw_description || '—'}</b></span>
        <span><small>Årsmodell</small><b>{vehicle.model_year || '—'}</b></span>
        <span><small>Mätarställning</small><b>{lastReceipt.order.mileage ? `${lastReceipt.order.mileage} km` : '—'}</b></span>
        <span><small>VIN</small><b>{vehicle.vin || '—'}</b></span>
      </div>
      {receiptLines.length > 0 && <div className="print-section"><h2>{lastReceipt.payment.preview ? 'Varor och tjänster (ej betalda)' : 'Betalda varor och tjänster'}</h2><table className="print-lines"><thead><tr><th>Benämning</th><th>Antal</th><th>Pris</th><th>Summa</th></tr></thead><tbody>{receiptLines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{line.item_type === 'service' ? `${(Number(line.quantity || 0) * 100).toLocaleString('sv-SE',{maximumFractionDigits:2})} perioder` : Number(line.quantity || 0).toLocaleString('sv-SE',{maximumFractionDigits:2})}</td><td>{line.item_type === 'service' ? '—' : money(line.unit_price)}</td><td>{money(Number(line.quantity || 0) * Number(line.unit_price || 0))}</td></tr>)}</tbody></table></div>}
      <div className="receipt-bottom">
        <div className="receipt-payment">
          <p><strong>Betalsätt:</strong> {lastReceipt.payment.method}</p>
          {lastReceipt.payment.external_reference && <p><strong>Referens:</strong> {lastReceipt.payment.external_reference}</p>}
          <p><strong>Status:</strong> {lastReceipt.payment.preview ? 'Förhandsvisning – ej betald' : 'Betald'}</p>
        </div>
        <div className="invoice-summary">
          {lastReceipt && <><p><span>Summa exkl. moms</span><b>{money(receiptSubtotal)}</b></p><p><span>Moms 25%</span><b>{money(receiptVat)}</b></p></>}
          {lastReceipt && Math.abs(receiptPayable - receiptAccountingTotal) >= 0.005 && <p><span>Öresutjämning</span><b>{money(receiptPayable - receiptAccountingTotal)}</b></p>}
          <p className="invoice-pay"><span>{lastReceipt.payment.preview ? 'Att betala (förhandsvisning)' : 'Betalt'}</span><b>{money(receiptPayable)}</b></p>
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
        <p><small>Ordernr</small><br/><b>{workOrder.order_number || '—'}</b></p>
        <p><small>Fakturadatum</small><br/><b>{date(invoicePreview.created_at)}</b></p>
        <p><small>Förfallodatum</small><br/><b>{date(invoicePreview.due_at)}</b></p>
      </div>
      <div className="invoice-address">
        <small>Faktureringsadress / Kunduppgifter</small>
        <strong>{invoicePreview.fortnox_test ? 'TESTKUND BILDIAGNOS' : customer.display_name || workOrder.customer_name_snapshot || '—'}</strong>
        <div className="invoice-vehicle invoice-vehicle-strip">
          <span><small>Kundnr</small><b>{invoicePreview.fortnox_test ? '—' : invoicePreview.customer_number || workOrder.customer_number || '—'}</b></span>
          <span><small>Org.nr / Personnr</small><b>{invoiceCustomer.personal_or_org_number || '—'}</b></span>
          <span><small>Adress</small><b>{invoiceCustomer.address_line || '—'}</b></span>
          <span><small>Postnr / Ort</small><b>{[invoiceCustomer.postal_code, invoiceCustomer.city].filter(Boolean).join(' ') || '—'}</b></span>
          <span><small>Telefon</small><b>{invoiceCustomer.phone || '—'}</b></span>
          <span><small>E-post</small><b>{invoiceCustomer.email || '—'}</b></span>
        </div>
      </div>
      <div className="invoice-vehicle invoice-vehicle-strip">
        <span><small>Reg nr</small><b>{workOrder.plate_snapshot || vehicle.registration_plate || '—'}</b></span>
        <span><small>Fabrikat</small><b>{vehicle.make || '—'}</b></span>
        <span><small>Modell</small><b>{vehicle.model || vehicle.raw_description || '—'}</b></span>
        <span><small>Årsmodell</small><b>{vehicle.model_year || '—'}</b></span>
        <span><small>Mätarställning</small><b>{workOrder.mileage ? `${workOrder.mileage} km` : '—'}</b></span>
        <span><small>Chassinummer</small><b>{vehicle.vin || '—'}</b></span>
      </div>
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
          {invoicePreview.fortnox_test && Math.abs(Number(invoicePreview.total || 0) - printedSubtotal - printedVat) >= 0.005 && <p><span>Öresutjämning</span><b>{money(Number(invoicePreview.total || 0) - printedSubtotal - printedVat)}</b></p>}
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
