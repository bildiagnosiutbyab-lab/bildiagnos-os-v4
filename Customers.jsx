import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { createCustomer, listCustomers } from './workshopRepository.js';

export default function Customers() {
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const rows = await listCustomers();
      setItems(Array.isArray(rows) ? rows : []);
      setMessage('');
    } catch (error) {
      setMessage('No se pudieron cargar los clientes. Comprueba la conexión y vuelve a intentar.');
      console.error('Customers loading failed:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function add() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await createCustomer(name.trim());
      setName('');
      await refresh();
      setMessage('Cliente guardado.');
    } catch (error) {
      console.error('Customer save failed:', error);
      setMessage('No se pudo guardar el cliente. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  const filtered = items.filter(item => String(item?.display_name || '').toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeader title="Kunder" subtitle="Kunduppgifter, fordon och fakturering" />
    {message && <p role="status" className="auth-message">{message} <button type="button" className="secondary-button" onClick={refresh}>Reintentar</button></p>}
    <section className="card order-form">
      <label>Namn<input value={name} onChange={e => setName(e.target.value)} /></label>
      <button type="button" className="primary-button" disabled={saving || !name.trim()} onClick={add}>{saving ? 'Guardando…' : 'Ny kund'}</button>
    </section>
    <section className="card">
      <label>Buscar cliente<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      {loading ? <p>Cargando clientes…</p> : filtered.length === 0 ? <p>No hay clientes para mostrar.</p> : filtered.map(item => (
        <div className="vehicle-row" key={item.id}>
          <div><strong>{item.display_name}</strong><span>{item.phone || item.email || 'Ingen kontakt registrerad'}</span></div>
        </div>
      ))}
    </section>
  </>;
}
