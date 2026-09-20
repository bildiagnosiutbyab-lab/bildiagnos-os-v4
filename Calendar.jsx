import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import PageHeader from './PageHeader.jsx';
import { supabase } from './supabaseClient.js';

const WORKSHOP_ID = 'e2ff2d9c-4e4f-475d-88b5-bbfca33240a5';

function localInputValue(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function googleDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function googleEventUrl(a) {
  const start = googleDate(a.starts_at);
  const end = googleDate(a.ends_at || new Date(new Date(a.starts_at).getTime() + 60 * 60 * 1000));
  const title = [a.plate_snapshot, a.reason].filter(Boolean).join(' · ') || 'Bildiagnos';
  const details = [a.notes, a.plate_snapshot ? 'Matrícula: ' + a.plate_snapshot : ''].filter(Boolean).join('\n');
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: start + '/' + end, details });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

export default function Calendar() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const now = new Date();
  const [form, setForm] = useState({
    plate: '', reason: '', startsAt: localInputValue(now),
    endsAt: localInputValue(new Date(now.getTime() + 60 * 60 * 1000)), notes: ''
  });

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('appointments')
      .select('id,starts_at,ends_at,reason,status,plate_snapshot,notes,work_order_id')
      .eq('workshop_id', WORKSHOP_ID)
      .order('starts_at', { ascending: true });
    if (error) setMessage('No se pudo cargar el calendario: ' + error.message);
    else setAppointments(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase.channel('bildiagnos-appointments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: 'workshop_id=eq.' + WORKSHOP_ID }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function save(e) {
    e.preventDefault();
    setMessage('');
    const plate = form.plate.replace(/\s+/g, '').toUpperCase();
    const { error } = await supabase.from('appointments').insert({
      workshop_id: WORKSHOP_ID,
      starts_at: new Date(form.startsAt).toISOString(),
      ends_at: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      reason: form.reason || null,
      plate_snapshot: plate || null,
      notes: form.notes || null,
      status: 'scheduled'
    });
    if (error) { setMessage('No se pudo guardar: ' + error.message); return; }
    setShowForm(false);
    setMessage('Reserva guardada en Bildiagnos.');
    await load();
  }

  const grouped = useMemo(() => {
    const out = new Map();
    for (const a of appointments) {
      const key = new Date(a.starts_at).toLocaleDateString('sv-SE');
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(a);
    }
    return [...out.entries()];
  }, [appointments]);

  return (
    <>
      <PageHeader title="Calendario" subtitle="Reservas del taller" action="Nueva reserva" onAction={() => setShowForm(v => !v)} />
      <div className="calendar-toolbar">
        <a className="secondary-button calendar-link" href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noreferrer">
          <CalendarDays size={18}/> Google Calendar <ExternalLink size={15}/>
        </a>
        <button className="secondary-button" onClick={load}><RefreshCw size={17}/> Actualizar</button>
      </div>

      {message && <div className="calendar-message">{message}</div>}

      {showForm && (
        <form className="card order-form calendar-form" onSubmit={save}>
          <h2>Nueva reserva</h2>
          <label>Matrícula<input value={form.plate} onChange={e => setForm({...form, plate:e.target.value})} placeholder="FGU510" /></label>
          <label>Trabajo / motivo<input value={form.reason} onChange={e => setForm({...form, reason:e.target.value})} placeholder="Servicio, diagnóstico..." /></label>
          <div className="calendar-form-grid">
            <label>Inicio<input type="datetime-local" required value={form.startsAt} onChange={e => setForm({...form, startsAt:e.target.value})} /></label>
            <label>Fin<input type="datetime-local" value={form.endsAt} onChange={e => setForm({...form, endsAt:e.target.value})} /></label>
          </div>
          <label>Notas<textarea value={form.notes} onChange={e => setForm({...form, notes:e.target.value})} /></label>
          <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button"><Plus size={17}/> Guardar reserva</button></div>
        </form>
      )}

      <section className="calendar-list">
        {loading ? <div className="card">Cargando calendario…</div> :
         grouped.length === 0 ? <div className="card empty-state"><h2>Sin reservas</h2><p>Crea la primera reserva. Después puedes añadirla a Google Calendar desde aquí.</p></div> :
         grouped.map(([day, list]) => (
          <div className="card calendar-day" key={day}>
            <h2>{new Date(day + 'T12:00:00').toLocaleDateString('es-SE', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</h2>
            {list.map(a => (
              <div className="appointment-row" key={a.id}>
                <div className="appointment-time">{new Date(a.starts_at).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}{a.ends_at ? '–' + new Date(a.ends_at).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}) : ''}</div>
                <div className="appointment-main"><strong>{a.plate_snapshot || 'Sin matrícula'}</strong><span>{a.reason || 'Reserva'}</span>{a.notes && <small>{a.notes}</small>}</div>
                <a className="secondary-button calendar-link" href={googleEventUrl(a)} target="_blank" rel="noreferrer">Añadir a Google</a>
              </div>
            ))}
          </div>
         ))}
      </section>
    </>
  );
}
