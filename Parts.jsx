import { useState } from 'react';
import PageHeader from './PageHeader.jsx';

export default function Parts() {
  const [source, setSource] = useState('inventory');

  return (
    <>
      <PageHeader title="Piezas / Reservdelar" subtitle="Inventario, proveedores y recepción por foto" action="Añadir pieza" />
      <section className="card">
        <h2>Origen de la pieza</h2>
        <div className="segmented">
          <button className={source === 'inventory' ? 'selected' : ''} onClick={() => setSource('inventory')}>Inventario propio</button>
          <button className={source === 'supplier' ? 'selected' : ''} onClick={() => setSource('supplier')}>Pedir al proveedor</button>
          <button className={source === 'photo' ? 'selected' : ''} onClick={() => setSource('photo')}>Foto del albarán</button>
        </div>
        <div className="parts-info">
          <p><strong>Proveedor:</strong> AD Bildelar, BilXtra o Partslink24</p>
          <p><strong>Vinculación:</strong> orden, vehículo, cliente, proveedor e inventario</p>
          <p><strong>Confirmación:</strong> artículo, cantidad, precio, descuento, IVA y número de pedido</p>
        </div>
      </section>
    </>
  );
}
