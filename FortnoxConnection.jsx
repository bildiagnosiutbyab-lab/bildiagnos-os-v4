import { useState } from 'react';
import { supabase } from './supabaseClient.js';

export default function FortnoxConnection() {
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState(null);
  const verify=async()=>{
    setBusy(true);setResult(null);
    try {
      const {data,error}=await supabase.functions.invoke('fortnox-production-readonly',{body:{action:'verify'}});
      if(error)throw error;
      setResult(data);
    }catch(e){setResult({ok:false,error:e.message||String(e)});}
    finally{setBusy(false);}
  };
  return <section className="card">
    <h1>Fortnox · Bildiagnos i Utby AB</h1>
    <p>Conexión real de solo lectura. No crea ni modifica clientes, facturas o pagos.</p>
    <button type="button" className="primary-button" disabled={busy} onClick={verify}>{busy?'Verificando…':'Verificar Fortnox real'}</button>
    {result&&<div role="status" style={{marginTop:16}}>
      <strong>{result.ok?'Empresa verificada':'Conexión pendiente'}</strong>
      <p>{result.companyName||result.error||result.message}</p>
      {result.ok&&<p>Solo lectura · Organización: {result.organizationNumber||'No disponible'}</p>}
      {result.needsAuthorization&&<p>Falta autorizar la empresa real en Fortnox. No se ha modificado nada.</p>}
    </div>}
  </section>;
}
