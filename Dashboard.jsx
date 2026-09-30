import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { supabase } from './supabaseClient.js';
import { loadRelationalOrders } from './ordersRepository.js';

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
  const [fortnoxStatus, setFortnoxStatus] = useState({
    state: 'idle',
    message: '',
  });

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

    async function refreshSummary() {
      try {
        const orders = await loadRelationalOrders();
        if (active && Array.isArray(orders)) {
          setSummary(summarizeOrders(orders));
        }
      } catch (error) {
        console.error('No se pudo cargar el resumen:', error);
      }
    }

    refreshSummary();
    const timer = window.setInterval(refreshSummary, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
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

      <section className="card fortnox-test-card">
        <div>
          <h2>Fortnox Test</h2>
          <p>
            Comprueba la autenticación mediante una lectura de la información
            de la empresa. Esta acción no crea clientes, artículos, facturas ni
            pagos.
          </p>
        </div>

        <button
          className="secondary-button"
          type="button"
          onClick={verifyFortnoxTest}
          disabled={fortnoxStatus.state === 'loading'}
        >
          {fortnoxStatus.state === 'loading'
            ? 'Verificando…'
            : 'Verificar Fortnox Test'}
        </button>

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
