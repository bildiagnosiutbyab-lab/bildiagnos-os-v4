import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { createVehicle, listVehicles } from './workshopRepository.js';

export default function Vehicles() {
  const [items, setItems] = useState([]); const [plate, setPlate] = useState(''); const [description, setDescription] = useState(''); const [message, setMessage] = useState('');
  const refresh = () => listVehicles().then(setItems).catch((e) => setMessage(e.message)); useEffect(refresh, []);
  async function add() { if (!plate.trim()) return; await createVehicle(plate.trim(), description.trim()); setPlate(''); setDescription(''); setMessage('Vehículo guardado'); refresh(); }
  return <><PageHeader title="Vehículos" subtitle="Historial individual por matrícula" />
    <section className="card order-form"><label>Matrícula<input value={plate} onChange={(e) => setPlate(e.target.value)} /></label><label>Vehículo<input value={description} onChange={(e) => setDescription(e.target.value)} /></label><button className="primary-button" onClick={add}>Añadir vehículo</button>{message && <p>{message}</p>}</section>
    <section className="card">{items.map((item) => <div className="vehicle-row" key={item.id}><button className="plate">{item.registration_plate}</button><div><strong>{item.raw_description || 'Sin descripción'}</strong><span>Historial por matrícula</span></div></div>)}</section></>;
}
