import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';

const feeNames = [
  ['consumables', 'Förbrukningsmaterial · consumibles'],
];
const OIL_ENV_RATE = 15;
const number = value => Math.max(0, Number(value) || 0);
const money = value => number(value).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' });

export default function OrderFees({ order }) {
  const key = 'bildiagnos-order-fees-' + String(order.id);
  const [fees, setFees] = useState({ environmental: '', consumables: 32, oilLiters: '' });
  const [revision, setRevision] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.from('app_state').select('value,updated_at').eq('key', key).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        setFees({ environmental: data?.value?.environmental ?? '', consumables: data?.value?.consumables ?? 32, oilLiters: data?.value?.oilLiters ?? '' });
        setRevision(data?.updated_at ?? null);
        setMessage('');
      })
      .catch(error => { if (active) setMessage('No se pudieron cargar los cargos: ' + error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key]);
  async function save() {
    setLoading(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Sesión no disponible');
      const value = { environmental: fees.oilLiters !== '' ? Math.round(number(fees.oilLiters) * OIL_ENV_RATE * 100) / 100 : number(fees.environmental), consumables: number(fees.consumables), oilLiters: fees.oilLiters === '' ? '' : number(fees.oilLiters), oilEnvironmentalRate: OIL_ENV_RATE, currency: 'SEK' };
      let result;
      if (revision) {
        result = await supabase.from('app_state').update({ value, updated_at: new Date().toISOString(), updated_by: user.id }).eq('key', key).eq('updated_at', revision).select('updated_at');
        if (!result.error && !result.data?.length) throw new Error('Otro dispositivo cambió estos cargos. Abre la orden nuevamente.');
      } else {
        result = await supabase.from('app_state').insert({ key, value, updated_by: user.id }).select('updated_at');
      }
      if (result.error) throw result.error;
      setRevision(result.data[0].updated_at);
      setMessage('Cargos guardados. No se han enviado a Fortnox.');
    } catch (error) {
      setMessage('No se guardaron: ' + error.message);
    } finally { setLoading(false); }
  }
  return <section className="card">
    <h2>Cargos adicionales / Extra avgifter</h2>
    <p>Selecciona litros para calcular 15 kr por litro. No descuenta existencias del inventario ni añade automáticamente estos cargos a la factura.</p>
    <label style={{ display: 'block', margin: '12px 0' }}>Miljöavgift – aceite (15 kr/litro)
      <input type="number" min="0" step="0.1" placeholder="Litros de aceite" value={fees.oilLiters} disabled={loading} onChange={e => setFees(current => ({ ...current, oilLiters: e.target.value }))} style={{ display: 'block', maxWidth: 220 }} />
    </label>
    <p>Miljöavgift por aceite: <strong>{money(number(fees.oilLiters) * OIL_ENV_RATE)}</strong></p>
    <label style={{ display: 'block', margin: '12px 0' }}>Otra Miljöavgift (kr; solo si no se indican litros)
      <input type="number" min="0" step="0.01" value={fees.environmental} disabled={loading || fees.oilLiters !== ''} onChange={e => setFees(current => ({ ...current, environmental: e.target.value }))} style={{ display: 'block', maxWidth: 220 }} />
    </label>
    {feeNames.map(([name, label]) => <label key={name} style={{ display: 'block', margin: '12px 0' }}>
      {label}
      <input type="number" min="0" step="0.01" value={fees[name]} disabled={loading} onChange={e => setFees(current => ({ ...current, [name]: e.target.value }))} style={{ display: 'block', maxWidth: 220 }} />
    </label>)}
    <p><strong>Total cargos: {money((fees.oilLiters !== '' ? number(fees.oilLiters) * OIL_ENV_RATE : number(fees.environmental)) + number(fees.consumables))}</strong></p>
    <button className="primary-button" type="button" disabled={loading} onClick={save}>Guardar cargos</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
