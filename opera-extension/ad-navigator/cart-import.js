(() => {
  const KEY = 'bildiagnosCatalogTransfer';
  const norm = (text) => String(text || '').replace(/\s+/g, ' ').trim();
  const number = (text) => {
    const cleaned = String(text || '').replace(/[^\d,.\-\s]/g, '').replace(/\s/g, '');
    if (!cleaned) return null;
    const decimal = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
    const value = Number(decimal);
    return Number.isFinite(value) ? value : null;
  };
  const rowText = (row) => norm(row.innerText || row.textContent);
  const plateIn = (text) => text.match(/\bReg\s*nr\s*:\s*([A-Z]{3}\s?\d{3}|[A-Z0-9]{5,8})/i)?.[1]?.replace(/\s/g, '').toUpperCase() || '';
  const articleIn = (text) => text.match(/(?:^|\s)([A-Z0-9]*\d+[A-Z0-9._/-]{3,})\b/i)?.[1] || '';
  const periodHours = (text) => {
    const period = text.match(/(\d+(?:[,.]\d+)?)\s*perioder\b/i);
    if (period) return number(period[1]) / 100; // AD: 55 perioder = 0 h 33 m.
    const clock = text.match(/\b(\d+)\s*h\s*(?:och\s*)?(\d+)\s*m\b/i);
    if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
    return null;
  };

  function findCart() {
    const candidates = [...document.querySelectorAll('button,a,input,[role="button"]')];
    const quote = candidates.find((el) => /Skriv ut kostnadsförslag/i.test(norm(el.innerText || el.value || el.textContent)));
    if (!quote) return null;
    let root = quote.parentElement;
    for (let i = 0; root && i < 9; i++, root = root.parentElement) {
      const text = rowText(root);
      if (/Reparationstider/i.test(text) && /Reg\s*nr\s*:/i.test(text) && text.length < 20000) return root;
    }
    return null;
  }

  function rowsIn(root) {
    const rows = [...root.querySelectorAll('tr,[role="row"]')].filter((row) => {
      const parentRow = row.parentElement?.closest('tr,[role="row"]');
      return !parentRow || !root.contains(parentRow);
    });
    const candidates = [...root.querySelectorAll('li,div')].filter((el) => {
      const text = rowText(el);
      return text.length < 300 && articleIn(text) && (plateIn(text) || /\bperioder\b/i.test(text));
    });
    const fallback = candidates.filter((el) => !el.closest('tr,[role="row"]') &&
      !candidates.some((other) => other !== el && el.contains(other)));
    return [...rows, ...fallback];
  }

  function parseCart(root) {
    const parts = [], laborItems = [];
    const seenParts = new Set(), seenLabor = new Set();
    let rowPlate = '';
    for (const row of rowsIn(root)) {
      const text = rowText(row);
      const articleNumber = articleIn(text);
      if (!articleNumber) continue;
      const vehiclePlate = plateIn(text);
      if (vehiclePlate) {
        const cells = [...row.querySelectorAll('td,[role="cell"]')].map(rowText).filter(Boolean);
        const priceMatch = text.match(/((?:\d{1,3}(?:[ \u00a0.]\d{3})+|\d+)[,.]\d{2})(?:\s*kr)?(?:\s*[×x])?\s*$/i);
        const beforePrice = priceMatch ? text.slice(0, priceMatch.index).trim() : text;
        // AD cart columns are: article / description / marking / quantity / price.
        // Read quantity only from the explicit quantity cell immediately before
        // the price cell. Never infer it from other integers such as Typnr.
        let quantity = 1;
        let price = null;
        const pricedCellIndexes = cells
          .map((value, index) => (/\d+[,.]\d{2}/.test(value) ? index : -1))
          .filter((index) => index >= 0);
        const priceCellIndex = pricedCellIndexes.length ? pricedCellIndexes[pricedCellIndexes.length - 1] : -1;
        if (priceCellIndex >= 0) {
          price = number(cells[priceCellIndex]);
          const quantityCell = cells[priceCellIndex - 1];
          if (quantityCell && /^\d+(?:[,.]\d+)?$/.test(quantityCell)) {
            const parsedQuantity = number(quantityCell);
            if (parsedQuantity !== null && parsedQuantity > 0 && parsedQuantity <= 100) quantity = parsedQuantity;
          }
        }
        if (price === null) price = number(priceMatch?.[1]);
        const descriptionText = beforePrice;
        const description = norm(descriptionText.slice(descriptionText.indexOf(articleNumber) + articleNumber.length)
          .replace(/\bReg\s*nr\s*:\s*[A-Z0-9]+/ig, '')
          .replace(/\bTyp\s*nr\s*:\s*\d+/ig, ''));
        if (!description || price === null || quantity <= 0) continue;
        if (rowPlate && rowPlate !== vehiclePlate) throw new Error('La cesta contiene piezas de varias matrículas. Sepáralas antes de importar.');
        rowPlate = vehiclePlate;
        const key = [vehiclePlate, articleNumber, description, quantity, price].join('|').toLowerCase();
        if (seenParts.has(key)) continue; // AD puede renderizar la misma fila más de una vez.
        seenParts.add(key);
        parts.push({ articleNumber, description, quantity, supplier: 'AD Bildelar', cost: null, price, discount: null });
      } else if (/\bperioder\b/i.test(text)) {
        const hours = periodHours(text);
        const description = norm(text.slice(text.indexOf(articleNumber) + articleNumber.length)
          .replace(/\s+\d+(?:[,.]\d+)?\s*perioder\b.*$/i, ''));
        if (description && hours !== null && hours > 0) {
          const key = [articleNumber, description, hours].join('|').toLowerCase();
          if (seenLabor.has(key)) continue;
          seenLabor.add(key);
          laborItems.push({ code: articleNumber, description, hours, hourlyRate: null });
        }
      }
    }
    if (laborItems.length === 1) {
      const repairSection = rowText(root).match(/Reparationstider([\s\S]*?)(?:Orderinformation|Önskat leveransdatum|Skriv ut kostnadsförslag|$)/i)?.[1] || '';
      const laborNet = number(repairSection.match(/Netto\s*:?\s*((?:\d{1,3}(?:[ \u00a0.]\d{3})+|\d+)[,.]\d{2})/i)?.[1]);
      if (laborNet !== null && laborItems[0].hours > 0) {
        laborItems[0].hourlyRate = Math.round(laborNet / laborItems[0].hours * 100) / 100;
      }
    }
    if (!parts.length && !laborItems.length) throw new Error('No pude leer artículos de la cesta. Abre la cesta con piezas y trabajo visibles.');
    const requestedPlate = new URLSearchParams(location.search).get('bildiagnosReg')?.replace(/\s/g, '').toUpperCase();
    if (requestedPlate && rowPlate && requestedPlate !== rowPlate) throw new Error(`La cesta es de ${rowPlate}; la orden abierta era ${requestedPlate}.`);
    return { source: 'AD Bildelar', plate: rowPlate || requestedPlate || '', parts, laborItems };
  }

  function notice(button, message, error = false) {
    button.textContent = message;
    button.style.background = error ? '#991b1b' : '#0f766e';
    window.setTimeout(() => { button.textContent = 'Enviar cesta a Bildiagnos'; button.style.background = '#0f766e'; }, 6000);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Enviar cesta a Bildiagnos';
  button.title = 'Prepara las piezas y trabajos visibles; Bildiagnos mostrará una previsualización antes de guardar.';
  button.style.cssText = 'position:fixed;bottom:62px;right:12px;z-index:2147483647;padding:10px 14px;border:0;border-radius:7px;background:#0f766e;color:#fff;font:600 13px Arial,sans-serif;box-shadow:0 2px 8px #0004;cursor:pointer';
  button.addEventListener('click', () => {
    try {
      const cart = findCart();
      if (!cart) throw new Error('Abre la cesta de AD antes de enviar.');
      const payload = parseCart(cart);
      chrome.storage.local.set({ [KEY]: { payload, createdAt: new Date().toISOString(), version: 2 } }, () => {
        if (chrome.runtime.lastError) { notice(button, 'No se pudo preparar la transferencia.', true); return; }
        notice(button, `${payload.parts.length} piezas y ${payload.laborItems.length} trabajos preparados. Vuelve a Bildiagnos y pulsa Recibir.`);
      });
    } catch (error) { notice(button, error.message || 'No se pudo leer la cesta.', true); }
  });
  (document.body || document.documentElement).appendChild(button);
})();
