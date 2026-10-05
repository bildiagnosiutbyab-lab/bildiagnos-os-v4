import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { supabase } from './supabaseClient.js';

function summarizeOrders(orders) {
  const today = new Date().toLocaleDateString('sv-SE');
  const closedStatuses = ['Terminada', 'Pagada', 'Cancelada'];
  const retainedOrders = orders.filter((order) => order.status !== 'Cancelada');
  const openOrders = orders.filter(
    (order) => !closedStatuses.includes(order.status)
  ).length;
  const vehiclesToday = new Set(
    retainedOrders
      .filter((order) => String(order.createdAt || '').startsWith(today))
      .map((order) => order.plate)
      .filter(Boolean)
  ).size;
  const totalSeconds = retainedOrders.reduce(
    (sum, order) => sum + Number(order.accumulatedSeconds || 0),
    0
  );

  return {
    openOrders,
    vehiclesToday,
    hours: (totalSeconds / 3600).toFixed(1),
  };
}

export default function Dashboard({ onNewOrder }) {
  const [summary, setSummary] = useState({
    openOrders: 0,
    vehiclesToday: 0,
    hours: '0.0',
  });
  const [finance, setFinance] = useState({ revenue: 0, vat: 0, partsSales: 0, partsCost: 0, labor: 0 });
  const [fortnoxStatus, setFortnoxStatus] = useState({
    state: 'idle',
    message: '',
  });

  async function authorizeFortnoxTest() {
    setFortnoxStatus({ state: 'loading', message: 'Preparando autorización de Fortnox Test…' });
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token) {
      setFortnoxStatus({ state: 'error', message: 'La sesión ha caducado. Cierra sesión y vuelve a entrar.' });
      return;
    }
    const { data, error } = await supabase.functions.invoke('fortnox-test', {
      body: { action: 'service_authorization_url' },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error || !data?.ok || !data?.authorizationUrl) {
      setFortnoxStatus({ state: 'error', message: data?.error || error?.message || 'No se pudo preparar la autorización de Fortnox Test.' });
      return;
    }
    window.location.assign(data.authorizationUrl);
  }

  async function verifyFortnoxTest() {
    setFortnoxStatus({
      state: 'loading',
      message: 'Verificando conexión segura…',
    });

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      setFortnoxStatus({
        state: 'error',
        message: 'La sesión ha caducado. Cierra sesión y vuelve a entrar.',
      });
      return;
    }

    const { data, error } = await supabase.functions.invoke('fortnox-test', {
      body: { action: 'status' },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (error || !data?.ok || !data?.authenticated) {
      setFortnoxStatus({
        state: 'error',
        message:
          data?.error ||
          error?.message ||
          'No se pudo verificar Fortnox Test.',
      });
      return;
    }

    const company = data.companyName ? `: ${data.companyName}` : '';
    setFortnoxStatus({
      state: 'success',
      message: `Conexión de solo lectura confirmada${company}.`,
    });
  }

  useEffect(() => {
    let active = true;

    function applyOrders(value) {
      if (active && Array.isArray(value)) {
        setSummary(summarizeOrders(value));
      }
    }

    supabase
      .from('app_state')
      .select('value')
      .eq('key', 'bildiagnos-orders')
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('No se pudo cargar el resumen:', error);
          return;
        }

        applyOrders(data?.value || []);
      });

    const channel = supabase
      .channel('bildiagnos-dashboard-orders')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_state',
          filter: 'key=eq.bildiagnos-orders',
        },
        (payload) => applyOrders(payload.new?.value || [])
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadFinance() {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      const { data: invoices, error } = await supabase.from('invoices').select('id,subtotal,vat_total,total').gte('issued_at', monthStart).lt('issued_at', nextMonth).neq('status', 'cancelled');
      if (error || !active) return;
      const ids = (invoices || []).map((item) => item.id);
      const { data: lines } = ids.length ? await supabase.from('invoice_items').select('item_type,quantity,unit_price,part_line_id').in('invoice_id', ids) : { data: [] };
      const partIds = [...new Set((lines || []).map((line) => line.part_line_id).filter(Boolean))];
      const { data: parts } = partIds.length ? await supabase.from('work_order_parts').select('id,actual_cost,quantity').in('id', partIds) : { data: [] };
      const costs = new Map((parts || []).map((part) => [part.id, Number(part.actual_cost || 0)]));
      const labor = (lines || []).filter((line) => line.item_type === 'service').reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
      const partsSales = (lines || []).filter((line) => line.item_type === 'part').reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
      const partsCost = (lines || []).filter((line) => line.item_type === 'part').reduce((sum, line) => sum + Number(line.quantity || 0) * Number(costs.get(line.part_line_id) || 0), 0);
      if (active) setFinance({
        revenue: (invoices || []).reduce((sum, invoice) => sum + Number(invoice.subtotal || 0), 0),
        vat: (invoices || []).reduce((sum, invoice) => sum + Number(invoice.vat_total || 0), 0),
        labor, partsSales, partsCost,
      });
    }
    loadFinance();
    return () => { active = false; };
  }, []);

  const monthlyGoal = 60000;
  const goalPercent = Math.min(100, Math.max(0, finance.revenue / monthlyGoal * 100));
  const remaining = Math.max(0, monthlyGoal - finance.revenue);
  const money = (value) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(Number(value || 0));

  const stats = [
    ['Órdenes abiertas', String(summary.openOrders)],
    ['Vehículos hoy', String(summary.vehiclesToday)],
    ['Facturas pendientes', '—'],
    ['Horas registradas', summary.hours],
  ];

  return (
    <>
      <PageHeader
        title="Buenos días"
        subtitle="Resumen del taller"
        action="Nueva orden"
        onAction={onNewOrder}
      />

      <section className="stats-grid">
        {stats.map(([label, value]) => (
          <article className="card stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="card finance-card">
        <div className="finance-heading"><div><h2>Mål denna månad</h2><p>Försäljning exkl. moms mot målet 60 000 kr</p></div><strong>{Math.round(goalPercent)}%</strong></div>
        <div className="goal-track" aria-label={`${Math.round(goalPercent)} procent av målet`}><div className="goal-fill" style={{ width: `${goalPercent}%` }} /></div>
        <div className="finance-grid">
          <div><small>Försäljning exkl. moms</small><b>{money(finance.revenue)}</b></div>
          <div><small>Kvar till målet</small><b>{money(remaining)}</b></div>
          <div><small>Arbete</small><b>{money(finance.labor)}</b></div>
          <div><small>Delar, försäljning</small><b>{money(finance.partsSales)}</b></div>
          <div><small>Delar, inköpskostnad</small><b>{money(finance.partsCost)}</b></div>
          <div><small>Moms</small><b>{money(finance.vat)}</b></div>
        </div>
        <p className="finance-note">Målet räknas exklusive moms. Moms visas separat och räknas inte som verkstadens intäkt.</p>
      </section>

      <section className="card">
        <h2>Trabajos de hoy</h2>
        <p>Abre Órdenes para ver los vehículos y actualizar cada trabajo.</p>
      </section>

      <section className="card fortnox-test-card">
        <div>
          <h2>Fortnox Test</h2>
          <p>
            Comprueba la autenticación mediante una lectura de la información
            de la empresa. Esta acción no crea clientes, artículos, facturas ni
            pagos.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="secondary-button" type="button" onClick={authorizeFortnoxTest} disabled={fortnoxStatus.state === 'loading'}>
            Autorizar Fortnox Test
          </button>
          <button className="secondary-button" type="button" onClick={verifyFortnoxTest} disabled={fortnoxStatus.state === 'loading'}>
            {fortnoxStatus.state === 'loading' ? 'Verificando…' : 'Verificar Fortnox Test'}
          </button>
        </div>

        {fortnoxStatus.message && (
          <p
            className={`fortnox-test-message ${fortnoxStatus.state}`}
            role="status"
          >
            {fortnoxStatus.message}
          </p>
        )}
      </section>
    </>
  );
}
