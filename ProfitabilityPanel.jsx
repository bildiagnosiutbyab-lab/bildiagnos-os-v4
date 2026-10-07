import { useEffect, useMemo, useState } from 'react';
import { loadDailyProfitability } from './commercialRepository.js';
import './profitability.css';

const SEK0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const money = (v) => `${SEK0.format(Number(v || 0))} kr`;

export default function ProfitabilityPanel({ context }) {
  const [daily, setDaily] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    loadDailyProfitability().then((data) => active && setDaily(data)).catch((e) => active && setError(e?.message || 'No se pudo calcular el día.'));
    return () => { active = false; };
  }, [context?.parts, context?.services]);

  const order = useMemo(() => {
    const services = (context?.services || []).filter(x => !['rejected','removed'].includes(x.status));
    const parts = (context?.parts || []).filter(x => !['rejected','removed'].includes(x.status));
    const labor = services.reduce((s,x)=>s + Number(x.quantity || 1) * Number(x.unit_price || 0),0);
    const partsSales = parts.reduce((s,x)=>s + Number(x.quantity || 1) * Number(x.sale_price || 0),0);
    const verified = parts.filter(x=>x.actual_cost !== null && x.actual_cost !== undefined);
    const cost = verified.reduce((s,x)=>s + Number(x.quantity || 1) * Number(x.actual_cost || 0),0);
    const verifiedSales = verified.reduce((s,x)=>s + Number(x.quantity || 1) * Number(x.sale_price || 0),0);
    const unverified = parts.length - verified.length;
    const contribution = labor + verifiedSales - cost;
    return { labor, partsSales, cost, verifiedSales, unverified, contribution, partMargin: verifiedSales-cost };
  }, [context]);

  const ratio = daily?.progress || 0;
  const level = ratio >= 1 ? 'green' : ratio >= .65 ? 'yellow' : 'red';

  return <section className="profit-card">
    <div className="profit-head"><div><small>SOLO INTERNO · EXKL. MOMS</small><h3>Rentabilidad</h3></div><b className={`profit-dot ${level}`}>{daily ? `${Math.round(ratio*100)}%` : '—'}</b></div>
    <div className="profit-block">
      <h4>Esta orden</h4>
      <div className="profit-grid">
        <span><small>Mano de obra</small><b>{money(order.labor)}</b></span>
        <span><small>Venta piezas</small><b>{money(order.partsSales)}</b></span>
        <span><small>Coste piezas verificado</small><b>{money(order.cost)}</b></span>
        <span><small>Margen piezas verificado</small><b>{money(order.partMargin)}</b></span>
        <span className="profit-strong"><small>Aporte conocido</small><b>{money(order.contribution)}</b></span>
      </div>
      {order.unverified > 0 && <p className="profit-warning">⚠️ Coste no verificado en {order.unverified} línea(s) de piezas. No se cuentan como beneficio hasta confirmar el följesedel.</p>}
    </div>
    <div className="profit-block">
      <h4>Hoy</h4>
      {daily ? <>
        <div className="profit-grid">
          <span><small>Mano de obra</small><b>{money(daily.laborSales)}</b></span>
          <span><small>Margen piezas verificado</small><b>{money(daily.verifiedPartsSales-daily.verifiedPartsCost)}</b></span>
          <span><small>Aporte conocido</small><b>{money(daily.contribution)}</b></span>
          <span><small>Meta diaria</small><b>{money(daily.target)}</b></span>
          <span className="profit-strong"><small>{daily.remaining > 0 ? 'Falta para meta' : 'Meta alcanzada'}</small><b>{daily.remaining > 0 ? money(daily.remaining) : money(daily.contribution-daily.target)}</b></span>
        </div>
        <div className="profit-progress"><i style={{width:`${Math.min(100,Math.max(0,ratio*100))}%`}} /></div>
        {daily.unverifiedPartLines > 0 && <p className="profit-warning">⚠️ Hay {daily.unverifiedPartLines} línea(s) de piezas del día con coste no verificado.</p>}
      </> : <p>{error || 'Calculando…'}</p>}
    </div>
  </section>;
}
