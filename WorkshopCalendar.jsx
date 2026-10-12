import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient.js';
import PageHeader from './PageHeader.jsx';

const KEY = 'bildiagnos-calendar-v1';
const TASKS = [
  { id: 'bjorn-module', title: 'Pedir módulo de gasolina de Björn', done: false },
  { id: 'fortnox-review', title: 'Revisar Fortnox: facturas, pagos y documentos', done: false },
  { id: 'workshop-admin', title: 'Administración: reservas y pedido de piezas', done: false },
];
const blank = { date: '', start: '09:00', end: '10:00', customer: '', plate: '', work: '', notes: '' };
const localDate = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const addDays = (day, count) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + count); return localDate(d); };
const initialState = { bookings: [], tasks: TASKS };
const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export default function WorkshopCalendar() {
  const [data, setData] = useState(initialState);
  const [revision, setRevision] = useState(null);
  const [week, setWeek] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDate(d); });
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('Cargando calendario…');
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState('calendar');

  async function load() {
    const { data: row, error } = await supabase.from('app_state').select('value,updated_at').eq('key', KEY).maybeSingle();
    if (error) throw error;
    setData(row?.value && Array.isArray(row.value.bookings) ? { bookings: row.value.bookings, tasks: Array.isArray(row.value.tasks) ? row.value.tasks : TASKS } : initialState);
    setRevision(row?.updated_at || null);
  }
  useEffect(() => { let active = true; load().then(() => { if (active) setMessage(''); }).catch(e => { if (active) setMessage('No se pudo cargar: ' + e.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, []);
  async function save(next) {
    setBusy(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Inicia sesión para guardar.');
      if (revision) {
        const { data: rows, error } = await supabase.from('app_state').update({ value: next, updated_at: new Date().toISOString(), updated_by: user.id }).eq('key', KEY).eq('updated_at', revision).select('updated_at');
        if (error) throw error;
        if (!rows?.length) throw new Error('El calendario cambió en otro dispositivo. Actualiza antes de guardar.');
        setRevision(rows[0].updated_at);
      } else {
        const { data: row, error } = await supabase.from('app_state').insert({ key: KEY, value: next, updated_by: user.id }).select('updated_at').single();
        if (error) throw error;
        setRevision(row.updated_at);
      }
      setData(next);
      setMessage('Guardado en Bildiagnos OS');
      return true;
    } catch (error) {
      setMessage('No guardado: ' + error.message);
      await load().catch(() => {});
      return false;
    } finally { setBusy(false); }
  }
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const bookings = useMemo(() => [...data.bookings].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)), [data.bookings]);
  function edit(item) { setEditing(item?.id || null); setForm(item ? { date: item.date, start: item.start, end: item.end, customer: item.customer, plate: item.plate, work: item.work, notes: item.notes || '' } : { ...blank, date: localDate(new Date()) }); }
  async function submit(e) {
    e.preventDefault();
    if (!form.date || !form.customer.trim() || !form.work.trim() || form.end <= form.start) { setMessage('Completa fecha, cliente, trabajo y horas válidas.'); return; }
    const entry = { ...form, plate: form.plate.trim().toUpperCase(), customer: form.customer.trim(), work: form.work.trim(), id: editing || crypto.randomUUID() };
    const next = { ...data, bookings: editing ? data.bookings.map(b => b.id === editing ? entry : b) : [...data.bookings, entry] };
    if (await save(next)) { setEditing(null); setForm(blank); }
  }
  async function remove(item) {
    if (!window.confirm('¿Eliminar esta reserva? No se modificará ninguna orden de trabajo.')) return;
    await save({ ...data, bookings: data.bookings.filter(b => b.id !== item.id) });
  }
  return <div>
    <PageHeader title="Calendario del taller" subtitle="Reservas y tareas dentro de Bildiagnos OS · sin crear eventos en Google" />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <button className="secondary-button" onClick={() => setTab('calendar')}>Calendario</button>
      <button className="secondary-button" onClick={() => setTab('tasks')}>Tareas pendientes ({data.tasks.filter(t => !t.done).length})</button>
      <button className="secondary-button" onClick={() => { setTab('calendar'); edit(null); }}>+ Nueva reserva</button>
    </div>
    {message && <p role="status">{message}</p>}
    {tab === 'tasks' ? <section className="card"><h2>Lista del taller</h2><p>Estas tareas no bloquean horas de clientes.</p>
      {data.tasks.map(t => <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}><input type="checkbox" checked={t.done} disabled={busy} onChange={e => save({ ...data, tasks: data.tasks.map(x => x.id === t.id ? { ...x, done: e.target.checked } : x) })} /><span style={{ textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span></label>)}
    </section> : <>
      <section className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <button className="secondary-button" onClick={() => setWeek(addDays(week, -7))}>← Semana anterior</button><strong>{days[0]} — {days[6]}</strong><button className="secondary-button" onClick={() => setWeek(addDays(week, 7))}>Semana siguiente →</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10, marginTop: 18 }}>
          {days.map((day, i) => <div key={day} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: 10, minHeight: 130 }}>
            <strong>{weekdays[i]} {day.slice(8)}</strong>
            {bookings.filter(b => b.date === day).map(b => <div key={b.id} style={{ borderLeft: '3px solid #2563eb', padding: '7px 5px', marginTop: 8, background: 'rgba(37,99,235,.07)' }}>
              <strong>{b.start}–{b.end}</strong><div>{b.customer}</div><div>{b.plate}</div><div>{b.work}</div>
              <button className="secondary-button" onClick={() => edit(b)}>Editar</button> <button className="secondary-button" onClick={() => remove(b)}>Quitar</button>
            </div>)}
          </div>)}
        </div>
      </section>
      {(form.date || editing) && <section className="card"><h2>{editing ? 'Editar reserva' : 'Nueva reserva'}</h2><form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 600 }}>
        <label>Fecha <input type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
        <label>Desde <input type="time" required value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></label>
        <label>Hasta <input type="time" required value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></label>
        <label>Cliente <input required value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} /></label>
        <label>Matrícula <input value={form.plate} onChange={e => setForm({ ...form, plate: e.target.value })} /></label>
        <label>Trabajo <input required value={form.work} onChange={e => setForm({ ...form, work: e.target.value })} /></label>
        <label>Notas <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
        <div style={{ display: 'flex', gap: 10 }}><button disabled={busy} type="submit">Guardar reserva</button><button className="secondary-button" type="button" onClick={() => { setEditing(null); setForm(blank); }}>Cancelar</button></div>
      </form></section>}
    </>}
  </div>;
}
