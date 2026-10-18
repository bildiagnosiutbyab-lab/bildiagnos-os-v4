import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient.js';

const TYPES = [
  ['cleaning','Städning','Limpieza'],['organizing','Ordning','Organización'],
  ['parts_orders','Reservdelsbeställning','Pedidos de piezas'],
  ['meeting','Möte','Reunión'],['lunch','Lunch','Almuerzo'],
  ['warranty','Garanti','Garantía'],['other','Övrigt','Otros'],
];
const fmt = (ms) => { const s = Math.max(0,Math.floor(ms/1000)); return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':'); };
export default function WorkshopTimer({language='sv'}) {
  const [entries,setEntries] = useState([]);
  const [activity,setActivity] = useState('cleaning');
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [now,setNow] = useState(Date.now());
  const es = language === 'es';
  const refresh = async () => {
    const {data,error} = await supabase.from('workshop_activity_entries').select('*').order('started_at',{ascending:false}).limit(250);
    if (error) setError(error.message); else {setEntries(data||[]);setError('');}
  };
  useEffect(() => {
    refresh();
    const clock = setInterval(()=>setNow(Date.now()),1000);
    const sync = setInterval(refresh,12000);
    const onFocus = () => refresh();
    window.addEventListener('focus',onFocus);
    const channel = supabase.channel('workshop-timer-live').on('postgres_changes',{event:'*',schema:'public',table:'workshop_activity_entries'},()=>refresh()).subscribe();
    return () => {clearInterval(clock);clearInterval(sync);window.removeEventListener('focus',onFocus);supabase.removeChannel(channel);};
  },[]);
  const running = entries.find(e=>!e.ended_at);
  const today = new Date().toLocaleDateString('sv-SE');
  const todayEntries = entries.filter(e=>new Date(e.started_at).toLocaleDateString('sv-SE')===today);
  const todayMs = todayEntries.reduce((sum,e)=>sum+(new Date(e.ended_at||now)-new Date(e.started_at)),0);
  const run = async (fn) => {setBusy(true);setError('');try {const {error}=await fn();if(error)throw error;await refresh();}catch(e){setError(e.message||String(e));}finally{setBusy(false);}};
  const start = () => run(async()=>{
    if (running) return {error:new Error(es?'Detén primero la actividad actual.':'Avsluta pågående aktivitet först.')};
    return supabase.from('workshop_activity_entries').insert({activity,note:note.trim(),started_at:new Date().toISOString()});
  });
  const stop = () => run(()=>supabase.from('workshop_activity_entries').update({ended_at:new Date().toISOString()}).eq('id',running.id).is('ended_at',null));
  const label = (type) => {const t=TYPES.find(x=>x[0]===type);return t?(es?t[2]:t[1]):type;};
  return <section className="card workshop-timer">
    <h1>{es?'Taller':'Verkstad'}</h1>
    <p>{es?'Tiempo de actividades internas. No se factura a clientes.':'Intern tid som inte faktureras kunder.'}</p>
    <div className="workshop-clock">{running?fmt(now-new Date(running.started_at)): '00:00:00'}</div>
    {running?<><p><strong>{label(running.activity)}</strong> {running.note && ' · '+running.note}</p><button type="button" className="primary-button" onClick={stop} disabled={busy}>{es?'Terminar actividad':'Avsluta aktivitet'}</button></>:<>
      <label>{es?'Actividad':'Aktivitet'}<select value={activity} onChange={e=>setActivity(e.target.value)}>{TYPES.map(t=><option key={t[0]} value={t[0]}>{es?t[2]:t[1]}</option>)}</select></label>
      <label>{es?'Nota opcional':'Valfri anteckning'}<input value={note} onChange={e=>setNote(e.target.value)} placeholder={es?'Qué se hizo':'Vad gjordes'} /></label>
      <button type="button" className="primary-button" onClick={start} disabled={busy}>{es?'Iniciar cronómetro':'Starta tidtagning'}</button>
    </>}
    {error && <p role="alert" className="auth-message">{error}</p>}
    <h2>{es?'Hoy':'Idag'}: {fmt(todayMs)}</h2>
    <div className="workshop-history">{todayEntries.map(e=><div key={e.id}><strong>{label(e.activity)}</strong> · {fmt(new Date(e.ended_at||now)-new Date(e.started_at))}<small>{new Date(e.started_at).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}{e.note?' · '+e.note:''}</small></div>)}</div>
  </section>;
}
