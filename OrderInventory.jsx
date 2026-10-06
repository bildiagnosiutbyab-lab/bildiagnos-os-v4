import { useEffect, useMemo, useState } from 'react';
import { listInventory, useInventory } from './inventoryRepository.js';
import './lager.css';

export default function OrderInventory({ order, onSaved }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const rows = await listInventory();
    setItems(Array.isArray(rows) ? rows : []);
  }

  useEffect(() => {
    setSelected('');
    setQuantity('1');
    setMessage('');
    refresh().catch((error) => setMessage(error?.message || 'No se pudo cargar el inventario.'));
  }, [order.relationalId]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selected) || null, [items, selected]);

  async function add(event) {
    event?.preventDefault?.();
    if (busy) return;

    setMessage('');
    if (!selectedItem) {
      setMessage('Selecciona primero una pieza del inventario.');
      return;
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setMessage('Escribe una cantidad válida.');
      return;
    }
    if (qty > Number(selectedItem.quantity || 0)) {
      setMessage(`Solo hay ${selectedItem.quantity} en stock.`);
      return;
    }
    if (!order.relationalId) {
      setMessage('Esta orden todavía no está guardada correctamente.');
      return;
    }

    setBusy(true);
    setMessage('Añadiendo pieza a la orden…');
    try {
      await useInventory(selectedItem.id, order.relationalId, qty);
      await refresh();
      await onSaved?.();
      setSelected('');
      setQuantity('1');
      setMessage(`${selectedItem.parts?.description || 'Pieza'} añadida a ${order.plate} y descontada del inventario.`);
    } catch (error) {
      console.error('No se pudo añadir la pieza a la orden:', error);
      setMessage(error?.message || 'No se pudo añadir la pieza a esta orden.');
    } finally {
      setBusy(false);
    }
  }

  if (!order.relationalId) return null;

  return <section className="card order-inventory">
    <h3>Tomar pieza de Lager</h3>
    <p>Orden <b>{order.plate}</b> · al añadir una pieza queda vinculada a este vehículo y se descuenta del stock.</p>
    <form onSubmit={add}>
      <select aria-label="Pieza de inventario" value={selected} onChange={(e) => { setSelected(e.target.value); setMessage(''); }}>
        <option value="">Selecciona una pieza…</option>
        {items.filter((item) => Number(item.quantity) > 0).map((item) => <option key={item.id} value={item.id}>{item.parts?.description || item.parts?.lamp_type || 'Pieza'} · {item.inventory_locations?.name || 'Sin ubicación'} · {item.quantity} st</option>)}
      </select>
      <input aria-label="Cantidad" type="number" min="0.001" step="0.001" max={selectedItem?.quantity || undefined} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Añadiendo…' : 'Añadir a esta orden'}</button>
    </form>
    {selectedItem && <small>Seleccionado: <b>{selectedItem.parts?.description || selectedItem.parts?.lamp_type}</b> · Stock: {selectedItem.quantity} st</small>}
    {message && <p role="status" className="lager-message">{message}</p>}
  </section>;
}
