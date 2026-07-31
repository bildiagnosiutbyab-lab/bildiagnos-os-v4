import PageHeader from './PageHeader.jsx';

export default function Vehicles() {
  return (
    <>
      <PageHeader title="Vehículos" subtitle="Historial individual por matrícula" action="Añadir vehículo" />
      <section className="card">
        <div className="vehicle-row">
          <button className="plate">XHN 404</button>
          <div><strong>Volkswagen Passat</strong><span>Historial, DTC, kilometraje y facturas</span></div>
        </div>
        <div className="vehicle-row">
          <button className="plate">SZD 16G</button>
          <div><strong>Peugeot</strong><span>Servicio, frenos y lámpara</span></div>
        </div>
      </section>
    </>
  );
}
