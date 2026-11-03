import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';

// A narrow maintenance route, authorized by the signed-in workshop owner.
// The server restricts recovery to this exact failed attempt and never issues invoices.
export default function FortnoxInvoiceRecovery() {
  const diagnostic = new URLSearchParams(window.location.search).get('mode') === 'diagnose';
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: requestError } = await supabase.functions.invoke('fortnox-production-invoice', {
        body: { action: diagnostic ? 'diagnose700200' : 'recover700200', workOrderId: 'd678b517-6a3c-4cab-8d55-afc92060afab', expectedJobId: 'f39d5a07-ebfb-41a3-96e2-67cacaa188d8', expectedJobUpdatedAt: '2026-11-03T19:40:58.728+00:00', confirmReference: 'BOS-700200' },
      });
      if (!active) return;
      if (requestError || !data?.ok) {
        let message = data?.error || requestError?.message || 'No se pudo completar la comprobación.';
        if (requestError?.context?.json) {
          try { message = (await requestError.context.json()).error || message; } catch {}
        }
        if (active) setError(message);
      } else setResult(data);
    })().catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  return <section className="card" aria-label="Recuperación Fortnox 700200">
    <h1>Recuperación 700200 — JAK77J</h1>
    <p>ROX INTERNATIONAL AB · BOS-700200 · 5.565 kr, IVA incluido</p>
    {!result && !error && <p role="status">Consultando directamente Fortnox y registrando la conciliación…</p>}
    {error && <p role="alert">{error} La operación sigue bloqueada hasta verificar el resultado.</p>}
    {result && <div role="status">
      <h2>{diagnostic ? 'Diagnóstico de solo lectura completado' : result.status === 'submitted' ? 'Factura existente recuperada' : 'Conciliación completada: no existe factura para BOS-700200'}</h2>
      {diagnostic && <pre>{JSON.stringify(result, null, 2)}</pre>}
      <p>Estado: {result.status}</p>
      {result.documentNumber && <p>Factura: <strong>{result.documentNumber}</strong> · OCR: <strong>{result.ocr || 'Pendiente'}</strong></p>}
      <p>Consulta: {result.checkedAt || 'Conciliación previa conservada'}</p>
      <p>No se ha creado, enviado ni contabilizado ninguna factura durante esta recuperación.</p>
    </div>}
  </section>;
}
