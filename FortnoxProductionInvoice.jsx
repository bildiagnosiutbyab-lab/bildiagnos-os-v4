import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient.js';

const money = (value) => Number(value).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' });

export default function FortnoxProductionInvoice({ orderId, expectedTotal, blocked, onLinked }) {
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
      <button type="button" disabled={busy || blocked || Boolean(error)} onClick={createInvoice}>Skapa faktura i Fortnox</button>
    </div>}
    <button type="button" disabled={busy} onClick={refresh}>Consultar estado / Actualizar vista previa</button>
  </section>;
}
