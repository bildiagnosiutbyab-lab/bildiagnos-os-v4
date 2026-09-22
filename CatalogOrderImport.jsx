import { useEffect, useMemo, useState } from 'react';
import { importCatalogOrderItems } from './commercialRepository.js';
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
  return { plate: String(payload.plate ?? payload.registrationNumber ?? '').trim(), parts, laborItems };
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
  const [source, setSource] = useState('AD Bildelar'); const [raw, setRaw] = useState(''); const [preview, setPreview] = useState(null); const [message, setMessage] = useState(''); const [confirmedBlankPlate, setConfirmedBlankPlate] = useState(false); const [busy, setBusy] = useState(false);
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
  const confirmImport = async () => { if (!order.relationalId) return; setBusy(true); try { validatePreview(preview); if (!canConfirm) throw new Error('Confirma que la matrícula corresponde a esta orden.'); const result = await importCatalogOrderItems({ workOrderId: order.relationalId, source, plate: preview.plate || orderPlate, parts: preview.parts, laborItems: preview.laborItems }); if (source === 'AD Bildelar') window.dispatchEvent(new Event('BILDIAGNOS_CATALOG_TRANSFER_CONSUMED')); setMessage(`Importación confirmada: ${result.parts_imported || 0} piezas y ${result.services_imported || 0} trabajos.`); setRaw(''); setPreview(null); setConfirmedBlankPlate(false); await onSaved?.(); } catch (error) { setMessage(error.message || 'No se pudo guardar la importación.'); } finally { setBusy(false); } };
  if (!order.relationalId) return null;
  return <section className="catalog-import"><header><div><p>Catálogos externos</p><h2>Importar piezas y trabajo</h2></div><span>Orden · {orderPlate || 'sin matrícula'}</span></header><p className="catalog-import-note">Los catálogos se abren fuera de Bildiagnos. No se hacen pedidos ni se guardan credenciales.</p><div className="catalog-import-actions">{Object.keys(CATALOGS).map((catalog) => <button type="button" key={catalog} className="catalog-open" onClick={() => openCatalog(catalog)}>Abrir {catalog}</button>)}<label>Importar desde<select value={source} onChange={(event) => { setSource(event.target.value); setPreview(null); }}><option>AD Bildelar</option><option>BilXtra</option><option>ZEPRO</option></select></label></div><div className="catalog-return"><p>{source === 'AD Bildelar' ? 'En AD marca las piezas y pulsa Enviar selección a Bildiagnos. Después vuelve a esta orden.' : 'Cuando termines de seleccionar en el catálogo, usa su opción de copiar a Bildiagnos y vuelve aquí.'}</p><button type="button" className="catalog-preview-button" onClick={receiveCatalogSelection}>Recibir selección del catálogo</button></div>{message && <p className={message.startsWith('No se') || message.includes('necesita') || message.includes('corresponde') ? 'catalog-import-error' : 'catalog-import-message'}>{message}</p>}{preview && <div className="catalog-preview"><h3>Previsualización obligatoria</h3><p>Puedes corregir o quitar líneas antes de guardar. Matrícula de la orden: <b>{orderPlate || '—'}</b> · Matrícula exportada: <b>{preview.plate || 'no incluida'}</b></p>{mismatch && <p className="catalog-import-error">La matrícula no coincide. No se puede guardar esta importación.</p>}{!preview.plate && <label className="catalog-confirm-plate"><input type="checkbox" checked={confirmedBlankPlate} onChange={(event) => setConfirmedBlankPlate(event.target.checked)} /> Confirmo que la exportación corresponde a la matrícula {orderPlate || 'de esta orden'}.</label>}{!!count.parts && <><h4>Piezas</h4><Table headers={['Artículo','Descripción','Cant.','Proveedor','Coste','Precio','Desc.','']} rows={preview.parts.map((item, index) => [<input value={item.articleNumber} onChange={(e) => updatePreview('parts', index, 'articleNumber', e.target.value)} />, <input value={item.description} onChange={(e) => updatePreview('parts', index, 'description', e.target.value)} />, <input type="number" min="0.001" step="0.001" value={item.quantity ?? ''} onChange={(e) => updatePreview('parts', index, 'quantity', e.target.value)} />, <input value={item.supplier} onChange={(e) => updatePreview('parts', index, 'supplier', e.target.value)} />, <input type="number" min="0" step="0.01" value={item.cost ?? ''} onChange={(e) => updatePreview('parts', index, 'cost', e.target.value)} />, <input type="number" min="0" step="0.01" value={item.price ?? ''} onChange={(e) => updatePreview('parts', index, 'price', e.target.value)} />, <input type="number" min="0" max="100" step="0.01" value={item.discount ?? ''} onChange={(e) => updatePreview('parts', index, 'discount', e.target.value)} />, <button type="button" className="catalog-remove-line" onClick={() => removePreview('parts', index)}>Quitar</button>])}/></>}{!!count.labor && <><h4>Trabajo</h4><Table headers={['Código','Descripción','Horas estimadas','Precio/h','']} rows={preview.laborItems.map((item, index) => [<input value={item.code} onChange={(e) => updatePreview('laborItems', index, 'code', e.target.value)} />, <input value={item.description} onChange={(e) => updatePreview('laborItems', index, 'description', e.target.value)} />, <input type="number" min="0" step="0.25" value={item.hours ?? ''} onChange={(e) => updatePreview('laborItems', index, 'hours', e.target.value)} />, <input type="number" min="0" step="0.01" value={item.hourlyRate ?? ''} onChange={(e) => updatePreview('laborItems', index, 'hourlyRate', e.target.value)} />, <button type="button" className="catalog-remove-line" onClick={() => removePreview('laborItems', index)}>Quitar</button>])}/></>} {!previewValid && <p className="catalog-import-error">Revisa cantidades, precios, descuentos y horas antes de importar.</p>}<button type="button" className="catalog-confirm-button" disabled={!canConfirm || busy} onClick={confirmImport}>{busy ? 'Guardando…' : 'Confirmar e importar en esta orden'}</button></div>}</section>;
}
function Table({ headers, rows }) { return <div className="catalog-table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div>; }
