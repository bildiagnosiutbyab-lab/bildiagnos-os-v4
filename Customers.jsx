import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { createCustomer, listCustomers } from './workshopRepository.js';

export default function Customers() {
  const [items, setItems] = useState([]); const [name, setName] = useState(''); const [message, setMessage] = useState('');
  const refresh = () => listCustomers().then(setItems).catch((e) => setMessage(e.message));
  useEffect(refresh, []);
  async function add() { if (!name.trim()) return; await createCustomer(name.trim()); setName(''); setMessage('Kund sparad'); refresh(); }
  return <><PageHeader title="Kunder" subtitle="Kunduppgifter, fordon och fakturering" />
    <section className="card order-form"><label>Namn<input value={name} onChange={(e) => setName(e.target.value)} /></label><button className="primary-button" onClick={add}>Ny kund</button>{message && <p>{message}</p>}</section>
    <section className="card">{items.map((item) => <div className="vehicle-row" key={item.id}><div><strong>{item.display_name}</strong><span>{item.phone || item.email || 'Ingen kontakt registrerad'}</span></div></div>)}</section></>;
}
