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
import './commercialFlow.css';

const SEK = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyPart = { description: '', partNumber: '', quantity: '1', cost: '', salePrice: '', discount: '' };
const emptyService = { description: '', quantity: '1', hours: '', unitPrice: '1250' };

function money(value) { return `${SEK.format(Number(value || 0))} kr`; }
function date(value) { return value ? new Intl.DateTimeFormat('sv-SE').format(new Date(value)) : '—'; }

function ServiceLineEditor({ item, busy, onSave, onDelete }) {
  const [draft, setDraft] = useState({
    description: item.description || '',
    hours: String(Number(item.estimated_minutes || 0) / 60),
    unitPrice: String(item.unit_price ?? ''),
  });
  useEffect(() => setDraft({
    description: item.description || '',
    hours: String(Number(item.estimated_minutes || 0) / 60),
    unitPrice: String(item.unit_price ?? ''),
  }), [item.description, item.estimated_minutes, item.unit_price]);
  return <li className="commercial-edit-line">
    <label>Trabajo<input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
    <label>Horas<input type="number" min="0" step="0.25" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} /></label>
    <label>Precio/h<input type="number" min="0" step="0.01" value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })} /></label>
    <small>{item.status} · {money(Number(draft.unitPrice || 0) * Number(item.quantity || 1))}</small>
    <div className="commercial-line-actions"><button type="button" disabled={busy} onClick={() => onSave(draft)}>Guardar</button><button type="button" className="reject-button" disabled={busy} onClick={onDelete}>Eliminar</button></div>
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
    <label>Pieza<input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
    <label>Nº artículo<input value={draft.partNumber} onChange={(e) => setDraft({ ...draft, partNumber: e.target.value })} /></label>
    <label>Cant.<input type="number" min="0.001" step="0.001" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} /></label>
    <label>Coste<input type="number" min="0" step="0.01" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} /></label>
    <label>Precio<input type="number" min="0" step="0.01" value={draft.salePrice} onChange={(e) => setDraft({ ...draft, salePrice: e.target.value })} /></label>
    <label>Desc. %<input type="number" min="0" max="100" step="0.01" value={draft.discount} onChange={(e) => setDraft({ ...draft, discount: e.target.value })} /></label>
    <small>{item.status} · Total {money(Number(draft.salePrice || 0) * Number(draft.quantity || 0))}</small>
    <div className="commercial-line-actions"><button type="button" disabled={busy} onClick={() => onSave(draft)}>Guardar</button><button type="button" className="reject-button" disabled={busy} onClick={onDelete}>Eliminar</button></div>
  </li>;
}

