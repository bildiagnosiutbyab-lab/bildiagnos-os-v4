import PageHeader from './PageHeader.jsx';

export default function Dashboard({ onNewOrder }) {
  const stats = [
    ['Órdenes abiertas', '6'],
    ['Vehículos hoy', '4'],
    ['Facturas pendientes', '3'],
    ['Horas registradas', '7.5']
  ];

  return (
    <>
      <PageHeader  title="Buenos días"
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
        <div className="job-row">
          <div><strong>XHN 404</strong><span>Volkswagen Passat</span></div>
          <span className="status warning">Diagnóstico</span>
        </div>
        <div className="job-row">
          <div><strong>SZD 16G</strong><span>Peugeot · servicio y frenos</span></div>
          <span className="status success">Listo</span>
        </div>
      </section>
    </>
  );
}
