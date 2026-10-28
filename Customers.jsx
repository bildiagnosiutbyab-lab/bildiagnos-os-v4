import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { listCustomers, saveCustomerDetails } from './workshopRepository.js';

const blank = { customer_type: 'person', display_name: '', personal_or_org_number: '', email: '', phone: '', address_line: '', postal_code: '', city: '' };

export default function Customers() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => { try { setItems(await listCustomers()); } catch (e) { setMessage(e.message); } };
  useEffect(() => { refresh(); }, []);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const edit = (item) => {
    setEditingId(item.id);
    setForm(Object.fromEntries(Object.keys(blank).map((key) => [key, item[key] || (key === 'customer_type' ? 'person' : '')])));
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const reset = () => { setForm(blank); setEditingId(null); };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await saveCustomerDetails(form, editingId);
      setMessage('Kunduppgifter sparade');
      reset();
      await refresh();
    } catch (error) { setMessage(error.message || 'Kunden kunde inte sparas'); }
    finally { setBusy(false); }
  };
  return <><PageHeader title="Kunder" subtitle="Kunduppgifter, företag och fakturering" />
    <form className="card order-form" onSubmit={save}>
      <h3>{editingId ? 'Redigera kund' : 'Ny kund'}</h3>
      <label>Kundtyp
        <select value={form.customer_type} onChange={(e) => update('customer_type', e.target.value)}>
          <option value="person">Privatperson</option>
          <option value="company">Företag</option>
        </select>
      </label>
      <label>{form.customer_type === 'company' ? 'Företagsnamn' : 'Namn'}
        <input required value={form.display_name} onChange={(e) => update('display_name', e.target.value)} />
      </label>
      <label>{form.customer_type === 'company' ? 'Organisationsnummer' : 'Personnummer (valfritt)'}
        <input value={form.personal_or_org_number} onChange={(e) => update('personal_or_org_number', e.target.value)} />
      </label>
      <label>E-post<input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} /></label>
      <label>Telefon<input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} /></label>
      <label>Adress<input value={form.address_line} onChange={(e) => update('address_line', e.target.value)} /></label>
      <label>Postnummer<input value={form.postal_code} onChange={(e) => update('postal_code', e.target.value)} /></label>
      <label>Ort<input value={form.city} onChange={(e) => update('city', e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Sparar…' : 'Spara kund'}</button>
        {editingId && <button type="button" onClick={reset}>Avbryt</button>}
      </div>
      {message && <p role="status">{message}</p>}
    </form>
    <section className="card"><h3>Sparade kunder</h3>{items.map((item) => <div className="vehicle-row" key={item.id}>
      <div><strong>{item.display_name}</strong><span>{[item.personal_or_org_number, item.phone, item.email].filter(Boolean).join(' · ') || 'Ingen kontakt registrerad'}</span></div>
      <button type="button" onClick={() => edit(item)}>Redigera</button>
    </div>)}</section>
  </>;
}
