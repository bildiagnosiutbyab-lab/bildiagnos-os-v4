const TARGET = 'https://bildiagnosiutbyab-lab.github.io/bildiagnos-os-v4/mobile-catalog-preview/';

function importer() {
  const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const number = (value) => {
    const text = clean(value).replace(/kr|tim|st|perioder|\/tim/gi, '').replace(/\s/g, '');
    if (!text) return null;
    let normalized = text;
    if (/^\d+:\d{2}$/.test(normalized)) normalized = normalized.replace(':', '.');
    else if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const rows = [...document.querySelectorAll('tr,[role="row"]')];
  const payload = { source: '', plate: '', parts: [], laborItems: [] };
  const seen = new Set();
  const host = location.hostname.toLowerCase();

  if (host.includes('bilxtra')) {
    payload.source = 'BilXtra';
    const plateInput = [...document.querySelectorAll('input')].find((input) => /^[A-Z0-9]{5,8}$/i.test(clean(input.value)));
    payload.plate = clean(plateInput?.value).replace(/\s/g, '').toUpperCase();

    for (const row of rows) {
      const cells = [...row.querySelectorAll('td,[role="cell"]')].map((cell) => clean(cell.innerText || cell.textContent)).filter(Boolean);
      const joined = cells.join(' | ');
      const article = joined.match(/Artikelnummer\s+([A-Z0-9._/-]+)/i)?.[1];
      if (!article) continue;

      const description = clean((cells.find((cell) => /Artikelnummer/i.test(cell)) || '').replace(/Artikelnummer\s+[A-Z0-9._/-]+/i, ''));
      const laborCell = cells.find((cell) => /\d+(?:[,.]\d+)?\s*tim/i.test(cell));
      if (laborCell) {
        const hours = number(laborCell.match(/\d+(?:[,.]\d+)?\s*tim/i)?.[0]);
        const rateCell = cells.find((cell) => /\/tim/i.test(cell));
        const rate = number(rateCell);
        if (description && hours > 0) {
          const key = ['labor', article, description, hours].join('|').toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            payload.laborItems.push({ code: article, description, hours, hourlyRate: rate });
          }
        }
        continue;
      }

      const qtyCell = cells.find((cell) => /\b\d+(?:[,.]\d+)?\s*st\b/i.test(cell));
      const quantity = number(qtyCell?.match(/\d+(?:[,.]\d+)?\s*st/i)?.[0]) || 1;
      const priceCell = cells.find((cell) => /\d+[:.,]\d{2}/.test(cell) && !/listpris/i.test(cell))
        || cells.find((cell) => /\d+[:.,]\d{2}/.test(cell));
      const priceMatch = priceCell?.match(/\d+(?:[ .]\d{3})*[:.,]\d{2}/)?.[0];
      const price = number(priceMatch);
      if (description && price !== null) {
        const key = ['part', article, description, quantity, price].join('|').toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          payload.parts.push({ articleNumber: article, description, quantity, supplier: 'BilXtra', cost: null, price, discount: null });
        }
      }
    }
  } else if (host.includes('adsverige.com')) {
    payload.source = 'AD Bildelar';
    const pageText = clean(document.body.innerText);
    payload.plate = pageText.match(/Reg\s*nr\s*:\s*([A-Z0-9]{5,8})/i)?.[1]?.toUpperCase()
      || new URLSearchParams(location.search).get('bildiagnosReg')?.toUpperCase()
      || '';

    for (const row of rows) {
      const cells = [...row.querySelectorAll('td,[role="cell"]')].map((cell) => clean(cell.innerText || cell.textContent)).filter(Boolean);
      if (!cells.length) continue;
      const joined = cells.join(' | ');
      const period = joined.match(/(\d+(?:[,.]\d+)?)\s*perioder/i);
      if (period) {
        const code = clean(cells[0]);
        const description = clean(cells[1]);
        const hours = number(period[1]) / 100;
        if (description && hours > 0) {
          const key = ['labor', code, description, hours].join('|').toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            payload.laborItems.push({ code, description, hours, hourlyRate: null });
          }
        }
        continue;
      }

      const regCell = cells.find((cell) => /Regnr\s*:/i.test(cell));
      if (!regCell) continue;
      const article = clean(cells[0]).replace(/^[^A-Z0-9]+/i, '').split(' ').pop();
      const description = clean(cells[1]);
      const quantity = number(cells.find((cell) => /^\d+(?:[,.]\d+)?$/.test(cell))) || 1;
      const priceCandidate = [...cells].reverse().find((cell) => /\d+[,.]\d{2}/.test(cell));
      const price = number(priceCandidate?.match(/\d+(?:[ .]\d{3})*[,.]\d{2}/)?.[0]);
      const rowPlate = regCell.match(/Regnr\s*:\s*([A-Z0-9]{5,8})/i)?.[1]?.toUpperCase();
      if (rowPlate) payload.plate = rowPlate;
      if (article && description && price !== null) {
        const key = ['part', article, description, quantity, price].join('|').toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          payload.parts.push({ articleNumber: article, description, quantity, supplier: 'AD Bildelar', cost: null, price, discount: null });
        }
      }
    }
  } else {
    alert('Abre BilXtra o AD Bildelar antes de usar Importar a Bildiagnos.');
    return;
  }

  if (!payload.parts.length && !payload.laborItems.length) {
    alert('No pude leer la cesta. Abre la vista donde se ven las piezas y el trabajo y vuelve a pulsar Importar a Bildiagnos.');
    return;
  }

  const encoded = encodeURIComponent(JSON.stringify(payload));
  location.href = TARGET + '#catalogTransfer=' + encoded;
}

export const MOBILE_CATALOG_BOOKMARKLET = 'javascript:(' + importer.toString() + ')()';
