(() => {
  const VERSION = '0.4.0';
  const params = new URLSearchParams(location.search);
  const wantedPlate = (params.get('bildiagnosReg') || '').replace(/\s+/g, '').toUpperCase();
  const clickPath = (params.get('bdClick') || '').split('>').map(s => s.trim()).filter(Boolean);
  const searchText = (params.get('bdSearch') || '').trim();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function status(message, ok = true) {
    let node = document.getElementById('bildiagnos-ad-helper-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'bildiagnos-ad-helper-status';
      node.setAttribute('role', 'status');
      Object.assign(node.style, {
        position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647',
        padding: '8px 11px', borderRadius: '7px', font: '12px/1.35 Arial,sans-serif',
        boxShadow: '0 2px 8px rgba(0,0,0,.25)', maxWidth: '360px'
      });
      document.documentElement.appendChild(node);
    }
    node.style.background = ok ? '#153d23' : '#6b1d1d';
    node.style.color = '#fff';
    node.textContent = `Bildiagnos AD Helper v${VERSION}: ${message}`;
  }

  function textCandidates(el) {
    const vals = [
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('alt'),
      el.getAttribute?.('data-tooltip'),
      el.getAttribute?.('placeholder')
    ];
    const svg = el.querySelector?.('title');
    if (svg) vals.push(svg.textContent);
    return vals.filter(Boolean).map(norm);
  }

  function actionable(el) {
    if (!el) return null;
    return el.closest?.('button,a,[role="button"],[onclick],[tabindex],li,div') || el;
  }

  function findByText(label) {
    const target = norm(label);
    if (!target) return null;
    const all = Array.from(document.querySelectorAll('button,a,[role="button"],[aria-label],[title],svg,g,li,span,div,p'));
    let best = null;
    let bestScore = -1;
    for (const el of all) {
      const vals = textCandidates(el);
      for (const v of vals) {
        let score = -1;
        if (v === target) score = 100;
        else if (v.startsWith(target) || target.startsWith(v)) score = 70;
        else if (v.includes(target)) score = 50;
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
    }
    return best;
  }

  function realClick(el) {
    const target = actionable(el);
    if (!target) return false;
    try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      try { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch {}
    }
    try { target.click(); } catch {}
    return true;
  }

  async function clickNamed(label) {
    for (let i = 0; i < 40; i++) {
      const found = findByText(label);
      if (found && realClick(found)) return true;
      await sleep(250);
    }
    return false;
  }

  function setNativeValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findGlobalSearch() {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.find(i => /sok regnr|chassinr|artiklar|search/i.test(norm(i.placeholder) + ' ' + norm(i.getAttribute('aria-label')))) || inputs[0] || null;
  }

  function findVehicleSearch() {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.find(i => /sok i vald bil/i.test(norm(i.placeholder) + ' ' + norm(i.getAttribute('aria-label')))) || null;
  }

  async function ensurePlate(plate) {
    if (!plate) return true;
    for (let i = 0; i < 24; i++) {
      if (norm(document.body.innerText).includes(norm(plate))) return true;
      await sleep(250);
    }

    const input = findGlobalSearch();
    if (!input) return false;
    input.focus();
    setNativeValue(input, plate);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    await sleep(1200);

    if (norm(document.body.innerText).includes(norm(plate))) return true;

    const result = findByText(plate);
    if (result) {
      realClick(result);
      await sleep(1000);
    }
    return norm(document.body.innerText).includes(norm(plate));
  }

  async function runClickPath(parts) {
    for (const part of parts) {
      status(`abriendo "${part}"...`);
      const ok = await clickNamed(part);
      if (!ok) {
        status(`no encontre "${part}".`, false);
        return false;
      }
      await sleep(900);
    }
    return true;
  }

  async function runSearch(value) {
    if (!value) return true;
    const input = findVehicleSearch() || findGlobalSearch();
    if (!input) return false;
    input.focus();
    setNativeValue(input, value);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    await sleep(900);
    return true;
  }

  async function main() {
    status('iniciando...');
    const plateOk = await ensurePlate(wantedPlate);
    if (!plateOk) {
      status(`no pude seleccionar ${wantedPlate}.`, false);
      return;
    }
    if (clickPath.length) {
      const ok = await runClickPath(clickPath);
      if (!ok) return;
    }
    if (searchText) {
      const ok = await runSearch(searchText);
      if (!ok) {
        status(`no encontre un buscador para "${searchText}".`, false);
        return;
      }
    }
    status(`listo${wantedPlate ? ` - ${wantedPlate}` : ''}.`);
  }

  main().catch(error => status(error?.message || 'error inesperado', false));
})();
