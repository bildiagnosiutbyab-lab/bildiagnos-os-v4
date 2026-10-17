import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';

const BUCKET = 'work-order-documents';
const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = new Set(['image/jpeg','image/png','image/webp','application/pdf']);

export default function OrderDocuments({ order }) {
  const [docs,setDocs] = useState([]);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const orderId = order?.relationalId;

  async function refresh() {
    if (!orderId) return;
    const {data,error} = await supabase.from('work_order_documents').select('*').eq('work_order_id',orderId).order('created_at',{ascending:false});
    if (error) throw error;
    setDocs(data || []);
  }
  useEffect(() => {
    let active=true;
    if (orderId) supabase.from('work_order_documents').select('*').eq('work_order_id',orderId).order('created_at',{ascending:false})
      .then(({data,error}) => { if (!active) return; if(error) setMessage(error.message); else setDocs(data||[]); });
    return () => {active=false;};
  },[orderId]);

  async function upload(event) {
    const files=Array.from(event.target.files||[]);
    event.target.value='';
    if (!files.length || busy || !orderId) return;
    setBusy(true);setMessage('');
    try {
      const {data:{user},error:userError}=await supabase.auth.getUser();
      if(userError || !user) throw new Error('Inicia sesión para guardar documentos.');
      const {data:membership,error:memberError}=await supabase.from('workshop_members').select('workshop_id').eq('user_id',user.id).single();
      if(memberError || !membership) throw new Error('No se encontró el taller de esta sesión.');
      for (const file of files) {
        if (!TYPES.has(file.type) || file.size>MAX_BYTES) throw new Error('Solo JPG, PNG, WEBP o PDF de máximo 15 MB.');
        const path=`${membership.workshop_id}/${orderId}/${crypto.randomUUID()}`;
        const {error:uploadError}=await supabase.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});
        if(uploadError) throw uploadError;
        const {error:dbError}=await supabase.from('work_order_documents').insert({
          workshop_id:membership.workshop_id,work_order_id:orderId,storage_path:path,
          original_filename:file.name,content_type:file.type,file_size:file.size,created_by:user.id
        });
        if(dbError) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw dbError;
        }
      }
      await refresh();
      setMessage('Följesedel guardada en la nube y vinculada a esta orden.');
    } catch(error) { console.error('Document upload failed',error);setMessage('No se pudo guardar: '+(error?.message||error)); }
    finally {setBusy(false);}
  }

  async function openDocument(doc) {
    const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path,120);
    if(error || !data?.signedUrl) {setMessage('No se pudo abrir el documento: '+(error?.message||''));return;}
    window.open(data.signedUrl,'_blank','noopener,noreferrer');
  }

  if(!orderId) return null;
  return <section className="card">
    <h3>Följesedlar / Albaranes</h3>
    <p>Fotografía o PDF del proveedor. Se conserva por orden en almacenamiento privado, también disponible desde otro dispositivo con tu sesión.</p>
    <label className="primary-button" style={{display:'inline-block',cursor:busy?'wait':'pointer'}}>
      {busy?'Guardando…':'Tomar foto / Elegir de galería'}
      <input type="file" accept="image/*,application/pdf" multiple disabled={busy} onChange={upload} style={{position:'absolute',width:1,height:1,opacity:0}} />
    </label>
    {message && <p role="status">{message}</p>}
    {docs.length===0 ? <p>Sin documentos guardados.</p> : <ul>{docs.map(doc=><li key={doc.id}>
      <button type="button" className="secondary-button" onClick={()=>openDocument(doc)}>{doc.original_filename}</button>
      {' · '}{new Date(doc.created_at).toLocaleDateString('sv-SE')}
    </li>)}</ul>}
    <small>Conserva también la factura o recibo contable correspondiente. No elimines los documentos originales.</small>
  </section>;
}
