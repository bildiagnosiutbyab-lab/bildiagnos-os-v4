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
} from './commercialRepository.js';
import './commercialFlow.css';

const SEK = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyPart = { description: '', partNumber: '', quantity: '1', cost: '', salePrice: '', discount: '' };
const emptyService = { description: '', quantity: '1', hours: '', unitPrice: '1250' };

function money(value) { return `${SEK.format(Number(value || 0))} kr`; }
function date(value) { return value ? new Intl.DateTimeFormat('sv-SE').format(new Date(value)) : '—'; }
function printDocument() { window.print(); }

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

  return <section className="commercial-flow">
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
        <ul className="commercial-lines">{context.services.map((item) => <li key={item.id}><span>{item.description}</span><small>{item.status} · {Number(item.estimated_minutes || 0) / 60} h · {money(Number(item.unit_price || 0) * Number(item.quantity || 1))}</small></li>)}</ul>
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
        <ul className="commercial-lines">{context.parts.map((item) => <li key={item.id}><span>{[item.part_number_snapshot, item.description_snapshot].filter(Boolean).join(' · ')}</span><small>{item.status} · {item.quantity} st · {money(Number(item.sale_price || 0) * Number(item.quantity || 1))}</small></li>)}</ul>
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
        <button disabled={busy || !quote} className="approve-button" onClick={() => window.confirm('¿Confirmar que el cliente aceptó la cotización?') && run(() => decideCommercialQuote(context, 'approved'), 'Cotización aceptada.')}>Cliente acepta</button>
        <button disabled={busy || !quote} className="reject-button" onClick={() => window.confirm('¿Confirmar que el cliente rechazó la cotización?') && run(() => decideCommercialQuote(context, 'rejected'), 'Cotización rechazada.')}>Cliente rechaza</button>
        <button disabled={busy || !accepted} onClick={() => run(() => markApprovedPartsOrdered(context), 'Piezas marcadas como pedidas.')}>Marcar piezas pedidas</button>
        {accepted && <><select value={quoteSettings.documentLanguage} onChange={(e) => setQuoteSettings({ ...quoteSettings, documentLanguage: e.target.value })}><option value="sv">Svenska</option><option value="es">Español</option></select><button onClick={printDocument}>{labels.print}</button></>}
      </div>
    </section>

    <div className="commercial-grid">
      <section className="commercial-card">
        <h3>Cobro y Kvitto</h3>
        <form className="commercial-inline-form" onSubmit={(event) => { event.preventDefault(); run(() => confirmCommercialPayment(context, paymentForm), 'Pago confirmado y Kvitto preparado.').then((payment) => payment && setLastReceipt({ payment, order: workOrder })); }}>
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
        <ul className="commercial-lines">{context.invoices.map((item) => <li key={item.id}><span>Faktura {item.invoice_number} · {money(item.total)}</span><small>{item.status} · vence {date(item.due_at)}</small></li>)}</ul>
      </section>
    </div>

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
