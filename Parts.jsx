import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { createPart, listParts } from './workshopRepository.js';

export default function Parts() {
  const [items, setItems] = useState([]); const [description, setDescription] = useState(''); const [number, setNumber] = useState(''); const [message, setMessage] = useState('');
  const refresh = () => listParts().then(setItems).catch((e) => setMessage(e.message)); useEffect(refresh, []);
  async function add() { if (!description.trim()) return; await createPart(description.trim(), number.trim()); setDescription(''); setNumber(''); setMessage('Pieza guardada'); refresh(); }
  return <><PageHeader title="Piezas / Reservdelar" subtitle="Inventario, proveedores y recepción" />
    <section className="card order-form"><label>Número de artículo<input value={number} onChange={(e) => setNumber(e.target.value)} /></label><label>Descripción<input value={description} onChange={(e) => setDescription(e.target.value)} /></label><button className="primary-button" onClick={add}>Añadir pieza</button>{message && <p>{message}</p>}</section>
    <section className="card">{items.length === 0 ? <p>No hay piezas registradas.</p> : items.map((item) => <div className="vehicle-row" key={item.id}><div><strong>{item.description}</strong><span>{item.internal_number || 'Sin número interno'}</span></div></div>)}</section></>;
}
