import { useEffect, useMemo, useRef, useState } from 'react';
import { importCatalogOrderItems, updateCommercialOrderVehicle } from './commercialRepository.js';
import { supabase } from './supabaseClient.js';
import { parseCatalogLaborHours } from './catalogTime.mjs';
import './catalogOrderImport.css';

const CATALOGS = { 'AD Bildelar': 'https://katalog.adsverige.com/store/se7l1/parts', BilXtra: 'https://pro.bilxtra.se/', ZEPRO: 'https://zepro.pro/sv/catalog', Partslink24: 'https://www.partslink24.com/' };
const catalogUrl = (catalog, registration) => {
  const registrationNumber = plate(registration);
  if (catalog === 'BilXtra' && registrationNumber) {
    return `https://pro.bilxtra.se/INTERSHOP/web/WFS/Mekonomen-BilxtraB2BSE-Site/sv_SE/-/SEK/ViewCarOverview-Start?country=SE&registrationNumber=${encodeURIComponent(registrationNumber)}`;
  }
  if (catalog === 'AD Bildelar' && registrationNumber) {
    return `https://katalog.adsverige.com/store/se7l1/parts?bildiagnosReg=${encodeURIComponent(registrationNumber)}`;
  }
  return CATALOGS[catalog];
};
const numeric = (value) => { if (value === null || value === undefined || value === '') return null; const number = Number(String(value).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(number) ? number : null; };
const plate = (value) => String(value || '').replace(/\s/g, '').toUpperCase();
const amount = (value) => value === null || value === undefined ? '—' : new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
function normalizedSource(value) { const text = String(value || '').toLowerCase(); return text.includes('bilxtra') ? 'BilXtra' : text.includes('zepro') ? 'ZEPRO' : (text.includes('ad bildelar') || text === 'ad' ? 'AD Bildelar' : null); }
function parsePayload(raw, expectedSource) {
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('El contenido debe ser un objeto JSON exportado del catálogo.');
  const foundSource = normalizedSource(payload.source);
  if (foundSource && foundSource !== expectedSource) throw new Error(`La exportación corresponde a ${foundSource}; selecciona el mismo catálogo.`);
  const parts = (Array.isArray(payload.parts) ? payload.parts : []).map((item) => ({ articleNumber: String(item.articleNumber ?? item.partNumber ?? item.number ?? item.code ?? '').trim(), description: String(item.description ?? item.name ?? item.title ?? '').trim(), quantity: numeric(item.qty ?? item.quantity ?? item.amount), cost: numeric(item.cost ?? item.purchasePrice), price: numeric(item.price ?? item.salePrice ?? item.unitPrice), discount: numeric(item.discount ?? item.discountPercent), supplier: String(item.supplier ?? expectedSource).trim() || expectedSource })).filter((item) => item.description || item.articleNumber);
  const rawLabor = Array.isArray(payload.laborItems) ? payload.laborItems : (Array.isArray(payload.labor) ? payload.labor : []);
  const laborItems = rawLabor.map((item) => ({ code: String(item.code ?? item.articleNumber ?? '').trim(), description: String(item.description ?? item.name ?? item.title ?? '').trim(), hours: parseCatalogLaborHours(item), hourlyRate: numeric(item.hourlyRate ?? item.unitPrice ?? item.rate) })).filter((item) => item.description);
  if (!parts.length && !laborItems.length) throw new Error('La exportación no contiene piezas ni trabajos reconocibles.');
  if (parts.some((item) => !item.description || !item.quantity || item.quantity <= 0)) throw new Error('Cada pieza necesita descripción y cantidad mayor que cero.');
  const rawVehicle = (
    payload.vehicle && typeof payload.vehicle === 'object' ? payload.vehicle :
    payload.car && typeof payload.car === 'object' ? payload.car :
    payload.vehicleData && typeof payload.vehicleData === 'object' ? payload.vehicleData :
    payload.carInfo && typeof payload.carInfo === 'object' ? payload.carInfo :
    {}
  );
  const vehicle = {
    make: String(rawVehicle.make ?? rawVehicle.brand ?? rawVehicle.manufacturer ?? rawVehicle.makeName ?? payload.make ?? payload.vehicleMake ?? payload.makeName ?? '').trim(),
    model: String(rawVehicle.model ?? rawVehicle.modelName ?? payload.model ?? payload.vehicleModel ?? payload.modelName ?? '').trim(),
    modelYear: numeric(rawVehicle.modelYear ?? rawVehicle.year ?? rawVehicle.yearModel ?? payload.modelYear ?? payload.year ?? payload.yearModel),
    vin: String(rawVehicle.vin ?? rawVehicle.VIN ?? rawVehicle.chassisNumber ?? rawVehicle.chassis ?? rawVehicle.chassisNo ?? payload.vin ?? payload.VIN ?? payload.chassisNumber ?? payload.chassisNo ?? '').trim(),
    engine: String(rawVehicle.engine ?? rawVehicle.engineCode ?? rawVehicle.motorCode ?? payload.engine ?? payload.engineCode ?? payload.motorCode ?? '').trim(),
    fuelType: String(rawVehicle.fuelType ?? rawVehicle.fuel ?? rawVehicle.fuelName ?? payload.fuelType ?? payload.fuel ?? payload.fuelName ?? '').trim(),
    description: String(rawVehicle.description ?? rawVehicle.name ?? rawVehicle.vehicleName ?? payload.vehicleDescription ?? payload.carDescription ?? payload.vehicleName ?? '').trim(),
  };
  return {
    plate: String(payload.plate ?? payload.registrationNumber ?? payload.regNo ?? payload.regnr ?? rawVehicle.registrationNumber ?? rawVehicle.regNo ?? rawVehicle.regnr ?? rawVehicle.plate ?? '').trim(),
    vehicle,
    parts,
    laborItems,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
async function imageFileForVision(file) {
  const originalUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('El teléfono no pudo preparar esta imagen.'));
      img.src = originalUrl;
    });
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('No se pudo preparar la captura.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(originalUrl); }
}
function withTimeout(promise, milliseconds) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error('La lectura tardó demasiado. Vuelve a elegir la captura.')), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function validatePreview(preview) {
  if (!preview || (!preview.parts.length && !preview.laborItems.length)) throw new Error('La selección no contiene piezas ni trabajos.');
  if (preview.parts.some((item) => !String(item.description || '').trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) throw new Error('Cada pieza necesita descripción y cantidad mayor que cero.');
  if (preview.parts.some((item) => item.price !== null && item.price !== '' && (!Number.isFinite(Number(item.price)) || Number(item.price) < 0))) throw new Error('El precio de cada pieza debe ser cero o mayor.');
  if (preview.parts.some((item) => item.discount !== null && item.discount !== '' && (!Number.isFinite(Number(item.discount)) || Number(item.discount) < 0 || Number(item.discount) > 100))) throw new Error('El descuento debe estar entre 0 y 100%.');
  if (preview.laborItems.some((item) => !String(item.description || '').trim() || item.hours === null || item.hours === '' || !Number.isFinite(Number(item.hours)) || Number(item.hours) < 0)) throw new Error('Cada trabajo necesita descripción y horas estimadas válidas.');
  if (preview.laborItems.some((item) => item.hourlyRate !== null && item.hourlyRate !== '' && (!Number.isFinite(Number(item.hourlyRate)) || Number(item.hourlyRate) < 0))) throw new Error('El precio/hora debe ser cero o mayor.');
}

export default function CatalogOrderImport({ order, onSaved }) {
  const [source, setSource] = useState('AD Bildelar'); const [raw, setRaw] = useState(''); const [preview, setPreview] = useState(null); const [message, setMessage] = useState(''); const [confirmedBlankPlate, setConfirmedBlankPlate] = useState(false); const [busy, setBusy] = useState(false); const importingRef = useRef(false);
  const [mobileImage, setMobileImage] = useState(null);
  const [mobileVehicle, setMobileVehicle] = useState({ make:'', model:'', modelYear:'', vin:'', engine:'', fuelType:'', description:'' });
  const [mobileReading, setMobileReading] = useState(false);
  const [mobileSaving, setMobileSaving] = useState(false);
  const orderPlate = order.plate || ''; const matchingPlate = preview?.plate && plate(preview.plate) === plate(orderPlate); const mismatch = preview?.plate && !matchingPlate; const count = useMemo(() => ({ parts: preview?.parts.length || 0, labor: preview?.laborItems.length || 0 }), [preview]);
  const previewValid = useMemo(() => { try { validatePreview(preview); return true; } catch { return false; } }, [preview]);
  const canConfirm = previewValid && !mismatch && (matchingPlate || confirmedBlankPlate);
  useEffect(() => {
    const receiveTransfer = (event) => {
      try {
        const payload = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
        const receivedSource = normalizedSource(payload?.source);
        if (receivedSource !== 'AD Bildelar') throw new Error('La transferencia recibida no corresponde a AD Bildelar.');
        const parsed = parsePayload(JSON.stringify(payload), receivedSource);
        setSource(receivedSource);
        setRaw(JSON.stringify(payload));
        setPreview(parsed);
        setConfirmedBlankPlate(false);
        setMessage('Selección de AD recibida. Revisa la previsualización antes de guardar.');
      } catch (error) {
        setPreview(null);
        setMessage(error.message || 'No se pudo leer la selección enviada por AD.');
      }
    };
    window.addEventListener('BILDIAGNOS_CATALOG_TRANSFER', receiveTransfer);
    return () => window.removeEventListener('BILDIAGNOS_CATALOG_TRANSFER', receiveTransfer);
  }, []);
  const openCatalog = async (catalog) => {
    const normalizedPlate = plate(orderPlate);
    if (!normalizedPlate) { setMessage('Esta orden no tiene matrícula.'); return; }
    try { await navigator.clipboard?.writeText(normalizedPlate); } catch { /* convenience only */ }
    window.open(catalogUrl(catalog, normalizedPlate), `BILDIAGNOS_${catalog === 'BilXtra' ? 'BILXTRA' : catalog === 'Partslink24' ? 'PARTSLINK24' : catalog === 'ZEPRO' ? 'ZEPRO' : 'AD'}_${normalizedPlate}`);
    setSource(catalog);
    setMessage(catalog === 'BilXtra'
      ? `BilXtra abierto directamente con la matrícula ${normalizedPlate}.`
      : catalog === 'Partslink24'
        ? `Partslink24 abierto. Matrícula ${normalizedPlate} lista en el portapapeles para identificar el vehículo.`
        : catalog === 'ZEPRO'
          ? `ZEPRO abierto. Matrícula ${normalizedPlate} lista en el portapapeles para seleccionar el vehículo.`
          : `AD Bildelar abierto con la matrícula ${normalizedPlate}. La extensión de Opera la seleccionará automáticamente.`);
  };
  const receiveCatalogSelection = async () => {
    if (source === 'AD Bildelar') {
      setMessage('Buscando la última selección enviada desde AD…');
      window.dispatchEvent(new Event('BILDIAGNOS_REQUEST_CATALOG_TRANSFER'));
      window.setTimeout(() => setMessage((current) => current === 'Buscando la última selección enviada desde AD…' ? 'No se encontró una selección de AD. Comprueba que la extensión v1.0 esté activa y vuelve a pulsar Enviar selección a Bildiagnos.' : current), 1200);
      return;
    }
    try {
      const clipboard = await navigator.clipboard.readText();
      if (!clipboard.trim()) throw new Error('El portapapeles está vacío.');
      setRaw(clipboard);
      setPreview(parsePayload(clipboard, source));
      setConfirmedBlankPlate(false);
      setMessage('Datos del catálogo recibidos. Revisa antes de guardar.');
    } catch (error) {
      setPreview(null);
      setMessage(error.message || 'No pude leer los datos copiados del catálogo.');
    }
  };
  const previewImport = () => { try { setPreview(parsePayload(raw, source)); setConfirmedBlankPlate(false); setMessage('Revisa la previsualización antes de guardar.'); } catch (error) { setPreview(null); setMessage(error.message || 'No se pudo leer la exportación.'); } };
  const updatePreview = (group, index, field, value) => setPreview((current) => ({ ...current, [group]: current[group].map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const removePreview = (group, index) => setPreview((current) => ({ ...current, [group]: current[group].filter((_, itemIndex) => itemIndex !== index) }));
  const chooseMobileImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMessage('Selecciona una captura o foto.'); return; }
    if (file.size > 10 * 1024 * 1024) { setMessage('La imagen es demasiado grande. Usa una captura de menos de 10 MB.'); return; }
    if (mobileImage?.url) URL.revokeObjectURL(mobileImage.url);
    const url = URL.createObjectURL(file);
    setMobileImage({ file, url, name: file.name });
    setMobileVehicle({ make:'', model:'', modelYear:'', vin:'', engine:'', fuelType:'', description:'' });
    setMobileReading(true);
    setMessage('Leyendo la captura con IA…');
    try {
      setMessage('Preparando la captura para lectura…');
      let imageDataUrl;
      try {
        imageDataUrl = await imageFileForVision(file);
      } catch (conversionError) {
        if (file.size > 4 * 1024 * 1024) throw conversionError;
        imageDataUrl = await readFileAsDataUrl(file);
      }
      setMessage('Leyendo los datos del vehículo con IA…');
      const { data, error } = await withTimeout(
        supabase.functions.invoke('vehicle-image-reader', { body: { imageDataUrl, plate: orderPlate || null } }),
        45000
      );
      if (error) throw error;
      const detected = data?.vehicle || {};
      const next = {
        make: String(detected.make || '').trim(),
        model: String(detected.model || '').trim(),
        modelYear: detected.modelYear ? String(detected.modelYear).trim() : '',
        vin: String(detected.vin || '').trim().toUpperCase(),
        engine: String(detected.engine || '').trim(),
        fuelType: String(detected.fuelType || '').trim(),
        description: String(detected.description || '').trim(),
      };
      setMobileVehicle(next);
      setMessage(Object.values(next).some(Boolean)
        ? 'Datos detectados con IA. Revísalos y pulsa “Usar estos datos en esta orden” para guardarlos.'
        : 'La IA no encontró datos claros del vehículo. Puedes completarlos manualmente antes de confirmar.');
    } catch (error) {
      setMessage(error?.message || 'No se pudo leer automáticamente la captura. Puedes completar los datos manualmente.');
    } finally {
      setMobileReading(false);
      event.target.value = '';
    }
  };
  const applyMobileVehicle = async () => {
    const vehicle = Object.fromEntries(Object.entries(mobileVehicle).map(([key,value]) => [key, String(value || '').trim()]));
    if (!Object.values(vehicle).some(Boolean)) { setMessage('Escribe al menos un dato del vehículo.'); return; }
    if (mobileSaving) return;
    setMobileSaving(true);
    try {
      const normalizedVehicle = { ...vehicle, modelYear: numeric(vehicle.modelYear) };
      await updateCommercialOrderVehicle({ workOrderId: order.relationalId, vehicle: normalizedVehicle });
      setPreview((current) => current ? ({
        ...current,
        plate: current.plate || orderPlate,
        vehicle: { ...(current.vehicle || {}), ...normalizedVehicle },
      }) : current);
      setConfirmedBlankPlate(true);
      setMessage('Datos del vehículo guardados en esta orden.');
      await onSaved?.();
    } catch (error) {
      setMessage(error?.message || 'No se pudieron guardar los datos del vehículo.');
    } finally {
      setMobileSaving(false);
    }
  };
  const confirmImport = async () => { if (!order.relationalId || importingRef.current) return; importingRef.current = true; setBusy(true); try { validatePreview(preview); if (!canConfirm) throw new Error('Confirma que la matrícula corresponde a esta orden.'); const result = await importCatalogOrderItems({ workOrderId: order.relationalId, source, plate: preview.plate || orderPlate, vehicle: preview.vehicle, parts: preview.parts, laborItems: preview.laborItems }); if (source === 'AD Bildelar') window.dispatchEvent(new Event('BILDIAGNOS_CATALOG_TRANSFER_CONSUMED')); setMessage(`Importación confirmada: ${result.parts_imported || 0} piezas y ${result.services_imported || 0} trabajos.`); setRaw(''); setPreview(null); setConfirmedBlankPlate(false); await onSaved?.(); } catch (error) { setMessage(error.message || 'No se pudo guardar la importación.'); } finally { importingRef.current = false; setBusy(false); } };
  if (!order.relationalId) return null;
  return <section className="catalog-import"><header><div><p>Catálogos externos</p><h2>Importar piezas y trabajo</h2></div><span>Orden · {orderPlate || 'sin matrícula'}</span></header><p className="catalog-import-note">Los catálogos se abren fuera de Bildiagnos. No se hacen pedidos ni se guardan credenciales.</p><div className="catalog-import-actions">{Object.keys(CATALOGS).map((catalog) => <button type="button" key={catalog} className="catalog-open" onClick={() => openCatalog(catalog)}>Abrir {catalog}</button>)}<label>Importar desde<select value={source} onChange={(event) => { setSource(event.target.value); setPreview(null); }}><option>AD Bildelar</option><option>BilXtra</option><option>ZEPRO</option></select></label></div><div className="catalog-return"><p>{source === 'AD Bildelar' ? 'En AD marca las piezas y pulsa Enviar selección a Bildiagnos. Después vuelve a esta orden.' : 'Cuando termines de seleccionar en el catálogo, usa su opción de copiar a Bildiagnos y vuelve aquí.'}</p><button type="button" className="catalog-preview-button" onClick={receiveCatalogSelection}>Recibir selección del catálogo</button></div>
    <div className="catalog-mobile-fallback">
      <strong>📷 Móvil: captura / foto</strong>
      <p>Si el catálogo no envía los datos del vehículo, carga una captura. La IA rellenará la ficha, pero no se guardará nada hasta que confirmes.</p>
      <label className="catalog-preview-button">{mobileReading ? 'Leyendo captura…' : 'Elegir captura / foto'}<input type="file" accept="image/*" onChange={chooseMobileImage} disabled={mobileReading || mobileSaving} style={{display:'none'}} /></label>
      {mobileImage && <div className="catalog-mobile-preview"><img src={mobileImage.url} alt="Captura del catálogo" /><div className="catalog-mobile-fields">
        <input placeholder="Marca" value={mobileVehicle.make} onChange={(e)=>setMobileVehicle({...mobileVehicle,make:e.target.value})}/>
        <input placeholder="Modelo" value={mobileVehicle.model} onChange={(e)=>setMobileVehicle({...mobileVehicle,model:e.target.value})}/>
        <input placeholder="Año" inputMode="numeric" value={mobileVehicle.modelYear} onChange={(e)=>setMobileVehicle({...mobileVehicle,modelYear:e.target.value})}/>
        <input placeholder="VIN / chasis" value={mobileVehicle.vin} onChange={(e)=>setMobileVehicle({...mobileVehicle,vin:e.target.value})}/>
        <input placeholder="Motor / código motor" value={mobileVehicle.engine} onChange={(e)=>setMobileVehicle({...mobileVehicle,engine:e.target.value})}/>
        <input placeholder="Combustible" value={mobileVehicle.fuelType} onChange={(e)=>setMobileVehicle({...mobileVehicle,fuelType:e.target.value})}/>
        <button type="button" className="catalog-preview-button" disabled={mobileReading || mobileSaving} onClick={applyMobileVehicle}>{mobileSaving ? 'Guardando…' : 'Usar estos datos en esta orden'}</button>
      </div></div>}
    </div>{message && <p className={message.startsWith('No se') || message.includes('necesita') || message.includes('corresponde') ? 'catalog-import-error' : 'catalog-import-message'}>{message}</p>}{preview && <div className="catalog-preview"><h3>Previsualización obligatoria</h3><p>Puedes corregir o quitar líneas antes de guardar. Matrícula de la orden: <b>{orderPlate || '—'}</b> · Matrícula exportada: <b>{preview.plate || 'no incluida'}</b></p>{preview.vehicle && Object.values(preview.vehicle).some(Boolean) && <p><strong>Vehículo detectado automáticamente:</strong> {[preview.vehicle.make, preview.vehicle.model, preview.vehicle.modelYear, preview.vehicle.engine].filter(Boolean).join(' · ')}{preview.vehicle.vin ? ` · VIN ${preview.vehicle.vin}` : ''}</p>}{mismatch && <p className="catalog-import-error">La matrícula no coincide. No se puede guardar esta importación.</p>}{!preview.plate && <label className="catalog-confirm-plate"><input type="checkbox" checked={confirmedBlankPlate} onChange={(event) => setConfirmedBlankPlate(event.target.checked)} /> Confirmo que la exportación corresponde a la matrícula {orderPlate || 'de esta orden'}.</label>}{!!count.parts && <><h4>Piezas</h4><Table headers={['Artículo','Descripción','Cant.','Proveedor','Coste','Precio','Desc.','']} rows={preview.parts.map((item, index) => [<input value={item.articleNumber} onChange={(e) => updatePreview('parts', index, 'articleNumber', e.target.value)} />, <input value={item.description} onChange={(e) => updatePreview('parts', index, 'description', e.target.value)} />, <input type="number" min="0.001" step="0.001" value={item.quantity ?? ''} onChange={(e) => updatePreview('parts', index, 'quantity', e.target.value)} />, <input value={item.supplier} onChange={(e) => updatePreview('parts', index, 'supplier', e.target.value)} />, <input type="number" min="0" step="0.01" value={item.cost ?? ''} onChange={(e) => updatePreview('parts', index, 'cost', e.target.value)} />, <input type="number" min="0" step="0.01" value={item.price ?? ''} onChange={(e) => updatePreview('parts', index, 'price', e.target.value)} />, <input type="number" min="0" max="100" step="0.01" value={item.discount ?? ''} onChange={(e) => updatePreview('parts', index, 'discount', e.target.value)} />, <button type="button" className="catalog-remove-line" onClick={() => removePreview('parts', index)}>Quitar</button>])}/></>}{!!count.labor && <><h4>Trabajo</h4><Table headers={['Código','Descripción','Horas estimadas','Precio/h','']} rows={preview.laborItems.map((item, index) => [<input value={item.code} onChange={(e) => updatePreview('laborItems', index, 'code', e.target.value)} />, <input value={item.description} onChange={(e) => updatePreview('laborItems', index, 'description', e.target.value)} />, <input type="number" min="0" step="0.25" value={item.hours ?? ''} onChange={(e) => updatePreview('laborItems', index, 'hours', e.target.value)} />, <input type="number" min="0" step="0.01" value={item.hourlyRate ?? ''} onChange={(e) => updatePreview('laborItems', index, 'hourlyRate', e.target.value)} />, <button type="button" className="catalog-remove-line" onClick={() => removePreview('laborItems', index)}>Quitar</button>])}/></>} {!previewValid && <p className="catalog-import-error">Revisa cantidades, precios, descuentos y horas antes de importar.</p>}<button type="button" className="catalog-confirm-button" disabled={!canConfirm || busy} onClick={confirmImport}>{busy ? 'Guardando…' : 'Confirmar e importar en esta orden'}</button></div>}</section>;
}
function Table({ headers, rows }) { return <div className="catalog-table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div>; }
