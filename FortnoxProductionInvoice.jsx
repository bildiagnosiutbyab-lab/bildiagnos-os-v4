import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient.js';

const money = (value) => Number(value).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' });

export default function FortnoxProductionInvoice({ orderId, expectedTotal, blocked }) {
  const [job, setJob] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const generation = useRef(0);

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
        if (Math.abs(Number(result.preview.total) - Number(expectedTotal)) >= 0.01) {
          throw new Error('El importe de Fortnox no coincide con la orden. Actualiza la cotización antes de facturar.');
        }
        setPreview(result.preview);
      }
    } catch (failure) {
      if (current === generation.current) setError(failure.message);
    } finally {
      lock.current = false;
      if (current === generation.current) setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    return () => { ++generation.current; };
  }, [orderId, expectedTotal, blocked]);

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
    </div>}
    <button type="button" disabled={busy} onClick={refresh}>Consultar estado / Actualizar vista previa</button>
  </section>;
}
