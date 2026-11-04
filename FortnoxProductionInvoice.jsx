import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient.js';

const money = (value) => Number(value).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' });

export default function FortnoxProductionInvoice({ orderId, expectedTotal, blocked, onLinked }) {
  const [job, setJob] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
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
    if (requestError || !data?.ok) throw new Error(data?.error || requestError?.message || 'No se pudo consultar Fortnox.');
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
    refresh();
    return () => { ++generation.current; lock.current = false; };
  }, [orderId, expectedTotal, blocked]);

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
