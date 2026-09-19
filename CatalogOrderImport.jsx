import { useMemo, useState } from 'react';
import { importCatalogOrderItems } from './commercialRepository.js';
import './catalogOrderImport.css';

const CATALOGS = { 'AD Bildelar': 'https://katalog.adsverige.com/', BilXtra: 'https://pro.bilxtra.se/' };
const catalogUrl = (catalog, registration) => {
  const registrationNumber = plate(registration);
  if (catalog === 'BilXtra' && registrationNumber) {
    return `https://pro-api.bilxtra.se/INTERSHOP/web/WFS/Mekonomen-BilxtraB2BSE-Site/sv_SE/-/SEK/ViewCarOverview-Start?country=SE&registrationNumber=${encodeURIComponent(registrationNumber)}`;
  }
  return CATALOGS[catalog];
};
const numeric = (value) => { if (value === null || value === undefined || value === '') return null; const number = Number(String(value).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(number) ? number : null; };
const plate = (value) => String(value || '').replace(/\s/g, '').toUpperCase();
const amount = (value) => value === null || value === undefined ? '—' : new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
function normalizedSource(value) { const text = String(value || '').toLowerCase(); return text.includes('bilxtra') ? 'BilXtra' : (text.includes('ad bildelar') || text === 'ad' ? 'AD Bildelar' : null); }
function parsePayload(raw, expectedSource) {
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('El contenido debe ser un objeto JSON exportado del catálogo.');
  const foundSource = normalizedSource(payload.source);
  if (foundSource && foundSource !== expectedSource) throw new Error(`La exportación corresponde a ${foundSource}; selecciona el mismo catálogo.`);
  const parts = (Array.isArray(payload.parts) ? payload.parts : []).map((item) => ({ articleNumber: String(item.articleNumber ?? item.partNumber ?? item.number ?? item.code ?? '').trim(), description: String(item.description ?? item.name ?? item.title ?? '').trim(), quantity: numeric(item.qty ?? item.quantity ?? item.amount), cost: numeric(item.cost ?? item.purchasePrice), price: numeric(item.price ?? item.salePrice ?? item.unitPrice), discount: numeric(item.discount ?? item.discountPercent), supplier: String(item.supplier ?? expectedSource).trim() || expectedSource })).filter((item) => item.description || item.articleNumber);
  const rawLabor = Array.isArray(payload.laborItems) ? payload.laborItems : (Array.isArray(payload.labor) ? payload.labor : []);
  const laborItems = rawLabor.map((item) => ({ code: String(item.code ?? item.articleNumber ?? '').trim(), description: String(item.description ?? item.name ?? item.title ?? '').trim(), hours: numeric(item.hours ?? item.laborHours ?? item.quantity), hourlyRate: numeric(item.hourlyRate ?? item.unitPrice ?? item.rate) })).filter((item) => item.description);
  if (!parts.length && !laborItems.length) throw new Error('La exportación no contiene piezas ni trabajos reconocibles.');
  if (parts.some((item) => !item.description || !item.quantity || item.quantity <= 0)) throw new Error('Cada pieza necesita descripción y cantidad mayor que cero.');
  if (laborItems.some((item) => item.hours === null || item.hours < 0)) throw new Error('Cada trabajo necesita horas estimadas válidas.');
  return { plate: String(payload.plate ?? payload.registrationNumber ?? '').trim(), parts, laborItems };
}

export default function CatalogOrderImport({ order, onSaved }) {
  const [source, setSource] = useState('AD Bildelar'); const [raw, setRaw] = useState(''); const [preview, setPreview] = useState(null); const [message, setMessage] = useState(''); const [confirmedBlankPlate, setConfirmedBlankPlate] = useState(false); const [busy, setBusy] = useState(false);
  const orderPlate = order.plate || ''; const matchingPlate = preview?.plate && plate(preview.plate) === plate(orderPlate); const mismatch = preview?.plate && !matchingPlate; const canConfirm = preview && !mismatch && (matchingPlate || confirmedBlankPlate); const count = useMemo(() => ({ parts: preview?.parts.length || 0, labor: preview?.laborItems.length || 0 }), [preview]);
  const openCatalog = async (catalog) => {
    const normalizedPlate = plate(orderPlate);
    if (!normalizedPlate) { setMessage('Esta orden no tiene matrícula.'); return; }
    try { await navigator.clipboard?.writeText(normalizedPlate); } catch { /* convenience only */ }
    window.open(catalogUrl(catalog, normalizedPlate), `BILDIAGNOS_${catalog === 'BilXtra' ? 'BILXTRA' : 'AD'}_${normalizedPlate}`);
    setSource(catalog);
    setMessage(catalog === 'BilXtra'
      ? `BilXtra abierto directamente con la matrícula ${normalizedPlate}.`
      : `AD Bildelar abierto. Matrícula ${normalizedPlate} lista en el portapapeles.`);
  };
  const readCatalogClipboard = async () => {
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
  const confirmImport = async () => { if (!canConfirm || !order.relationalId) return; setBusy(true); try { const result = await importCatalogOrderItems({ workOrderId: order.relationalId, source, plate: preview.plate || orderPlate, parts: preview.parts, laborItems: preview.laborItems }); setMessage(`Importación confirmada: ${result.parts_imported || 0} piezas y ${result.services_imported || 0} trabajos.`); setRaw(''); setPreview(null); setConfirmedBlankPlate(false); await onSaved?.(); } catch (error) { setMessage(error.message || 'No se pudo guardar la importación.'); } finally { setBusy(false); } };
  if (!order.relationalId) return null;
  return <section className="catalog-import"><header><div><p>Catálogos externos</p><h2>Importar piezas y trabajo</h2></div><span>Orden · {orderPlate || 'sin matrícula'}</span></header><p className="catalog-import-note">Los catálogos se abren fuera de Bildiagnos. No se hacen pedidos ni se guardan credenciales.</p><div className="catalog-import-actions">{Object.keys(CATALOGS).map((catalog) => <button type="button" key={catalog} className="catalog-open" onClick={() => openCatalog(catalog)}>Abrir {catalog}</button>)}<label>Importar desde<select value={source} onChange={(event) => { setSource(event.target.value); setPreview(null); }}><option>AD Bildelar</option><option>BilXtra</option></select></label></div><div className="catalog-return"><p>Cuando termines de seleccionar en el catálogo, usa su opción de copiar a Bildiagnos y vuelve aquí.</p><button type="button" className="catalog-preview-button" onClick={readCatalogClipboard}>Recibir selección del catálogo</button></div>{message && <p className={message.startsWith('No se pudo') || message.includes('necesita') || message.includes('corresponde') ? 'catalog-import-error' : 'catalog-import-message'}>{message}</p>}{preview && <div className="catalog-preview"><h3>Previsualización obligatoria</h3><p>Matrícula de la orden: <b>{orderPlate || '—'}</b> · Matrícula exportada: <b>{preview.plate || 'no incluida'}</b></p>{mismatch && <p className="catalog-import-error">La matrícula no coincide. No se puede guardar esta importación.</p>}{!preview.plate && <label className="catalog-confirm-plate"><input type="checkbox" checked={confirmedBlankPlate} onChange={(event) => setConfirmedBlankPlate(event.target.checked)} /> Confirmo que la exportación corresponde a la matrícula {orderPlate || 'de esta orden'}.</label>}{!!count.parts && <><h4>Piezas</h4><Table headers={['Artículo','Descripción','Cant.','Proveedor','Coste','Precio','Desc.']} rows={preview.parts.map((item) => [item.articleNumber || '—', item.description, item.quantity, item.supplier, amount(item.cost), amount(item.price), `${amount(item.discount)}%`])}/></>}{!!count.labor && <><h4>Trabajo</h4><Table headers={['Código','Descripción','Horas estimadas','Precio/h']} rows={preview.laborItems.map((item) => [item.code || '—', item.description, item.hours, amount(item.hourlyRate)])}/></>}<button type="button" className="catalog-confirm-button" disabled={!canConfirm || busy} onClick={confirmImport}>{busy ? 'Guardando…' : 'Confirmar e importar en esta orden'}</button></div>}</section>;
}
function Table({ headers, rows }) { return <div className="catalog-table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div>; }
