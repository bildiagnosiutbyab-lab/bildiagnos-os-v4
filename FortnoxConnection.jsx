import { useState } from 'react';
import { supabase } from './supabaseClient.js';

export default function FortnoxConnection() {
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState(null);
  const [starting,setStarting]=useState(false);
  const activationStatus=new URLSearchParams(window.location.search).get('fortnox_activation');
  const activate=async()=>{
    setStarting(true);setResult(null);
    try {
      const {data,error}=await supabase.functions.invoke('fortnox-production-activate',{body:{action:'begin'}});
      if(error)throw error;
      if(!data?.ok||!data.authorizationUrl)throw Error(data?.error||'No se pudo iniciar Fortnox');
      window.location.assign(data.authorizationUrl);
    }catch(e){setResult({ok:false,error:e.message||String(e)});setStarting(false);}
  };
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
    <p>Activa únicamente Bildiagnos i Utby AB. Fortnox te pedirá aprobar los permisos. No se envía ninguna factura durante la activación.</p>
    {activationStatus&&<p role="status">Resultado de autorización: {activationStatus==='verified'?'Identidad verificada. Ahora pulsa Verificar Fortnox real.':activationStatus+'. Revisa la autorización antes de continuar.'}</p>}
    <button type="button" className="primary-button" disabled={starting} onClick={activate}>{starting?'Abriendo Fortnox…':'Autorizar Fortnox real'}</button>
    <button type="button" className="primary-button" disabled={busy} onClick={verify}>{busy?'Verificando…':'Verificar Fortnox real'}</button>
    {result&&<div role="status" style={{marginTop:16}}>
      <strong>{result.ok?'Empresa verificada':'Conexión pendiente'}</strong>
      <p>{result.companyName||result.error||result.message}</p>
      {result.ok&&<p>Solo lectura · Organización: {result.organizationNumber||'No disponible'}</p>}
      {result.needsAuthorization&&<p>Falta autorizar la empresa real en Fortnox. No se ha modificado nada.</p>}
    </div>}
  </section>;
}
