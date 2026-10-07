import { useMemo, useState } from 'react';
import { confirmSupplierDeliveryNote, loadSupplierDeliveryNotes } from './commercialRepository.js';
import { supabase } from './supabaseClient.js';
import './deliveryNoteReader.css';

const emptyNote = {
  supplierName: '', documentNumber: '', documentDate: '', currency: 'SEK',
  subtotalExVat: '', vatTotal: '', totalIncVat: '', lines: [],
};

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');
const num = (value) => value === '' || value == null ? '' : Number(value);

async function imageForVision(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo preparar la imagen.'));
      img.src = url;
    });
    const maxSide = 1100;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('No se pudo preparar la imagen.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.68);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function autoMatch(lines, orderParts) {
  return lines.map((line) => {
    const lineNumber = normalize(line.supplierPartNumber);
    const lineDescription = normalize(line.description);
    const exact = lineNumber
      ? orderParts.find((part) => normalize(part.part_number_snapshot) === lineNumber)
      : null;
    const descriptionMatch = !exact && lineDescription.length >= 6
      ? orderParts.find((part) => {
          const candidate = normalize(part.description_snapshot);
          return candidate && (candidate.includes(lineDescription) || lineDescription.includes(candidate));
        })
      : null;
    const matched = exact || descriptionMatch || null;
    return {
      ...line,
      workOrderPartId: matched?.id || '',
      manualMatch: false,
    };
  });
}

export default function DeliveryNoteReader({ orderId, parts = [], onSaved }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [note, setNote] = useState(emptyNote);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotes, setSavedNotes] = useState([]);

  const activeParts = useMemo(
    () => parts.filter((part) => !['rejected', 'removed'].includes(part.status)),
    [parts]
  );

  const chooseFile = async (event) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      setMessage('Por ahora usa una foto o captura del följesedel.');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setNote(emptyNote);
    setReading(true);
    setMessage('Leyendo följesedel con IA…');
    try {
      const imageDataUrl = await imageForVision(selected);
      const { data, error } = await supabase.functions.invoke('delivery-note-reader', {
        body: { imageDataUrl },
      });
      if (error) throw error;
      const detected = data?.deliveryNote;
      if (!detected) throw new Error('No se recibieron datos del följesedel.');
      const lines = autoMatch(Array.isArray(detected.lines) ? detected.lines : [], activeParts);
      setNote({
        supplierName: detected.supplierName || '',
        documentNumber: detected.documentNumber || '',
        documentDate: detected.documentDate || '',
        currency: detected.currency || 'SEK',
        subtotalExVat: detected.subtotalExVat ?? '',
        vatTotal: detected.vatTotal ?? '',
        totalIncVat: detected.totalIncVat ?? '',
        lines,
      });
      setMessage(lines.length
        ? 'Följesedel leído. Revisa cada línea y confirma el emparejamiento antes de guardar.'
        : 'No se encontraron líneas de piezas. Prueba una foto más cercana.');
    } catch (error) {
      setMessage(error?.message || 'No se pudo leer el följesedel.');
    } finally {
      setReading(false);
      event.target.value = '';
    }
  };

  const updateLine = (index, field, value) => {
    setNote((current) => ({
      ...current,
      lines: current.lines.map((line, i) => i === index ? { ...line, [field]: value } : line),
    }));
  };

  const confirm = async () => {
    if (!note.lines.length || saving) return;
    const unmatched = note.lines.filter((line) => !line.workOrderPartId);
    if (unmatched.length && !window.confirm(
      `${unmatched.length} línea(s) no están emparejadas con una pieza de esta orden. Se guardarán como no emparejadas y NO cambiarán costes. ¿Continuar?`
    )) return;
    setSaving(true);
    setMessage('Guardando följesedel y costes confirmados…');
    try {
      await confirmSupplierDeliveryNote(orderId, note, note.lines, file);
      const saved = await loadSupplierDeliveryNotes(orderId);
      setSavedNotes(saved);
      setMessage('Följesedel confirmado. Los costes reales se actualizaron solo en las piezas emparejadas.');
      await onSaved?.();
    } catch (error) {
      setMessage(error?.message || 'No se pudo guardar el följesedel.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="delivery-note-card">
    <div className="delivery-note-heading">
      <div><small>Coste real de piezas</small><h3>📄 Följesedel</h3></div>
      <span>BilXtra / AD Bildelar</span>
    </div>
    <p className="delivery-note-help">Sube una foto. Bildiagnos la lee y propone costes/descuentos. Nada cambia hasta que pulses <b>Confirmar följesedel y costes</b>.</p>
    <label className="delivery-note-file">
      {reading ? 'Leyendo…' : 'Elegir foto del följesedel'}
      <input type="file" accept="image/*" disabled={reading || saving} onChange={chooseFile} />
    </label>

    {previewUrl && <img className="delivery-note-image" src={previewUrl} alt="Följesedel" />}

    {!!note.lines.length && <div className="delivery-note-preview">
      <div className="delivery-note-meta">
        <label>Proveedor<input value={note.supplierName} onChange={(e) => setNote({ ...note, supplierName: e.target.value })} /></label>
        <label>Nº documento<input value={note.documentNumber} onChange={(e) => setNote({ ...note, documentNumber: e.target.value })} /></label>
        <label>Fecha<input type="date" value={note.documentDate} onChange={(e) => setNote({ ...note, documentDate: e.target.value })} /></label>
        <label>Subtotal exkl. moms<input type="number" step="0.01" value={note.subtotalExVat} onChange={(e) => setNote({ ...note, subtotalExVat: e.target.value })} /></label>
      </div>

      <div className="delivery-note-lines">
        {note.lines.map((line, index) => <div className="delivery-note-line" key={index}>
          <div className="delivery-note-line-title">
            <b>{line.supplierPartNumber || 'Sin artículo'}</b>
            <span>{line.description || 'Sin descripción'}</span>
          </div>
          <div className="delivery-note-line-grid">
            <label>Cant.<input type="number" min="0.001" step="0.001" value={line.quantity ?? 1} onChange={(e) => updateLine(index, 'quantity', e.target.value)} /></label>
            <label>Precio lista<input type="number" min="0" step="0.01" value={line.listUnitPriceExVat ?? ''} onChange={(e) => updateLine(index, 'listUnitPriceExVat', e.target.value)} /></label>
            <label>Rabatt %<input type="number" min="0" max="100" step="0.01" value={line.discountPercent ?? ''} onChange={(e) => updateLine(index, 'discountPercent', e.target.value)} /></label>
            <label>Coste neto/st<input type="number" min="0" step="0.01" value={line.netUnitCostExVat ?? ''} onChange={(e) => updateLine(index, 'netUnitCostExVat', e.target.value)} /></label>
          </div>
          <label className="delivery-note-match">Pieza de esta orden
            <select value={line.workOrderPartId || ''} onChange={(e) => updateLine(index, 'workOrderPartId', e.target.value)}>
              <option value="">— Sin emparejar —</option>
              {activeParts.map((part) => <option key={part.id} value={part.id}>
                {[part.part_number_snapshot, part.description_snapshot].filter(Boolean).join(' · ')}
              </option>)}
            </select>
          </label>
        </div>)}
      </div>

      <button type="button" className="delivery-note-confirm" disabled={reading || saving} onClick={confirm}>
        {saving ? 'Guardando…' : 'Confirmar följesedel y costes'}
      </button>
    </div>}

    {message && <p className="delivery-note-message">{message}</p>}
    {!!savedNotes.length && <p className="delivery-note-saved">Documentos confirmados en esta orden: {savedNotes.length}</p>}
  </section>;
}
