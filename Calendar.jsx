import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ExternalLink, Link2, Plus, RefreshCw, RotateCw } from 'lucide-react';
import PageHeader from './PageHeader.jsx';
import { supabase } from './supabaseClient.js';

const WORKSHOP_ID = 'e2ff2d9c-4e4f-475d-88b5-bbfca33240a5';

// Snapshot de citas reales consultadas el 17/10/2026; solo lectura, sin escritura en Supabase.
const GOOGLE_PREVIEW = [
  { id:'google-preview-s5ds6l6rcsqrtn6bulo9ue69oc', starts_at:'2026-10-14T09:00:00+02:00', ends_at:'2026-10-14T10:00:00+02:00', reason:'Lena cambio de alarma', plate_snapshot:'', google_preview:true },
  { id:'google-preview-iepjtohc5h713525qqn2gt8ens', starts_at:'2026-10-14T10:00:00+02:00', ends_at:'2026-10-14T11:00:00+02:00', reason:'Renanhus', plate_snapshot:'', google_preview:true },
  { id:'google-preview-hvsc809ik4gl42ja7dq0cptqc0', starts_at:'2026-10-16T08:00:00+02:00', ends_at:'2026-10-16T09:00:00+02:00', reason:'Jonny cambio de frenos traseros', plate_snapshot:'', google_preview:true },
  { id:'google-preview-7pnuvdhvbrpqod7c0b0pgpnhu0', starts_at:'2026-10-20T08:00:00+02:00', ends_at:'2026-10-20T09:00:00+02:00', reason:'Service renanhus', plate_snapshot:'', google_preview:true },
  { id:'google-preview-ol0tgvtj76i65ammi2cssc02v0', starts_at:'2026-10-21T08:00:00+02:00', ends_at:'2026-10-21T09:00:00+02:00', reason:'Renanhus', plate_snapshot:'', google_preview:true },
  { id:'google-preview-nbglo2a8qf3k9vs0ulu7mpbomk', starts_at:'2026-10-27T08:00:00+01:00', ends_at:'2026-10-27T09:00:00+01:00', reason:'Camara', plate_snapshot:'', google_preview:true }
];

const GOOGLE_TOKEN_KEY = 'bildiagnos-google-calendar-token';

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
  const details = [a.notes, a.plate_snapshot ? 'Registreringsnummer: ' + a.plate_snapshot : ''].filter(Boolean).join('\n');
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: start + '/' + end, details });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function googlePayload(a) {
  return {
    summary: [a.plate_snapshot, a.reason].filter(Boolean).join(' · ') || 'Bildiagnos',
    description: [a.notes, a.plate_snapshot ? 'Registreringsnummer: ' + a.plate_snapshot : '', 'Bildiagnos appointment: ' + a.id].filter(Boolean).join('\n'),
    start: { dateTime: new Date(a.starts_at).toISOString(), timeZone: 'Europe/Stockholm' },
    end: { dateTime: new Date(a.ends_at || new Date(new Date(a.starts_at).getTime() + 60 * 60 * 1000)).toISOString(), timeZone: 'Europe/Stockholm' }
  };
}

