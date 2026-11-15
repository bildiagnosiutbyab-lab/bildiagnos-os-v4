import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient.js';

const money = (value) => Number(value).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' });

export default function FortnoxProductionInvoice({ orderId, expectedTotal, expectedRecipient, blocked, accounting, onLinked }) {
  const [job, setJob] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState(null);
  const [mailPreview, setMailPreview] = useState(null);
  const [mailReviewed, setMailReviewed] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);

  function validatePreview(value) {
    const total = Number(value?.total);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(Number(expectedTotal)) || Math.abs(total - Number(expectedTotal)) >= 0.005) {
      throw new Error('El importe de Fortnox no coincide con la orden. Actualiza la cotización antes de facturar.');
    }
    const repairedOrder = orderId === 'd678b517-6a3c-4cab-8d55-afc92060afab' || value?.reference === 'BOS-700200' || Number(value?.orderNumber) === 700200;
    if (repairedOrder && (orderId !== 'd678b517-6a3c-4cab-8d55-afc92060afab' || value.reference !== 'BOS-700200' || Number(value.orderNumber) !== 700200 || total !== 5565 || Number(expectedTotal) !== 5565 || Number(value.vat) !== 1113)) {
      throw new Error('700200 — JAK77J: el total debe ser exactamente 5.565 kr, IVA incluido.');
    }
    if (!value?.reference || !value?.customerName || !Array.isArray(value.rows) || !value.rows.length) throw new Error('Vista previa incompleta; creación bloqueada.');
  }

  async function invoke(action, extra = {}) {
    const { data, error: requestError } = await supabase.functions.invoke('fortnox-production-invoice', {
      body: { action, workOrderId: orderId, ...extra },
    });
    if (requestError || !data?.ok) {
      let detail = data?.error;
      if (!detail) try { detail = (await requestError?.context?.json())?.error; } catch {}
      throw new Error(detail || requestError?.message || 'No se pudo consultar Fortnox.');
    }
    return data;
  }

  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const status = await invoke('status');
      if (current !== generation.current) return;
      setJob(status.job || null);
      setEmail(status.email || null);
      if (!blocked && (!status.job || status.job.status === 'reconciled')) {
        const result = await invoke('preview');
        if (current !== generation.current) return;
        validatePreview(result.preview);
        setPreview(result.preview);
      }
    } catch (failure) {
      if (current === generation.current) setError(failure.message);
    } finally {
      if (current === generation.current) { lock.current = false; setBusy(false); }
    }
  }

  useEffect(() => {
    setMailPreview(null); setMailReviewed(false); setEmailVerified(false);
    refresh();
    return () => { ++generation.current; lock.current = false; };
  }, [orderId, expectedTotal, blocked]);

  async function prepareEmail() {
    if (lock.current || busy || job?.sentAt || email?.delivery) return;
    lock.current = true; setBusy(true); setError(''); setMailPreview(null); setMailReviewed(false);
    try { if (email?.configured) { await invoke('email-verify'); setEmailVerified(true); } setMailPreview(await invoke('email-preview')); }
    catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }

  async function bookInvoice() {
    if (lock.current || busy || accounting?.booked || accounting?.accountingMethod !== 'ACCRUAL' || !job?.sentAt || job?.bookedAt || job?.bookkeepAttemptedAt) return;
    if (!window.confirm(`Contabilizar en Fortnox la factura ${job.documentNumber}\nTotal: ${money(expectedTotal)}\n\nSe registra la factura como pendiente de cobro. No se registra ningún pago ni se reenvía el correo. ¿Confirmas?`)) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = await invoke('bookkeep', { confirmDocumentNumber: String(job.documentNumber) }); if (!result.booked) throw new Error('Contabilización sin confirmar; revisa Fortnox antes de reintentar.'); await onLinked?.(); const status = await invoke('status'); setJob(status.job || null); }
    catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }

  async function verifyEmail() {
    if (lock.current || busy || !email?.configured) return;
    lock.current = true; setBusy(true); setError(''); setEmailVerified(false);
    try { const result = await invoke('email-verify'); setEmailVerified(result.verified === true); }
    catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }

  function openEmailPdf() {
    if (!mailPreview?.pdfBase64) return;
    const bytes = Uint8Array.from(atob(mailPreview.pdfBase64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const opened = window.open(url, '_blank');
    if (opened) setMailReviewed(true);
    window.setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  async function sendEmail() {
    if (lock.current || busy || !email?.configured || !emailVerified || !mailReviewed || !mailPreview || job?.sentAt || email?.delivery) return;
    if (!window.confirm(`Enviar factura ${mailPreview.documentNumber}\nDestinatario: ${mailPreview.recipient}\nTotal: ${money(mailPreview.total)}\nAdjunto: ${mailPreview.filename}\n\n¿Confirmas el envío de este PDF?`)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await invoke('email-send', { confirmDocumentNumber: String(mailPreview.documentNumber), confirmRecipient: mailPreview.recipient, confirmTotal: mailPreview.total, confirmPdfHash: mailPreview.pdfHash });
      if (!result.sent || !result.messageId) throw new Error('Envío sin confirmación; consulta el historial antes de reintentar.');
      setJob(current => ({ ...current, sentAt: result.sentAt }));
      setEmail(current => ({ ...current, delivery: { status: 'sent', recipient: result.recipient, message_id: result.messageId, sent_at: result.sentAt } }));
      setMailPreview(null); setMailReviewed(false);
      await onLinked?.();
    } catch (failure) {
      setError(failure.message);
      try { const status = await invoke('status'); setJob(status.job || null); setEmail(status.email || null); } catch {}
    } finally { lock.current = false; setBusy(false); }
  }


  async function createAndSendInvoice() {
    if (lock.current || busy || blocked || !preview || error || (job && job.status !== 'reconciled')) return;
    const recipient = String(expectedRecipient || '').trim().toLowerCase();
    if (!recipient || !recipient.includes('@')) { setError('Falta el correo del cliente.'); return; }
    lock.current = true;
    const current = ++generation.current;
    setBusy(true); setError('');
    let number = null;
    try {
      const state = await invoke('status');
      if (state.job && state.job.status !== 'reconciled') throw new Error('Ya existe una operacion de factura; comprueba su estado.');
      if (!state.email?.configured) throw new Error('Configura primero el correo del taller.');
      const checked = await invoke('preview');
      validatePreview(checked.preview);
      const p = checked.preview;
      if (!window.confirm('Crear y enviar factura REAL\\n' + p.customerName + '\\n' + p.reference + '\\n' + money(p.total) + '\\n' + recipient + '\\nConfirmar?')) return;
      const verified = await invoke('email-verify');
      if (!verified.verified) throw new Error('No se pudo verificar el correo del taller.');
      const created = await invoke('create', { confirmReference: p.reference, confirmTotal: Number(p.total) });
      if (!created.documentNumber) throw new Error('Creacion sin numero confirmado. No reintentar.');
      number = String(created.documentNumber);
      setJob({ status: 'submitted', documentNumber: number, ocr: created.ocr, sentAt: null });
      const pdf = await invoke('email-preview');
      if (String(pdf.documentNumber) !== number || String(pdf.recipient).toLowerCase() !== recipient ||
        Math.abs(Number(pdf.total) - Number(p.total)) >= 0.005 || !pdf.pdfHash)
        throw new Error('El PDF no coincide con los datos confirmados. No se envio.');
      const result = await invoke('email-send', { confirmDocumentNumber: number, confirmRecipient: recipient,
        confirmTotal: Number(p.total), confirmPdfHash: pdf.pdfHash });
      if (!result.sent || !result.messageId) throw new Error('El envio no esta confirmado.');
      setJob(previous => ({ ...previous, sentAt: result.sentAt }));
      setEmail(previous => ({ ...previous, delivery: { status: 'sent', recipient, sent_at: result.sentAt } }));
      setPreview(null);
      await onLinked?.();
    } catch (failure) {
      setError((number ? 'Factura ' + number + ' creada; no la vuelvas a crear. ' : '') + failure.message);
      try { const latest = await invoke('status'); if (current === generation.current) { setJob(latest.job || null); setEmail(latest.email || null); } } catch {}
    } finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  }

  async function createInvoice() {
    if (lock.current || busy || blocked || error || !preview || (job && job.status !== 'reconciled')) return;
    lock.current = true;
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setPreview(null);
    let attempted = false;
    try {
      // Refresh the server state and amount before asking for confirmation.
      const status = await invoke('status');
      if (current !== generation.current) return;
      setJob(status.job || null);
      if (status.job && status.job.status !== 'reconciled') return;
      const result = await invoke('preview');
      if (current !== generation.current) return;
      validatePreview(result.preview);
      const confirmed = window.confirm(`Crear una factura REAL en Fortnox para ${result.preview.customerName}\nOrden: ${result.preview.reference}\nTotal: ${money(result.preview.total)} (IVA incluido)\n\nLa factura no se enviará al cliente. ¿Confirmas?`);
      if (!confirmed) { setPreview(result.preview); return; }
      if (current !== generation.current) return;
      attempted = true;
      // The production function checks Fortnox for duplicates before reserving creation.
      const created = await invoke('create', { confirmReference: result.preview.reference, confirmTotal: Number(result.preview.total) });
      if (current !== generation.current) return;
      if (!created.documentNumber) throw new Error('No se recibió el número de factura.');
      setJob({ status: 'submitted', documentNumber: created.documentNumber, ocr: created.ocr, invoiceStatus: created.invoiceStatus, sentAt: null });
      await onLinked?.();
    } catch (failure) {
      if (current === generation.current) setError(attempted ? `${failure.message} Consulta el estado antes de volver a intentar; la factura puede haberse creado.` : failure.message);
    } finally {
      if (current === generation.current) { lock.current = false; setBusy(false); }
    }
  }

  return <section className="fortnox-production" aria-label="Fortnox producción">
    <h3>Fortnox · Factura de producción</h3>
    {busy && <p role="status">Consultando Fortnox…</p>}
    {error && <p role="alert">{error}</p>}
    {blocked && <p>Completa los precios antes de preparar la factura.</p>}
    {job?.documentNumber && <p role="status">Factura Fortnox <strong>{job.documentNumber}</strong> · OCR: {job.ocr || 'Pendiente'} · {job.sentAt ? 'Enviada' : 'Sin envío confirmado'}</p>}
    {accounting && <p role="status">Contabilidad Fortnox: <strong>{accounting.booked ? 'Contabilizada' : 'Sin contabilizar'}</strong> · Saldo pendiente: {accounting.balance == null ? "Por consultar" : money(accounting.balance)}{accounting.accountingMethod === 'CASH' && <> · Método de caja (kontantmetoden): se contabiliza al registrar el cobro.</>}{accounting.accountingMethod === 'ACCRUAL' && <> · Método de facturación (faktureringsmetoden).</>}{!accounting.accountingMethod && <> · Método contable pendiente de verificar.</>}</p>}
    {accounting?.accountingMethod === 'ACCRUAL' && !accounting.booked && job?.sentAt && !job?.bookedAt && <button type="button" disabled={busy || Boolean(job.bookkeepAttemptedAt)} onClick={bookInvoice}>Contabilizar factura en Fortnox</button>}
    {job?.documentNumber && <div className="invoice-email">
      {email?.configured && <button type="button" disabled={busy} onClick={verifyEmail}>Comprobar correo del taller</button>}
      {emailVerified && <p role="status">Correo del taller conectado. Listo para enviar PDF con confirmación.</p>}
      {email && !email.configured && <p>Para enviar las próximas facturas desde Bildiagnos, conecta el correo del taller.</p>}
      {(job.sentAt || job.sendAttemptedAt || email?.delivery) ? <p role="status">{email?.delivery?.status === 'sent' || job.sentAt ? 'Factura enviada por correo' : 'Envío pendiente de verificación. Nuevo envío bloqueado.'}{email?.delivery?.recipient && <> a <strong>{email.delivery.recipient}</strong></>}{email?.delivery?.sent_at && <> · {new Date(email.delivery.sent_at).toLocaleString('sv-SE')}</>}</p> : <>
        <button type="button" disabled={busy} onClick={prepareEmail}>Preparar PDF para enviar por correo</button>
        {mailPreview && <div>
          <p>Factura <strong>{mailPreview.documentNumber}</strong> · {money(mailPreview.total)} · Destinatario: <strong>{mailPreview.recipient}</strong></p>
          <button type="button" onClick={openEmailPdf}>Revisar PDF adjunto</button>
          <button type="button" disabled={busy || !mailReviewed || !email?.configured || !emailVerified} onClick={sendEmail}>Enviar factura por correo</button>
          {!mailReviewed && <p>Abre el PDF antes de confirmar el envío.</p>}
        </div>}
      </>}
    </div>}
    {job && !job.documentNumber && job.status !== 'reconciled' && <p role="status">Operación {job.status}. Creación bloqueada hasta verificar su resultado.</p>}
    {preview && <div role="status">
      <strong>Vista previa · No se ha creado ni enviado ninguna factura</strong>
      <p>{preview.customerName} · {preview.reference}</p>
      <table><thead><tr><th>Trabajo / pieza</th><th>Cantidad</th><th>Precio sin IVA</th></tr></thead>
        <tbody>{preview.rows.map((row, index) => <tr key={index}><td>{row.description}</td><td>{row.quantity}</td><td>{money(row.unitPrice)}</td></tr>)}</tbody>
      </table>
      <p>Sin IVA: {money(Number(preview.total) - Number(preview.vat))} · IVA: {money(preview.vat)} · <strong>Total: {money(preview.total)}</strong></p>
      <p>Lista para revisar. La creación real requiere una confirmación por separado.</p>
      {email?.configured && <button type="button" disabled={busy || blocked || Boolean(error) || !expectedRecipient} onClick={createAndSendInvoice}>Crear y enviar factura (un paso)</button>}
      <button type="button" disabled={busy || blocked || Boolean(error)} onClick={createInvoice}>Solo crear en Fortnox</button>
    </div>}
    <button type="button" disabled={busy} onClick={refresh}>Consultar estado / Actualizar vista previa</button>
  </section>;
}
