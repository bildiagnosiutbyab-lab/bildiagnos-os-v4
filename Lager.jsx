import { useEffect, useMemo, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { lampInventoryDraft, draftTotal } from './lampInventoryDraft.js';
import { adjustInventory, countInventory, createInventoryItem, listInventory, listMovements, useInventory } from './inventoryRepository.js';
import { loadRelationalOrders } from './ordersRepository.js';
import './lager.css';

const empty = { description: '', lamp_type: '', brand: '', voltage: '', wattage: '', color: '', barcode: '', manufacturer_part_number: '', supplier_part_number: '', supplier: '', cost_price: '', sale_price: '', quantity: '0', minimum_quantity: '0', location: '' };
const money = (value) => value == null ? '—' : `${Number(value).toFixed(2)} kr`;

export default function Lager() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [history, setHistory] = useState(null);
  const [counting, setCounting] = useState(null);
  const [counted, setCounted] = useState('');
  const [showDraft, setShowDraft] = useState(false);
  const [orders, setOrders] = useState([]);
  const [usingItem, setUsingItem] = useState(null);
  const [useOrderId, setUseOrderId] = useState('');
  const [useQuantity, setUseQuantity] = useState('1');
  async function refresh() { setItems(await listInventory()); }
  useEffect(() => {
    refresh().catch((error) => setMessage(error.message));
    loadRelationalOrders().then((rows) => setOrders(Array.isArray(rows) ? rows : [])).catch(() => setOrders([]));
  }, []);
  const filtered = useMemo(() => items.filter((item) => {
    const part = item.parts || {};
    return [part.description, part.lamp_type, part.brand, part.barcode, part.manufacturer_part_number, part.internal_number,
      item.supplier?.supplier_part_number, item.supplier?.suppliers?.name, item.inventory_locations?.name]
      .some((text) => String(text || '').toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  }), [items, query]);
  async function run(action, success) {
    setBusy(true); setMessage('');
    try { await action(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error.message || 'No se pudo guardar el movimiento.'); }
    finally { setBusy(false); }
  }
  async function movement(item, delta) {
    if (delta < 0) {
      setUsingItem(item);
      setUseOrderId('');
      setUseQuantity('1');
      return;
    }
    await run(() => adjustInventory(item.id, 1, 'Manuell lagerökning'), 'En unidad añadida al inventario.');
    if (history?.id === item.id) setHistory({ id: item.id, rows: await listMovements(item.id) });
  }

  async function useForOrder() {
    if (!usingItem || !useOrderId) { setMessage('Selecciona la orden o el vehículo.'); return; }
    const qty = Number(useQuantity);
    if (!Number.isFinite(qty) || qty <= 0) { setMessage('Introduce una cantidad válida.'); return; }
    if (qty > Number(usingItem.quantity || 0)) { setMessage('No hay suficiente stock.'); return; }
    await run(() => useInventory(usingItem.id, useOrderId, qty), 'Pieza asignada al vehículo y descontada del inventario.');
    setUsingItem(null);
    setUseOrderId('');
    setUseQuantity('1');
  }
  async function showHistory(item) {
    try { setHistory({ id: item.id, rows: await listMovements(item.id) }); }
    catch (error) { setMessage(error.message); }
  }
  async function saveNew(event) {
    event.preventDefault();
    if (!form.description.trim() || !form.location.trim()) return;
    await run(async () => { await createInventoryItem(form); setForm(empty); setShowForm(false); }, 'Artículo creado con movimiento inicial.');
  }
  async function saveCount(item) {
    const value = Number(counted);
    if (counted === '' || !Number.isFinite(value) || value < 0) { setMessage('Introduce la cantidad contada.'); return; }
    if (!window.confirm(`${item.parts?.description}: sistema ${item.quantity} → contado ${value}. ¿Guardar ajuste?`)) return;
    await run(() => countInventory(item.id, value, 'Conteo físico', item.version), 'Conteo guardado en el historial.');
    setCounting(null);
  }

  return <><PageHeader title="Lager" subtitle="Stock físico del taller y movimientos trazables" />
    {message && <p className="lager-message" role="status">{message}</p>}
    <section className="card lager-toolbar">
      <label>Buscar por nombre, EAN, artículo o ubicación<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="H7, 405030…, Bombillas-12…" /></label>
      <button type="button" className="primary-button" onClick={() => setShowForm(!showForm)}>+ Nuevo artículo</button>
      <span>{items.length} referencias · {items.filter((item) => Number(item.quantity) <= Number(item.minimum_quantity ?? 0)).length} con lågt lager</span>
    </section>
    {showForm && <form className="card lager-form" onSubmit={saveNew}>
      <h2>Nuevo artículo del taller</h2>
      {Object.entries({ description: 'Nombre / tipo *', lamp_type: 'Tipo (H7, W5W…)', brand: 'Marca', voltage: 'Voltaje', wattage: 'Potencia', color: 'Color', barcode: 'EAN', manufacturer_part_number: 'Nº fabricante', supplier_part_number: 'Nº BilXtra / proveedor', supplier: 'Leverantör', cost_price: 'Compra (kr)', sale_price: 'Venta (kr)', quantity: 'Ingående antal', minimum_quantity: 'Stock mínimo', location: 'Ubicación física *' }).map(([key, label]) =>
        <label key={key}>{label}<input required={key === 'description' || key === 'location'} type={['cost_price','sale_price','quantity','minimum_quantity'].includes(key) ? 'number' : 'text'} min={['cost_price','sale_price','quantity','minimum_quantity'].includes(key) ? 0 : undefined} step={['cost_price','sale_price'].includes(key) ? '0.01' : ['quantity','minimum_quantity'].includes(key) ? '0.001' : undefined} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} placeholder={key === 'location' ? 'Ej. Bombillas-12' : undefined} /></label>)}
      <button disabled={busy} className="primary-button">Guardar artículo</button>
    </form>}
    <section className="card lager-list"><h2>Existencias registradas</h2>
      {!filtered.length && <p>{items.length ? 'Inga resultat.' : 'Todavía no hay stock registrado. La lista de 208 bombillas de abajo es solo una previsualización.'}</p>}
      {filtered.map((item) => <article className="lager-row" key={item.id}>
        <div><strong>{item.parts?.lamp_type || item.parts?.description} | {item.parts?.brand || 'Marca pendiente'}</strong>
          <small>{[item.parts?.voltage,item.parts?.wattage,item.parts?.color].filter(Boolean).join(' · ') || 'Especificación pendiente'} · EAN {item.parts?.barcode || '—'}</small>
          <small>Ubicación: <b>{item.inventory_locations?.name || 'Ingen lagerplats'}</b> · Fabricante {item.parts?.manufacturer_part_number || '—'} · {item.supplier?.suppliers?.name || 'Leverantör pendiente'} {item.supplier?.supplier_part_number || ''}</small>
          <small>Compra {money(item.supplier?.cost_price ?? item.average_cost)} · Venta {money(item.parts?.sale_price)}</small>
        </div>
        <div className="lager-controls"><strong>{item.quantity} st</strong>
          {Number(item.quantity) <= Number(item.minimum_quantity ?? 0) && <span className="lager-low">Lågt lager · mínimo {item.minimum_quantity ?? 0}</span>}
          <div className="lager-stepper"><button type="button" disabled={busy || Number(item.quantity) < 1} onClick={() => movement(item,-1)} title="Usar en un vehículo">−</button><span>{item.quantity} st</span><button type="button" disabled={busy} onClick={() => movement(item,1)} title="Añadir 1 al inventario">+</button></div>
          <div><button type="button" onClick={() => { setCounting(item.id); setCounted(String(item.quantity)); }}>Räkna</button><button type="button" onClick={() => showHistory(item)}>Historik</button></div>
        </div>
        {usingItem?.id === item.id && <div className="lager-count">
          <span>¿Para qué vehículo / orden?</span>
          <select value={useOrderId} onChange={(e) => setUseOrderId(e.target.value)}>
            <option value="">Selecciona una orden…</option>
            {orders.filter((order) => !['Pagada','Terminada','Cancelada'].includes(order.status)).map((order) => <option key={order.relationalId || order.id} value={order.relationalId}>{order.plate || 'Sin matrícula'} · {order.customer || ''} · {order.requestedWork || ''}</option>)}
          </select>
          <input aria-label="Cantidad a usar" type="number" min="0.001" step="0.001" max={item.quantity} value={useQuantity} onChange={(e) => setUseQuantity(e.target.value)} />
          <button type="button" disabled={busy || !useOrderId} onClick={useForOrder}>Usar y descontar</button>
          <button type="button" onClick={() => setUsingItem(null)}>Cancelar</button>
        </div>}
        {counting === item.id && <div className="lager-count"><span>Sistema: {item.quantity} · Contado: </span><input aria-label="Räknat antal" type="number" min="0" step="0.001" value={counted} onChange={(e) => setCounted(e.target.value)} /><span>Diferencia: {counted === '' ? '—' : Number(counted) - Number(item.quantity)}</span><button disabled={busy} onClick={() => saveCount(item)}>Guardar conteo</button><button onClick={() => setCounting(null)}>Cancelar</button></div>}
        {history?.id === item.id && <div className="lager-history"><button onClick={() => setHistory(null)}>Cerrar historial</button>{history.rows.length ? history.rows.map((row) => <p key={row.id}>{new Date(row.occurred_at).toLocaleString('sv-SE')} · {row.quantity > 0 ? '+' : ''}{row.quantity} · {row.reason || row.movement_type} · {row.plate_snapshot || 'Utan registreringsnummer'} · Usuario {row.created_by || '—'}</p>) : <p>Sin movimientos.</p>}</div>}
      </article>)}
    </section>
    <section className="card lager-draft"><div className="lager-draft-heading"><div><h2>Conteo antiguo de bombillas · aún no importado</h2><p>{lampInventoryDraft.length} referencias · {draftTotal} unidades. <b>Esta tabla NO es el inventario activo y por eso no tiene + / −.</b> Los botones + / − aparecen arriba, en "Existencias registradas".</p></div><button onClick={() => setShowDraft(!showDraft)}>{showDraft ? 'Ocultar conteo antiguo' : 'Mostrar conteo antiguo'}</button></div>
      {showDraft && <div className="lager-table-wrap"><table><thead><tr><th>Tipo</th><th>Marca</th><th>EAN / referencia</th><th>Cantidad</th><th>Ubicación</th><th>Precio</th></tr></thead><tbody>{lampInventoryDraft.map((part, index) => <tr key={index}><td>{part.type}</td><td>{part.brand || 'Väntar'}</td><td>{part.ean || part.manufacturerNumber || 'Väntar'}{part.ean && part.manufacturerNumber ? ` · ${part.manufacturerNumber}` : ''}</td><td>{part.quantity} st</td><td>Väntar</td><td>Väntar</td></tr>)}</tbody><tfoot><tr><th colSpan="3">Total (sin importar)</th><th>{draftTotal} st</th><th colSpan="2">Esperando confirmación</th></tr></tfoot></table></div>}
    </section>
  </>;
}
