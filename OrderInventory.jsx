import { useEffect, useState } from 'react';
import { listInventory, useInventory } from './inventoryRepository.js';
import './lager.css';

export default function OrderInventory({ order, onSaved }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { listInventory().then(setItems).catch((error) => setMessage(error.message)); }, [order.relationalId]);
  async function add() {
    setBusy(true); setMessage('');
    try {
      if (!selected || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) throw new Error('Selecciona artículo y cantidad válida.');
      await useInventory(selected, order.relationalId, Number(quantity));
      setItems(await listInventory()); await onSaved?.();
      setMessage('Pieza añadida a esta orden y descontada del stock.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  if (!order.relationalId) return null;
  return <section className="card order-inventory"><h3>Tomar pieza de Lager</h3><p>Orden {order.plate} · el movimiento guarda matrícula y usuario. Al quitar la pieza, vuelve al stock.</p>
    <div><select aria-label="Pieza de inventario" value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Selecciona una pieza…</option>{items.filter((item) => Number(item.quantity)>0).map((item) => <option key={item.id} value={item.id}>{item.parts?.description} · {item.inventory_locations?.name} · {item.quantity} st</option>)}</select>
      <input aria-label="Cantidad" type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} /><button className="primary-button" disabled={busy || !selected} onClick={add}>Añadir a esta orden</button></div>
    {message && <p role="status">{message}</p>}
  </section>;
}
