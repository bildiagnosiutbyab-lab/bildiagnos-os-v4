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
const emptyService = { description: '', quantity: '1', hours: '', unitPrice: '' };

const statusLabels = {
  pending_approval: 'Pendiente de aprobación', approved: 'Aprobado', ordered: 'Pedido',
  prepared: 'Cotización preparada', draft: 'Borrador', rejected: 'Rechazado',
  completed: 'Terminado', quote: 'En cotización',
};
function statusLabel(value) { return statusLabels[value] || value || ''; }

function money(value) { return `${SEK.format(Number(value || 0))} kr`; }
function quoteQuantity(line) { return line.item_type === 'service' ? `${SEK.format(Number(line.quantity || 0))} h` : line.quantity; }
function date(value) { return value ? new Intl.DateTimeFormat('sv-SE').format(new Date(value)) : '—'; }

function DocumentLinesTable({ lines, language, kind, showPrice }) {
  if (!lines.length) return <p className="print-empty">{language === 'es' ? 'Sin líneas registradas.' : 'Inga rader registrerade.'}</p>;
  const isSpanish = language === 'es';
  return <table className="print-lines">
    <thead><tr>
      <th>{isSpanish ? 'Descripción' : 'Beskrivning'}</th>
      <th>{kind === 'service' ? (isSpanish ? 'Horas' : 'Timmar') : (isSpanish ? 'Cant.' : 'Antal')}</th>
      {showPrice && <><th>{kind === 'service' ? (isSpanish ? 'Precio/h' : 'Pris/h') : (isSpanish ? 'Precio unit.' : 'Pris/st')}</th><th>{isSpanish ? 'Importe' : 'Belopp'}</th></>}
    </tr></thead>
    <tbody>{lines.map((line) => <tr key={line.id}>
      <td>{line.description}</td>
      <td>{quoteQuantity(line)}</td>
      {showPrice && <><td>{Number(line.unit_price) > 0 ? money(line.unit_price) : '—'}</td><td>{Number(line.unit_price) > 0 ? money(Number(line.quantity) * Number(line.unit_price)) : '—'}</td></>}
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
    <label>Trabajo<textarea rows="2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
    <label>Horas<input type="number" min="0" step="0.01" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} /></label>
    <label>Precio/h<input type="number" min="0" step="0.01" value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })} /></label>
    <small>{statusLabel(item.status)} · {Number(draft.hours || 0).toFixed(2).replace('.', ',')} h × {Number(draft.unitPrice) > 0 ? money(Number(draft.unitPrice)) + '/h = ' + money(Number(draft.unitPrice) * Number(draft.hours || 0)) : 'Precio pendiente'}</small>
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
    <label>Pieza<textarea rows="2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
    <label>Nº artículo<input value={draft.partNumber} onChange={(e) => setDraft({ ...draft, partNumber: e.target.value })} /></label>
    <label>Cant.<input type="number" min="0.001" step="0.001" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} /></label>
    <label>Coste<input type="number" min="0" step="0.01" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} /></label>
    <label>Precio<input type="number" min="0" step="0.01" value={draft.salePrice} onChange={(e) => setDraft({ ...draft, salePrice: e.target.value })} /></label>
    <label>Desc. %<input type="number" min="0" max="100" step="0.01" value={draft.discount} onChange={(e) => setDraft({ ...draft, discount: e.target.value })} /></label>
    <small>{statusLabel(item.status)} · {Number(draft.salePrice) > 0 ? `Total ${money(Number(draft.salePrice) * Number(draft.quantity || 0))}` : 'Precio pendiente'}</small>
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
      .print-section{margin:14px 0}.print-section h2{font-size:14px;margin:0 0 5px}.print-empty{color:#666}.work-order-meta{display:grid;grid-template-columns:repeat(3,auto);gap:8px 24px;align-items:center}.work-order-meta p{margin:4px 0}.work-order-approval{margin-top:24px;padding-top:12px;border-top:2px solid #111}.work-order-approval h2{font-size:14px;margin:0 0 8px}.approval-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}.approval-grid p{margin:3px 0}.approval-signatures{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:18px;padding-top:8px}
      .print-totals,.print-totals p,.print-total{text-align:right!important}.print-total{font-size:15px;font-weight:700;margin:14px 0 0;padding-top:8px;border-top:2px solid #111}
      .commercial-print{display:block}
    </style></head><body>${printableHtml}</body></html>`);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  };

  const quote = context?.quotes[0];
  const quoteLines = useMemo(() => context?.quoteItems.filter((item) => item.quote_id === quote?.id) || [], [context, quote]);
  const serviceLines = quoteLines.filter((item) => item.item_type === 'service');
  const partLines = quoteLines.filter((item) => item.item_type === 'part');
  const pricePending = quoteLines.length > 0 && quoteLines.some((item) => Number(item.unit_price) === 0);
  const displayedSubtotal = Number(quote?.subtotal || 0);
  const displayedVat = Number(quote?.vat_total || 0);
  const displayedTotal = Number(quote?.total || 0);
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
      <div><p>Flujo comercial</p><h2>Cotización, cobro y documentos</h2></div>
      {quote && <span className={`commercial-status commercial-status-${quote.status}`}>{statusLabel(quote.status)}</span>}
    </header>
    {message && <p className={message.includes('No se pudo') ? 'commercial-error' : 'commercial-message'}>{message}</p>}

    <div className="commercial-grid">
      <section className="commercial-card commercial-work-card">
        <h3>Trabajos de la orden</h3>
        <form className="commercial-inline-form" onSubmit={(event) => { event.preventDefault(); run(() => addCommercialService(context, service), 'Operación añadida.').then((ok) => ok && setService(emptyService)); }}>
          <input required placeholder="Descripción del trabajo" value={service.description} onChange={(e) => setService({ ...service, description: e.target.value })} />
          <input required type="number" min="1" step="0.25" placeholder="Horas" value={service.hours} onChange={(e) => setService({ ...service, hours: e.target.value })} />
          <input required type="number" min="0" placeholder="Precio/h" value={service.unitPrice} onChange={(e) => setService({ ...service, unitPrice: e.target.value })} />
          <button disabled={busy}>Añadir</button>
        </form>
        <ul className="commercial-lines">{context.services.filter((item) => !['rejected', 'removed'].includes(item.status)).map((item) => <ServiceLineEditor key={item.id} item={item} busy={busy} onSave={(draft) => run(() => updateCommercialService(item.id, draft), 'Trabajo actualizado.')} onDelete={() => window.confirm('¿Eliminar este trabajo/tiempo de la orden? Esta acción también lo quitará de la cotización actual; los documentos históricos se conservarán.') && run(() => removeCommercialService(item.id), 'Trabajo eliminado.')} />)}</ul>
      </section>

      <section className="commercial-card commercial-parts-card">
        <h3>Piezas de la orden</h3>
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
      <div className="commercial-totals commercial-totals-prominent">
        <span><small>Exkl. moms</small><strong>{money(displayedSubtotal)}</strong></span>
        <span><small>Moms 25%</small><strong>{money(displayedVat)}</strong></span>
        <span className="commercial-grand-total"><small>{pricePending ? 'Känt belopp inkl. moms' : 'Total inkl. moms'}</small><strong>{money(displayedTotal)}</strong></span>
      </div>
      {pricePending && <p className="commercial-error">Faltan precios en las líneas marcadas con —. El subtotal conocido no es el precio final; completa las líneas pendientes antes de aceptar o cobrar.</p>}
      <div className="commercial-actions">
        <button disabled={busy} onClick={() => run(() => prepareCommercialQuote(context, quoteSettings), 'Cotización preparada.')}>Preparar cotización</button>
        <button disabled={busy || !quote} onClick={() => printDocument('quote')}>PDF / Imprimir cotización</button>
        <button disabled={busy || !quote || pricePending} className="approve-button" onClick={() => window.confirm('¿Confirmar que el cliente aceptó la cotización?') && run(() => decideCommercialQuote(context, 'approved'), 'Cotización aceptada.')}>Cliente acepta</button>
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
          <button disabled={busy || pricePending}>Confirmar pago</button>
        </form>
        <ul className="commercial-lines">{context.payments.map((item) => <li key={item.id}><span>{item.method} · {money(item.amount)}</span><small>{item.receipt_reference} · {date(item.accepted_at)}</small></li>)}</ul>
      </section>

      <section className="commercial-card">
        <h3>Faktura</h3>
        <form className="commercial-inline-form invoice-form" onSubmit={(event) => { event.preventDefault(); run(() => createCommercialInvoice(context, invoiceForm), 'Factura creada.').then((created) => created && setLastInvoice({ ...created, billing_snapshot: { ...(created.billing_snapshot || {}), email: invoiceForm.email } })); }}>
          <input required type="email" placeholder="Correo cliente" value={invoiceForm.email} onChange={(e) => setInvoiceForm({ ...invoiceForm, email: e.target.value })} />
          <input required type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })} />
          <input placeholder="Referencia" value={invoiceForm.reference} onChange={(e) => setInvoiceForm({ ...invoiceForm, reference: e.target.value })} />
          <button disabled={busy || pricePending}>Crear factura</button>
        </form>
        <ul className="commercial-lines">{context.invoices.map((item) => <li key={item.id}><span>Faktura {item.invoice_number} · {money(item.total)}</span><small>{item.status} · vence {date(item.due_at)}</small><button type="button" onClick={() => { setLastInvoice(item); window.setTimeout(() => printDocument('invoice'), 0); }}>Imprimir</button>{item.status !== 'paid' && <button type="button" onClick={() => run(() => confirmCommercialPayment(context, { method: 'Faktura', amount: item.total, reference: item.invoice_number, invoiceId: item.id }), 'Factura marcada como pagada y Kvitto preparado.').then((payment) => { if (payment) { setLastReceipt({ payment, order: workOrder }); window.setTimeout(() => printDocument('receipt'), 0); } })}>Confirmar pago</button>}</li>)}</ul>
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
      <p>{quoteSettings.documentLanguage === 'es' ? 'Cotización' : 'Offert'}: #{quote?.quote_number || '—'} · {accepted ? (quoteSettings.documentLanguage === 'es' ? 'aceptada' : 'godkänd') : (quoteSettings.documentLanguage === 'es' ? 'pendiente de aceptación' : 'inväntar godkännande')}</p>{vehicleInfo}
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
    {lastReceipt && <section className="commercial-print receipt-print"><h1>KVITTO / RECIBO</h1><p>{lastReceipt.payment.receipt_reference}</p><p>{lastReceipt.order.plate_snapshot} · {lastReceipt.payment.method}</p><h2>{money(lastReceipt.payment.amount)}</h2><p>{date(lastReceipt.payment.accepted_at)}</p></section>}
    {(lastInvoice || invoice) && <section className="commercial-print invoice-print"><h1>FAKTURA</h1><p>Nr. {(lastInvoice || invoice).invoice_number}</p><p>{workOrder.customer_name_snapshot} · {workOrder.plate_snapshot}</p><p>Förfallodatum: {date((lastInvoice || invoice).due_at)}</p><h2>{money((lastInvoice || invoice).total)}</h2></section>}
  </section>;
}
