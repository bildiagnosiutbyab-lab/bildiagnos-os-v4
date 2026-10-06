import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { createVehicle, listVehicles } from './workshopRepository.js';

export default function Vehicles() {
  const [items, setItems] = useState([]);
  const [plate, setPlate] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const rows = await listVehicles();
      setItems(Array.isArray(rows) ? rows : []);
      setMessage('');
    } catch (error) {
      setItems([]);
      setMessage(error?.message || 'No se pudieron cargar los vehículos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function add() {
    if (!plate.trim()) return;
    try {
      await createVehicle(plate.trim(), description.trim());
      setPlate('');
      setDescription('');
      setMessage('Vehículo guardado.');
      await refresh();
    } catch (error) {
      setMessage(error?.message || 'No se pudo guardar el vehículo.');
    }
  }

  return <>
    <PageHeader title="Fordon" subtitle="Historial individual por matrícula" />
    {message && <p className="lager-message" role="status">{message}</p>}
    <section className="card order-form">
      <label>Registreringsnummer<input value={plate} onChange={(e) => setPlate(e.target.value)} /></label>
      <label>Fordon<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <button type="button" className="primary-button" onClick={add}>Añadir vehículo</button>
    </section>
    <section className="card">
      {loading ? <p>Cargando vehículos…</p> : items.length === 0 ? <p>No hay vehículos registrados.</p> : items.map((item) => (
        <div className="vehicle-row" key={item?.id || item?.registration_plate}>
          <button type="button" className="plate">{item?.registration_plate || '—'}</button>
          <div>
            <strong>{item?.raw_description || 'Ingen beskrivning'}</strong>
            <span>Historial por matrícula</span>
          </div>
        </div>
      ))}
    </section>
  </>;
}
