import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { supabase } from './supabaseClient.js';

function summarizeOrders(orders) {
  const today = new Date().toLocaleDateString('sv-SE');
  const closedStatuses = ['Terminada', 'Pagada', 'Cancelada'];
  const openOrders = orders.filter(
    (order) => !closedStatuses.includes(order.status)
  ).length;
  const vehiclesToday = new Set(
    orders
      .filter((order) => String(order.createdAt || '').startsWith(today))
      .map((order) => order.plate)
      .filter(Boolean)
  ).size;
  const totalSeconds = orders.reduce(
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

      <section className="card">
        <h2>Trabajos de hoy</h2>
        <p>Abre Órdenes para ver los vehículos y actualizar cada trabajo.</p>
      </section>
    </>
  );
}