export default function CommercialOrderFlow({ order, onSaved }) {
  const [context, setContext] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [service, setService] = useState(emptyService);
  const [part, setPart] = useState(emptyPart);
  const [quoteSettings, setQuoteSettings] = useState({ notes: '', variablePrice: false, warrantyEnabled: false, warrantyMonths: '3', warrantyKm: '1000', documentLanguage: 'sv' });
  const [invoiceForm, setInvoiceForm] = useState({ email: '', dueDate: '', reference: '', ocr: '', notes: '' });
  const [paymentForm, setPaymentForm] = useState({ method: 'Swish', amount: '', reference: '', invoiceId: '' });
  const [lastReceipt, setLastReceipt] = useState(null);
  const [lastInvoice, setLastInvoice] = useState(null);
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
    setPaymentForm((current) => ({ ...current, amount: current.amount || String(quote?.total || ''), reference: current.reference || String(data.workOrder.order_number || '') }));
  };

  useEffect(() => { refresh().catch((error) => setMessage(error.message || 'No se pudo cargar el flujo comercial.')); }, [orderId]);
  useEffect(() => {
    const clearPrintMode = () => setPrintMode(null);
    window.addEventListener('afterprint', clearPrintMode);
    return () => window.removeEventListener('afterprint', clearPrintMode);
  }, []);
  const printDocument = (mode) => {
    const className = mode === 'work-order' ? 'work-order-print' : mode === 'quote' ? 'quote-print' : mode === 'invoice' ? 'invoice-print' : 'receipt-print';
    const source = document.querySelector(`.commercial-flow .${className}`);
    if (!source) return;
    const popup = window.open('', '_blank', 'width=900,height=1100');
    if (!popup) return;
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Bildiagnos OS</title><style>
      @page{size:A4;margin:14mm}html,body{margin:0;padding:0;font-family:Arial,sans-serif;color:#111}
      header{border-bottom:2px solid #111;display:flex;justify-content:space-between;align-items:center;margin:0 0 12px;padding:0 0 8px}
      h1{font-size:24px;margin:0}.print-info{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 16px;padding:8px 0;border-bottom:1px solid #bbb}
      table{width:100%;border-collapse:collapse;margin-top:8px}tr{break-inside:avoid}td{border-bottom:1px solid #ccc;padding:8px 4px;vertical-align:top}
      td:last-child{text-align:right;white-space:nowrap}.print-total{text-align:right;font-size:18px;font-weight:700;margin:14px 0 0;padding-top:8px;border-top:2px solid #111}
      .commercial-print{display:block}
    </style></head><body>${source.outerHTML}</body></html>`);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  };

  const quote = context?.quotes[0];
  const quoteLines = useMemo(() => context?.quoteItems.filter((item) => item.quote_id === quote?.id) || [], [context, quote]);
  const invoice = context?.invoices[0];
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
    ? { title: 'ORDEN DE TRABAJO', customer: 'Cliente', plate: 'Matrícula', work: 'Trabajos', parts: 'Piezas', quote: 'Cotización aceptada', warranty: 'Garantía', print: 'PDF / Imprimir orden' }
    : { title: 'ARBETSORDER', customer: 'Kund', plate: 'Registreringsnummer', work: 'Arbete', parts: 'Reservdelar', quote: 'Offert godkänd', warranty: 'Garanti', print: 'PDF / Skriv ut arbetsorder' };

  return <section className="commercial-flow" data-print-mode={printMode || undefined}>
    <header className="commercial-heading">
      <div><p>Flujo comercial</p><h2>Cotización, cobro y documentos</h2></div>
      {quote && <span className={`commercial-status commercial-status-${quote.status}`}>{quote.status}</span>}
    </header>
    {message && <p className={message.includes('No se pudo') ? 'commercial-error' : 'commercial-message'}>{message}</p>}

    <div className="commercial-grid">
      <section className="commercial-card">
        <h3>Operaciones</h3>
        <form className="commercial-inline-form" onSubmit={(event) => { event.preventDefault(); run(() => addCommercialService(context, service), 'Operación añadida.').then((ok) => ok && setService(emptyService)); }}>
          <input required placeholder="Descripción del trabajo" value={service.description} onChange={(e) => setService({ ...service, description: e.target.value })} />
          <input required type="number" min="1" step="0.25" placeholder="Horas" value={service.hours} onChange={(e) => setService({ ...service, hours: e.target.value })} />
          <input required type="number" min="0" placeholder="Precio/h" value={service.unitPrice} onChange={(e) => setService({ ...service, unitPrice: e.target.value })} />
          <button disabled={busy}>Añadir</button>
        </form>
        <ul className="commercial-lines">{context.services.filter((item) => !['rejected', 'removed'].includes(item.status)).map((item) => <ServiceLineEditor key={item.id} item={item} busy={busy} onSave={(draft) => run(() => updateCommercialService(item.id, draft), 'Trabajo actualizado.')} onDelete={() => window.confirm('¿Eliminar este trabajo/tiempo de la orden? Esta acción también lo quitará de la cotización actual; los documentos históricos se conservarán.') && run(() => removeCommercialService(item.id), 'Trabajo eliminado.')} />)}</ul>
      </section>

      <section className="commercial-card">
        <h3>Piezas</h3>
        <form className="commercial-inline-form commercial-parts-form" onSubmit={(event) => { event.preventDefault(); run(() => addCommercialPart(context, part), 'Pieza añadida.').then((ok) => ok && setPart(emptyPart)); }}>
          <input required placeholder="Pieza / descripción" value={part.description} onChange={(e) => setPart({ ...part, description: e.target.value })} />
          <input placeholder="Nº artículo" value={part.partNumber} onChange={(e) => setPart({ ...part, partNumber: e.target.value })} />
          <input required type="number" min="1" step="1" placeholder="Cant." value={part.quantity} onChange={(e) => setPart({ ...part, quantity: e.target.value })} />
          <input type="number" min="0" placeholder="Coste" value={part.cost} onChange={(e) => setPart({ ...part, cost: e.target.value })} />
          <input required type="number" min="0" placeholder="Precio" value={part.salePrice} onChange={(e) => setPart({ ...part, salePrice: e.target.value })} />
          <button disabled={busy}>Añadir</button>
        </form>
        <ul className="commercial-lines">{context.parts.filter((item) => !['rejected', 'removed'].includes(item.status)).map((item) => <PartLineEditor key={item.id} item={item} busy={busy} onSave={(draft) => run(() => updateCommercialPart(item.id, draft), 'Pieza actualizada.')} onDelete={() => window.confirm('¿Eliminar esta pieza de la orden? Esta acción también la quitará de la cotización actual; los documentos históricos se conservarán.') && run(() => removeCommercialPart(item.id), 'Pieza eliminada.')} />)}</ul>
      </section>
    </div>

    <section className="commercial-card quote-card">
      <h3>Cotización del cliente</h3>
      <div className="commercial-settings">
        <label>Notas<textarea value={quoteSettings.notes} placeholder="Validez, disponibilidad u otras condiciones" onChange={(e) => setQuoteSettings({ ...quoteSettings, notes: e.target.value })} /></label>
        <label className="commercial-check"><input type="checkbox" checked={quoteSettings.variablePrice} onChange={(e) => setQuoteSettings({ ...quoteSettings, variablePrice: e.target.checked })} />Precio variable</label>
        <label className="commercial-check"><input type="checkbox" checked={quoteSettings.warrantyEnabled} onChange={(e) => setQuoteSettings({ ...quoteSettings, warrantyEnabled: e.target.checked })} />Garantía</label>
        {quoteSettings.warrantyEnabled && <><label>Meses<input type="number" min="0" value={quoteSettings.warrantyMonths} onChange={(e) => setQuoteSettings({ ...quoteSettings, warrantyMonths: e.target.value })} /></label><label>Kilómetros<input type="number" min="0" step="100" value={quoteSettings.warrantyKm} onChange={(e) => setQuoteSettings({ ...quoteSettings, warrantyKm: e.target.value })} /></label></>}
      </div>
      <div className="commercial-totals"><span>Exkl. moms <strong>{money(quote?.subtotal)}</strong></span><span>Moms <strong>{money(quote?.vat_total)}</strong></span><span>Total <strong>{money(quote?.total)}</strong></span></div>
      <div className="commercial-actions">
        <button disabled={busy} onClick={() => run(() => prepareCommercialQuote(context, quoteSettings), 'Cotización preparada.')}>Preparar cotización</button>
        <button disabled={busy || !quote} onClick={() => printDocument('quote')}>PDF / Imprimir cotización</button>
        <button disabled={busy || !quote} className="approve-button" onClick={() => window.confirm('¿Confirmar que el cliente aceptó la cotización?') && run(() => decideCommercialQuote(context, 'approved'), 'Cotización aceptada.')}>Cliente acepta</button>
        <button disabled={busy || !quote} className="reject-button" onClick={() => window.confirm('¿Confirmar que el cliente rechazó la cotización?') && run(() => decideCommercialQuote(context, 'rejected'), 'Cotización rechazada.')}>Cliente rechaza</button>
        <button disabled={busy || !accepted} onClick={() => run(() => markApprovedPartsOrdered(context), 'Piezas marcadas como pedidas.')}>Marcar piezas pedidas</button>
        {quote && <button onClick={() => printDocument('work-order')}>PDF / Imprimir arbetsorder</button>}{accepted && <><select value={quoteSettings.documentLanguage} onChange={(e) => setQuoteSettings({ ...quoteSettings, documentLanguage: e.target.value })}><option value="sv">Svenska</option><option value="es">Español</option></select><button onClick={() => printDocument('work-order')}>{labels.print}</button></>}
      </div>
    </section>

    <div className="commercial-grid">
      <section className="commercial-card">
        <h3>Cobro y Kvitto</h3>
        <form className="commercial-inline-form" onSubmit={(event) => { event.preventDefault(); run(() => confirmCommercialPayment(context, paymentForm), 'Pago confirmado y Kvitto preparado.').then((payment) => { if (payment) { setLastReceipt({ payment, order: workOrder }); window.setTimeout(() => printDocument('receipt'), 0); } }); }}>
          <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}><option>Swish</option><option>Zettle / Kort</option></select>
          <input required type="number" min="0.01" step="0.01" placeholder="Importe" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
          <input placeholder="Referencia" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} />
          <button disabled={busy}>Confirmar pago</button>
        </form>
        <ul className="commercial-lines">{context.payments.map((item) => <li key={item.id}><span>{item.method} · {money(item.amount)}</span><small>{item.receipt_reference} · {date(item.accepted_at)}</small></li>)}</ul>
      </section>

      <section className="commercial-card">
        <h3>Faktura</h3>
        <form className="commercial-inline-form invoice-form" onSubmit={(event) => { event.preventDefault(); run(() => createCommercialInvoice(context, invoiceForm), 'Factura creada.').then((created) => created && setLastInvoice({ ...created, billing_snapshot: { ...(created.billing_snapshot || {}), email: invoiceForm.email } })); }}>
          <input required type="email" placeholder="Correo cliente" value={invoiceForm.email} onChange={(e) => setInvoiceForm({ ...invoiceForm, email: e.target.value })} />
          <input required type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })} />
          <input placeholder="Referencia" value={invoiceForm.reference} onChange={(e) => setInvoiceForm({ ...invoiceForm, reference: e.target.value })} />
          <button disabled={busy}>Crear factura</button>
        </form>
        <ul className="commercial-lines">{context.invoices.map((item) => <li key={item.id}><span>Faktura {item.invoice_number} · {money(item.total)}</span><small>{item.status} · vence {date(item.due_at)}</small><button type="button" onClick={() => { setLastInvoice(item); window.setTimeout(() => printDocument('invoice'), 0); }}>Imprimir</button>{item.status !== 'paid' && <button type="button" onClick={() => run(() => confirmCommercialPayment(context, { method: 'Faktura', amount: item.total, reference: item.invoice_number, invoiceId: item.id }), 'Factura marcada como pagada y Kvitto preparado.').then((payment) => { if (payment) { setLastReceipt({ payment, order: workOrder }); window.setTimeout(() => printDocument('receipt'), 0); } })}>Confirmar pago</button>}</li>)}</ul>
      </section>
    </div>

    {quote && <section className="commercial-print quote-print"><header><strong>BILDIAGNOS I UTBY AB</strong><h1>OFFERT / COTIZACIÓN</h1></header><div className="print-info"><span>Kund / Cliente: <b>{workOrder.customer_name_snapshot}</b></span><span>Reg.nr / Matrícula: <b>{workOrder.plate_snapshot}</b></span><span>Mätarställning / Km: <b>{workOrder.mileage || '—'} km</b></span></div><table><tbody>{quoteLines.map((x) => <tr key={x.id}><td>{x.description}</td><td>{x.quantity}</td><td>{money(x.quantity * x.unit_price)}</td></tr>)}</tbody></table><p className="print-total">Total: {money(quote.total)}</p></section>}
    <section className="commercial-print work-order-print">
      <header><strong>BILDIAGNOS I UTBY AB</strong><h1>{labels.title}</h1></header>
      <p>{labels.quote} · #{quote?.quote_number || '—'}</p><div className="print-info"><span>{labels.customer}: <b>{workOrder.customer_name_snapshot}</b></span><span>{labels.plate}: <b>{workOrder.plate_snapshot}</b></span><span>Mätarställning: <b>{workOrder.mileage || '—'} km</b></span></div>
      <h3>{labels.work}</h3><table><tbody>{quoteLines.filter((x) => x.item_type === 'service').map((x) => <tr key={x.id}><td>{x.description}</td><td>{x.quantity}</td><td>{money(x.quantity * x.unit_price)}</td></tr>)}</tbody></table>
      <h3>{labels.parts}</h3><table><tbody>{quoteLines.filter((x) => x.item_type === 'part').map((x) => <tr key={x.id}><td>{x.description}</td><td>{x.quantity}</td><td>{money(x.quantity * x.unit_price)}</td></tr>)}</tbody></table>
      <p className="print-total">Total: {money(quote?.total)}</p>{quote?.variable_price && <p>Priset kan ändras och ska inte betraktas som fast.</p>}{quote?.warranty_enabled && <p>{labels.warranty}: {quote.warranty_months} månader / {quote.warranty_km} km.</p>}
    </section>
    {lastReceipt && <section className="commercial-print receipt-print"><h1>KVITTO / RECIBO</h1><p>{lastReceipt.payment.receipt_reference}</p><p>{lastReceipt.order.plate_snapshot} · {lastReceipt.payment.method}</p><h2>{money(lastReceipt.payment.amount)}</h2><p>{date(lastReceipt.payment.accepted_at)}</p></section>}
    {(lastInvoice || invoice) && <section className="commercial-print invoice-print"><h1>FAKTURA</h1><p>Nr. {(lastInvoice || invoice).invoice_number}</p><p>{workOrder.customer_name_snapshot} · {workOrder.plate_snapshot}</p><p>Förfallodatum: {date((lastInvoice || invoice).due_at)}</p><h2>{money((lastInvoice || invoice).total)}</h2></section>}
  </section>;
}
