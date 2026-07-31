import PageHeader from './PageHeader.jsx';

export default function Customers() {
  return (
    <>
      <PageHeader title="Clientes" subtitle="Datos completos, vehículos y facturación" action="Nuevo cliente" />
      <section className="card empty-state">
        <h2>Ficha completa del cliente</h2>
        <p>Nombre, teléfono, correo, dirección, código postal, ciudad, datos fiscales, notas y vehículos.</p>
      </section>
    </>
  );
}
