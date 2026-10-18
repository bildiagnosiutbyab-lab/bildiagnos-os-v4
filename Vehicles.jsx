import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { createVehicle, listVehicles } from './workshopRepository.js';

export default function Vehicles({ onOpenPlate }) {
  const [items, setItems] = useState([]);
  const [plate, setPlate] = useState('');
  const [search, setSearch] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

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
      setShowAdd(false);
      setMessage('Vehículo guardado.');
      await refresh();
    } catch (error) {
      setMessage(error?.message || 'No se pudo guardar el vehículo.');
    }
  }

  return <>
    <PageHeader title="Fordon" subtitle="Historial individual por matrícula" />
    {message && <p className="lager-message" role="status">{message}</p>}
    <section className="card">
      <label htmlFor="vehicle-search">Buscar matrícula / Sök registreringsnummer</label>
      <input id="vehicle-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ABC123" autoComplete="off" style={{width:'100%',maxWidth:480}} />
      <div style={{marginTop:12}}>
        <button type="button" className="secondary-button" onClick={()=>setShowAdd(value=>!value)} aria-expanded={showAdd}>{showAdd?'Cancelar':'＋ Añadir vehículo nuevo'}</button>
      </div>
      {showAdd&&<div className="order-form" style={{marginTop:16}}>
        <label>Registreringsnummer<input value={plate} onChange={e=>setPlate(e.target.value.toUpperCase())} /></label>
        <label>Fordon<input value={description} onChange={e=>setDescription(e.target.value)} /></label>
        <button type="button" className="primary-button" onClick={add}>Guardar vehículo</button>
      </div>}
    </section>
    <section className="card">
      {loading ? <p>Cargando vehículos…</p> : items.length === 0 ? <p>No hay vehículos registrados.</p> : items.filter(item => String(item.registration_plate || '').toUpperCase().replace(/[^A-Z0-9ÅÄÖ]/g,'').includes(search.toUpperCase().replace(/[^A-Z0-9ÅÄÖ]/g,''))).map((item) => (
        <div className="vehicle-row" key={item?.id || item?.registration_plate}>
          <button type="button" className="plate" onClick={() => onOpenPlate?.(item.registration_plate)}>{item?.registration_plate || '—'}</button>
          <div>
            <strong>{[item?.make, item?.model, item?.model_year].filter(Boolean).join(' ') || item?.raw_description || 'Ingen beskrivning'}</strong>
            <span>{item?.vin ? `VIN ${item.vin}` : 'VIN saknas'}{item?.engine ? ` · Motor ${item.engine}` : ''}{item?.fuel_type ? ` · ${item.fuel_type}` : ''}</span>
          </div>
          <button type="button" className="secondary-button" onClick={() => onOpenPlate?.(item.registration_plate)}>Historial / Nueva orden</button>
        </div>
      ))}
    </section>
  </>;
}