export default function Calendar() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [message, setMånadsage] = useState('');
  const [googleToken, setGoogleToken] = useState(() => sessionStorage.getItem(GOOGLE_TOKEN_KEY) || '');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [draftLane, setDraftLane] = useState('ranulfo-1');
  const [googleEdits, setGoogleEdits] = useState(() => { try { return JSON.parse(localStorage.getItem('bildiagnos-calendar-preview-edits') || '{}'); } catch { return {}; } });
  const previewRef = useRef(null);
  const dragRef = useRef(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [workBusy, setWorkBusy] = useState(false);
  useEffect(() => { const id = window.setInterval(() => setClockNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const now = new Date();
  const [form, setForm] = useState({
    plate: '', reason: '', startsAt: localInputValue(now),
    endsAt: localInputValue(new Date(now.getTime() + 60 * 60 * 1000)), notes: ''
  });

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('appointments')
      .select('id,starts_at,ends_at,reason,status,plate_snapshot,notes,work_order_id,google_calendar_id,google_event_id,google_synced_at,google_sync_status,work_started_at,work_finished_at,work_paused_at,work_paused_seconds,work_planned_extra_minutes,work_waiting_reason')
      .eq('workshop_id', WORKSHOP_ID)
      .order('starts_at', { ascending: true });
    if (error) setMånadsage('No se pudo cargar el calendario: ' + error.message);
    else setAppointments(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();

    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.provider_token;
      if (token) {
        sessionStorage.setItem(GOOGLE_TOKEN_KEY, token);
        setGoogleToken(token);
        setMånadsage('Google Calendar conectado.');
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.provider_token;
      if (token) {
        sessionStorage.setItem(GOOGLE_TOKEN_KEY, token);
        setGoogleToken(token);
      }
    });

    const channel = supabase.channel('bildiagnos-appointments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: 'workshop_id=eq.' + WORKSHOP_ID }, load)
      .subscribe();

    return () => {
      authListener.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, []);

  async function connectGoogle() {
    setGoogleBusy(true);
    setMånadsage('Abriendo autorización de Google…');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
        redirectTo: window.location.href.split('#')[0],
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });
    if (error) {
      setGoogleBusy(false);
      setMånadsage('No se pudo iniciar la autorización de Google: ' + error.message);
    }
  }

  async function pushToGoogle(a) {
    const token = googleToken || sessionStorage.getItem(GOOGLE_TOKEN_KEY);
    if (!token) {
      setMånadsage('Primero conecta Google Calendar.');
      return false;
    }
    setGoogleBusy(true);
    try {
      const url = a.google_event_id
        ? 'https://www.googleapis.com/calendar/v3/calendars/primary/events/' + encodeURIComponent(a.google_event_id)
        : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
      const response = await fetch(url, {
        method: a.google_event_id ? 'PUT' : 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(googlePayload(a))
      });
      if (response.status === 401) {
        sessionStorage.removeItem(GOOGLE_TOKEN_KEY);
        setGoogleToken('');
        throw new Error('La autorización de Google expiró. Pulsa “Conectar Google Calendar” otra vez.');
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error('Google Calendar respondió ' + response.status + ': ' + body.slice(0, 180));
      }
      const event = await response.json();
      const { error } = await supabase.from('appointments').update({
        google_calendar_id: 'primary',
        google_event_id: event.id,
        google_synced_at: new Date().toISOString(),
        google_sync_status: 'synced'
      }).eq('id', a.id);
      if (error) throw error;
      setMånadsage('Reserva sincronizada con Google Calendar.');
      await load();
      return true;
    } catch (error) {
      await supabase.from('appointments').update({ google_sync_status: 'error' }).eq('id', a.id);
      setMånadsage(error.message || 'No se pudo sincronizar con Google Calendar.');
      return false;
    } finally {
      setGoogleBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setMånadsage('');
    const plate = form.plate.replace(/\s+/g, '').toUpperCase();
    const { data, error } = await supabase.from('appointments').insert({
      workshop_id: WORKSHOP_ID,
      starts_at: new Date(form.startsAt).toISOString(),
      ends_at: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      reason: form.reason || null,
      plate_snapshot: plate || null,
      notes: [form.notes, '[BILDIAGNOS_LANE:' + draftLane + ']'].filter(Boolean).join('\n'),
      status: 'scheduled',
      google_sync_status: googleToken ? 'pending' : null
    }).select('id,starts_at,ends_at,reason,status,plate_snapshot,notes,work_order_id,google_calendar_id,google_event_id,google_synced_at,google_sync_status,work_started_at,work_finished_at,work_paused_at,work_paused_seconds,work_planned_extra_minutes,work_waiting_reason').single();
    if (error) { setMånadsage('No se pudo guardar: ' + error.message); return; }
    setShowForm(false);
    setMånadsage('Reserva guardada en Bildiagnos.');
    if (googleToken && data) await pushToGoogle(data);
    else await load();
  }

  const LANES = [{id:'ranulfo-1',name:'Ranulfo 1',detail:'Lift 1'},{id:'ranulfo-2',name:'Ranulfo 2',detail:'Lift 2'},{id:'extra',name:'Extra',detail:'Trabajo rápido'}];
  function laneOf(a) { return String(a.notes||'').match(/\[BILDIAGNOS_LANE:(ranulfo-1|ranulfo-2|extra)\]/)?.[1] || 'ranulfo-1'; }
  function setLane(notes,lane) { return String(notes||'').replace(/\[BILDIAGNOS_LANE:(ranulfo-1|ranulfo-2|extra)\]/g,'').trim() + '\n[BILDIAGNOS_LANE:' + lane + ']'; }
  const dayAppointments = [...appointments, ...GOOGLE_PREVIEW.map(a => ({...a,...(googleEdits[a.id] || {})}))].filter(a => new Date(a.starts_at).toLocaleDateString('sv-SE') === selectedDay).sort((a,b) => new Date(a.starts_at)-new Date(b.starts_at));
  function shiftDay(n) { const d = new Date(selectedDay + 'T12:00:00'); d.setDate(d.getDate()+n); setSelectedDay(d.toLocaleDateString('sv-SE')); setSelectedAppointment(null); }
  const beginHour=7, endHour=19, hourSpan=12;
  function hourOf(v) { const d=new Date(v); return d.getHours()+d.getMinutes()/60; }
  function position(a) {
    const start=Math.max(beginHour,Math.min(endHour,hourOf(a.starts_at)));
    const finish=Math.min(endHour,hourOf(a.ends_at || new Date(new Date(a.starts_at).getTime()+3600000)) + Number(a.work_planned_extra_minutes||0)/60);
    return {left:(start-beginHour)/hourSpan*100+'%', width:Math.max(1,(finish-start)/hourSpan*100)+'%'};
  }
  function pointerStart(e,a,mode) {
    if (e.button !== 0 || workBusy) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const track=e.currentTarget.closest('[data-calendar-track]');
    const rect=track.getBoundingClientRect();
    dragRef.current={id:a.id,mode,x:e.clientX,rect,start:new Date(a.starts_at).getTime(),end:new Date(a.ends_at||new Date(new Date(a.starts_at).getTime()+3600000)).getTime()+Number(a.work_planned_extra_minutes||0)*60000,lane:laneOf(a),a};
  }
  function pointerMove(e) {
    const d=dragRef.current;
    if (!d) return;
    const delta=Math.round(((e.clientX-d.x)/d.rect.width*hourSpan*60)/15)*15*60000;
    let start=d.start,end=d.end;
    if(d.mode==='move'){start+=delta;end+=delta;}
    if(d.mode==='left')start=Math.min(end-15*60000,start+delta);
    if(d.mode==='right')end=Math.max(start+15*60000,end+delta);
    const laneElement=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-lane]');
    const lane=laneElement?.dataset.lane||d.lane;
    const next={id:d.id,start,end,lane};
    previewRef.current=next;
    setDragPreview(next);
  }
  async function pointerEnd(e) {
    const d=dragRef.current;
    if(!d)return;
    dragRef.current=null;
    const preview=previewRef.current;
    previewRef.current=null;
    setDragPreview(null);
    if(!preview || (preview.start===d.start&&preview.end===d.end&&preview.lane===d.lane))return;
    const start=new Date(preview.start),end=new Date(preview.end);
    if(start.toLocaleDateString('sv-SE')!==selectedDay || end.toLocaleDateString('sv-SE')!==selectedDay){setMånadsage('Mueve la cita dentro del día seleccionado.');return;}
    const updates={starts_at:start.toISOString(),ends_at:end.toISOString(),work_planned_extra_minutes:0,notes:setLane(d.a.notes,preview.lane)};
    if(d.a.google_preview) {
      const next={...googleEdits,[d.id]:updates};
      localStorage.setItem('bildiagnos-calendar-preview-edits',JSON.stringify(next));
      setGoogleEdits(next);
      setSelectedAppointment(prev=>prev?.id===d.id?{...prev,...updates}:prev);
      setMånadsage('Cita de Google ajustada en esta prueba y este navegador. El calendario original no cambió.');
      return;
    }
    setWorkBusy(true);
    const {error}=await supabase.from('appointments').update(updates).eq('id',d.id).eq('workshop_id',WORKSHOP_ID);
    if(error)setMånadsage('No se pudo mover la cita: '+error.message);
    else {setAppointments(prev=>prev.map(a=>a.id===d.id?{...a,...updates}:a));setSelectedAppointment(prev=>prev?.id===d.id?{...prev,...updates}:prev);}
    setWorkBusy(false);
  }
  function displayAppointment(a) { return dragPreview?.id===a.id ? {...a,starts_at:new Date(dragPreview.start).toISOString(),ends_at:new Date(dragPreview.end).toISOString(),work_planned_extra_minutes:0} : a; }
  function status(a) {
    const started=a.work_started_at ? new Date(a.work_started_at).getTime() : 0;
    const finished=a.work_finished_at ? new Date(a.work_finished_at).getTime() : 0;
    const paused=a.work_paused_at ? new Date(a.work_paused_at).getTime() : 0;
    const planned=Math.max(60000,new Date(a.ends_at||new Date(new Date(a.starts_at).getTime()+3600000)).getTime()-new Date(a.starts_at).getTime()+Number(a.work_planned_extra_minutes||0)*60000);
    const elapsed=started?Math.max(0,(finished||paused||clockNow)-started-Number(a.work_paused_seconds||0)*1000):0;
    if(finished) return {color:'#e58a27',label:'Terminado',remaining:''};
    if(paused) return {color:'#aeb6c2',label:'Pausado · esperando piezas',remaining:''};
    if(!started) return {color:'#aeb6c2',label:'Sin comenzar',remaining:''};
    if(elapsed>=planned) return {color:'#dc4545',label:'Tiempo excedido',remaining:Math.ceil((elapsed-planned)/60000)+' min extra'};
    return {color:'#24a66b',label:'Trabajando',remaining:Math.ceil((planned-elapsed)/60000)+' min restantes'};
  }
  async function workAction(a,action) {
    if(a.google_preview || workBusy) return;
    setWorkBusy(true);
    try {
      const now=new Date().toISOString();
      let change={};
      if(action==='start') change={work_started_at:now,work_finished_at:null,work_paused_at:null,work_paused_seconds:0,work_waiting_reason:null};
      if(action==='pause') change={work_paused_at:now,work_waiting_reason:'Väntar på reservdelar'};
      if(action==='resume') change={work_paused_at:null,work_paused_seconds:Number(a.work_paused_seconds||0)+Math.floor((Date.now()-new Date(a.work_paused_at).getTime())/1000),work_waiting_reason:null};
      if(action==='finish') change={work_finished_at:now,work_paused_seconds:Number(a.work_paused_seconds||0)+(a.work_paused_at?Math.floor((Date.now()-new Date(a.work_paused_at).getTime())/1000):0),work_paused_at:null};
      if(action==='extend') change={work_planned_extra_minutes:Number(a.work_planned_extra_minutes||0)+30};
      if(action==='shorten') change={work_planned_extra_minutes:Math.max(-Math.floor((new Date(a.ends_at||new Date(new Date(a.starts_at).getTime()+3600000)).getTime()-new Date(a.starts_at).getTime())/60000)+15,Number(a.work_planned_extra_minutes||0)-30)};
      const {error}=await supabase.from('appointments').update(change).eq('id',a.id).eq('workshop_id',WORKSHOP_ID);
      if(error) throw error;
      setSelectedAppointment({...a,...change});
      await load();
    } catch(error) { setMånadsage('No se pudo guardar: '+error.message); }
    finally {setWorkBusy(false);}
  }

  const grouped = useMemo(() => {
    const out = new Map();
    for (const a of [...appointments, ...GOOGLE_PREVIEW]) {
      const key = new Date(a.starts_at).toLocaleDateString('sv-SE');
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(a);
    }
    return [...out.entries()].sort(([a],[b]) => a.localeCompare(b));
  }, [appointments]);

  return (
    <>
      <PageHeader title="Kalender" subtitle="Reservas del taller · Europe/Stockholm" action="Ny bokning" onAction={() => setShowForm(v => !v)} />
      <div className="calendar-toolbar">
        <button className={googleToken ? 'secondary-button google-connected' : 'primary-button'} onClick={connectGoogle} disabled={googleBusy}>
          <Link2 size={17}/>{googleToken ? 'Google conectado' : 'Conectar Google Calendar'}
        </button>
        <a className="secondary-button calendar-link" href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noreferrer">
          <CalendarDays size={18}/> Abrir Google Calendar <ExternalLink size={15}/>
        </a>
        <button className="secondary-button" onClick={load}><RefreshCw size={17}/> Actualizar</button>
      </div>

      <div className="calendar-message">Vista de prueba: 6 citas reales de Google Calendar (14–27 octubre), copiadas solo para visualización. No se sincronizan automáticamente ni crean órdenes.</div>
      {message && <div className="calendar-message">{message}</div>}

      {showForm && (
        <form className="card order-form calendar-form" onSubmit={save}>
          <h2>Ny bokning</h2>
          <label>Registreringsnummer<input value={form.plate} onChange={e => setForm({...form, plate:e.target.value})} placeholder="FGU510" /></label>
          <label>Arbete / motivo<input value={form.reason} onChange={e => setForm({...form, reason:e.target.value})} placeholder="Servicio, diagnóstico..." /></label>
          <div className="calendar-form-grid">
            <label>Inicio<input type="datetime-local" required value={form.startsAt} onChange={e => setForm({...form, startsAt:e.target.value})} /></label>
            <label>Fin<input type="datetime-local" value={form.endsAt} onChange={e => setForm({...form, endsAt:e.target.value})} /></label>
          </div>
          <label>Ubicación<select value={draftLane} onChange={e=>setDraftLane(e.target.value)}><option value="ranulfo-1">Ranulfo 1 · Lift 1</option><option value="ranulfo-2">Ranulfo 2 · Lift 2</option><option value="extra">Extra · sin lift</option></select></label>
          <label>Notas<textarea value={form.notes} onChange={e => setForm({...form, notes:e.target.value})} /></label>
          <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Avbryt</button><button className="primary-button"><Plus size={17}/> Spara reserva</button></div>
        </form>
      )}

      <section className="card" style={{marginTop:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:12,flexWrap:'wrap',marginBottom:14}}>
          <button type="button" className="secondary-button" onClick={()=>shiftDay(-1)}>◀</button>
          <strong>{new Date(selectedDay+'T12:00:00').toLocaleDateString('sv-SE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</strong>
          <button type="button" className="secondary-button" onClick={()=>shiftDay(1)}>▶</button>
          <button type="button" className="secondary-button" onClick={()=>setSelectedDay(new Date().toLocaleDateString('sv-SE'))}>Hoy</button>
          <input type="date" aria-label="Fecha" value={selectedDay} onChange={e=>{setSelectedDay(e.target.value);setSelectedAppointment(null);}}/>
        </div>
        <div style={{overflowX:'auto'}}>
          <div style={{minWidth:850}}>
            <div style={{display:'grid',gridTemplateColumns:'115px 1fr',borderBottom:'2px solid #b7c7db'}}>
              <strong style={{padding:10}}>Taller</strong>
              <div style={{display:'grid',gridTemplateColumns:'repeat(12,minmax(0,1fr))',background:'#dce7f5'}}>
                {Array.from({length:12},(_,i)=><div key={i} style={{borderLeft:'1px solid #b7c7db',textAlign:'center',padding:'10px 0',fontSize:12}}>{String(i+7).padStart(2,'0')}:00</div>)}
              </div>
            </div>
            {LANES.map(lane=>{
              const items=dayAppointments.filter(a=> (dragPreview?.id===a.id ? dragPreview.lane : laneOf(a))===lane.id);
              return <div key={lane.id} style={{display:'grid',gridTemplateColumns:'115px 1fr',minHeight:80,borderBottom:'1px solid #ccd5df'}}>
                <div style={{padding:10,borderRight:'1px solid #b7c7db'}}><strong>{lane.name}</strong><div style={{fontSize:11,color:'#64748b'}}>{lane.detail}</div></div>
                <div data-lane={lane.id} data-calendar-track="true" style={{position:'relative',minHeight:Math.max(80,items.length*44+8),backgroundImage:'linear-gradient(to right,#d5dce5 1px,transparent 1px)',backgroundSize:'8.333333% 100%'}}>
                  {items.map((a,i)=>{const shown=displayAppointment(a),p=position(shown),st=status(a);return <div key={a.id} onPointerDown={e=>pointerStart(e,a,'move')} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={()=>{dragRef.current=null;previewRef.current=null;setDragPreview(null);}} onClick={()=>{if(!dragPreview)setSelectedAppointment(a);}} title={a.google_preview?'Copia de Google: mueve solo en esta prueba':a.reason||'Arrastra para mover'} style={{position:'absolute',top:6+i*44,left:p.left,width:p.width,minWidth:68,height:36,background:st.color,border:'1px solid #64748b',borderRadius:4,color:'#172b3a',cursor:'grab',overflow:'hidden',fontSize:12,padding:'2px 9px',touchAction:'none',userSelect:'none'}}>
                    {<span onPointerDown={e=>{e.stopPropagation();pointerStart(e,a,'left');}} style={{position:'absolute',left:0,top:0,bottom:0,width:8,background:'#ffffff70',cursor:'ew-resize'}}/>}
                    <strong>{a.plate_snapshot||a.reason||'Reserva'}</strong><div style={{fontSize:10,whiteSpace:'nowrap'}}>{st.label}</div>
                    {<span onPointerDown={e=>{e.stopPropagation();pointerStart(e,a,'right');}} style={{position:'absolute',right:0,top:0,bottom:0,width:9,background:'#ffffff70',cursor:'ew-resize'}}/>}
                  </div>;})}
                  {selectedDay===new Date(clockNow).toLocaleDateString('sv-SE')&&hourOf(clockNow)>=beginHour&&hourOf(clockNow)<=endHour&&<div aria-label="Hora actual" style={{position:'absolute',left:((hourOf(clockNow)-beginHour)/hourSpan*100)+'%',top:0,bottom:0,width:2,background:'#e11d48',zIndex:4,pointerEvents:'none'}}/>}
                </div>
              </div>;
            })}
          </div>
        </div>
        {loading&&<p>Cargando citas…</p>}
        {!loading&&dayAppointments.length===0&&<p>Sin reservas para este día.</p>}
        {selectedAppointment&&<div style={{borderTop:'1px solid #ccd5df',marginTop:14,paddingTop:14}}>
          <h3>{selectedAppointment.plate_snapshot||'Cita'} · {selectedAppointment.reason||'Trabajo'}</h3>
          <p>{new Date(selectedAppointment.starts_at).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}–{new Date(selectedAppointment.ends_at||selectedAppointment.starts_at).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})} · {status(selectedAppointment).label} {status(selectedAppointment).remaining}</p>
          {selectedAppointment.notes&&<p>{selectedAppointment.notes}</p>}
          {!selectedAppointment.google_preview&&<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {!selectedAppointment.work_started_at&&<button type="button" className="primary-button" disabled={workBusy} onClick={()=>workAction(selectedAppointment,'start')}>Iniciar</button>}
            {selectedAppointment.work_started_at&&!selectedAppointment.work_finished_at&&!selectedAppointment.work_paused_at&&<button type="button" className="secondary-button" disabled={workBusy} onClick={()=>workAction(selectedAppointment,'pause')}>Pausar · esperar piezas</button>}
            {selectedAppointment.work_paused_at&&!selectedAppointment.work_finished_at&&<button type="button" className="primary-button" disabled={workBusy} onClick={()=>workAction(selectedAppointment,'resume')}>Continuar</button>}
            {selectedAppointment.work_started_at&&!selectedAppointment.work_finished_at&&<button type="button" className="secondary-button" disabled={workBusy} onClick={()=>workAction(selectedAppointment,'finish')}>Terminar</button>}
            <button type="button" className="secondary-button" disabled={workBusy} onClick={()=>workAction(selectedAppointment,'shorten')}>−30 min</button>
            <button type="button" className="secondary-button" disabled={workBusy} onClick={()=>workAction(selectedAppointment,'extend')}>+30 min</button>
          </div>}
          {selectedAppointment.google_preview&&<small>Google Calendar: vista de prueba, solo lectura</small>}
          <button type="button" className="secondary-button" style={{marginTop:8}} onClick={()=>setSelectedAppointment(null)}>Cerrar detalles</button>
        </div>}
      </section>
    </>
  );
}
