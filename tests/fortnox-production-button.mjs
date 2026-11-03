// Runs the component handlers with mocked hooks, UI and Supabase; no network calls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transformSync } from 'rolldown/utils';

const original = fs.readFileSync(new URL('../FortnoxProductionInvoice.jsx', import.meta.url), 'utf8');
const transformed = transformSync('FortnoxProductionInvoice.jsx', original, { jsx: { runtime: 'classic' } });
assert.equal(transformed.errors.length, 0);
const code = transformed.code.replace(/^import .*;\n/gm, '').replace('export default function', 'function') + '\nglobalThis.Component = FortnoxProductionInvoice;';
const validPreview = { reference: 'BOS-700200', orderNumber: 700200, customerName: 'ROX INTERNATIONAL AB', total: 5565, vat: 1113, rows: [{ description: 'Labor', quantity: 3, unitPrice: 1000 }, { description: 'Springs', quantity: 2, unitPrice: 726 }] };
const props = { orderId: 'd678b517-6a3c-4cab-8d55-afc92060afab', expectedTotal: 5565, blocked: false };

function setup({ confirm = true, existing = null, initialPreview = validPreview, createError = false } = {}) {
  const slots = [], calls = [], confirmations = [];
  let cursor = 0, effects = [], tree;
  const api = { job: existing, preview: initialPreview };
  const sandbox = {
    React: { createElement: (type, attributes, ...children) => ({ type, attributes: attributes || {}, children }) },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index][i])) { slots[index] = deps; effects.push(effect); } },
    window: { confirm(message) { confirmations.push(message); return confirm; } },
    supabase: { functions: { async invoke(name, { body }) {
      assert.equal(name, 'fortnox-production-invoice'); calls.push(body);
      if (body.action === 'status') return { data: { ok: true, job: api.job } };
      if (body.action === 'preview') return { data: { ok: true, preview: api.preview } };
      if (body.action === 'create') {
        assert.equal(body.confirmTotal, 5565); assert.equal(body.confirmReference, 'BOS-700200');
        if (createError) return { error: new Error('Uncertain network response') };
        api.job = { status: 'submitted', documentNumber: 'MOCK-300081', ocr: 'MOCK-OCR' };
        return { data: { ok: true, documentNumber: api.job.documentNumber, ocr: api.job.ocr, sent: false } };
      }
      throw new Error('Unexpected operation: ' + body.action);
    } } },
  };
  vm.runInNewContext(code, sandbox);
  function render() { cursor = 0; tree = sandbox.Component(props); const pending = effects; effects = []; pending.forEach(effect => effect()); return tree; }
  async function flush() { await new Promise(resolve => setImmediate(resolve)); render(); }
  function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.children)]; }
  function text(value) { if (Array.isArray(value)) return value.map(text).join(' '); return value && typeof value === 'object' ? text(value.children) : String(value ?? ''); }
  const button = label => nodes(tree).find(node => node.type === 'button' && text(node.children) === label);
  render();
  return { api, calls, confirmations, flush, button, text: () => text(tree) };
}
let checks = 0;
let ui = setup(); await ui.flush(); assert.deepEqual(ui.calls.map(x => x.action), ['status', 'preview']); assert.equal(ui.confirmations.length, 0); assert.ok(ui.button('Skapa faktura i Fortnox')); checks++;
let first = ui.button('Skapa faktura i Fortnox').attributes.onClick(); let second = ui.button('Skapa faktura i Fortnox').attributes.onClick(); await Promise.all([first, second]); await ui.flush(); assert.equal(ui.confirmations.length, 1); assert.match(ui.confirmations[0], /REAL/); assert.match(ui.confirmations[0], /BOS-700200/); assert.equal(ui.calls.filter(x => x.action === 'create').length, 1); assert.match(ui.text(), /MOCK-300081/); assert.match(ui.text(), /MOCK-OCR/); assert.equal(ui.button('Skapa faktura i Fortnox'), undefined); assert.equal(ui.calls.some(x => ['send', 'bookkeep'].includes(x.action)), false); checks++;
ui = setup({ confirm: false }); await ui.flush(); await ui.button('Skapa faktura i Fortnox').attributes.onClick(); await ui.flush(); assert.equal(ui.calls.filter(x => x.action === 'create').length, 0); assert.ok(ui.button('Skapa faktura i Fortnox')); checks++;
for (const changed of [{ total: 79815 }, { total: NaN }, { vat: 75363 }, { reference: 'BOS-OTHER' }, { rows: [] }]) { ui = setup(); await ui.flush(); ui.api.preview = { ...validPreview, ...changed }; await ui.button('Skapa faktura i Fortnox').attributes.onClick(); await ui.flush(); assert.equal(ui.confirmations.length, 0); assert.equal(ui.calls.filter(x => x.action === 'create').length, 0); assert.equal(ui.button('Skapa faktura i Fortnox'), undefined); checks++; }
ui = setup(); await ui.flush(); ui.api.job = { status: 'submitted', documentNumber: 'EXISTING', ocr: 'EXISTING-OCR' }; await ui.button('Skapa faktura i Fortnox').attributes.onClick(); await ui.flush(); assert.equal(ui.confirmations.length, 0); assert.equal(ui.calls.filter(x => x.action === 'create').length, 0); assert.match(ui.text(), /EXISTING-OCR/); checks++;
for (const status of ['reserved', 'uncertain', 'failed']) { ui = setup({ existing: { status } }); await ui.flush(); assert.equal(ui.button('Skapa faktura i Fortnox'), undefined); assert.equal(ui.calls.length, 1); checks++; }
ui = setup({ createError: true }); await ui.flush(); await ui.button('Skapa faktura i Fortnox').attributes.onClick(); await ui.flush(); assert.equal(ui.button('Skapa faktura i Fortnox'), undefined); assert.match(ui.text(), /Consulta el estado/); assert.equal(ui.calls.filter(x => x.action === 'create').length, 1); checks++;
const flow = fs.readFileSync(new URL('../CommercialOrderFlow.jsx', import.meta.url), 'utf8'); assert.ok(flow.includes('Skapa testfaktura i Fortnox Test')); assert.ok(flow.includes('Skriv ut Fortnox Test-faktura')); checks++;
console.log(`PASS ${checks} component checks: confirmation/cancel, exact amount, fresh state, duplicate/double-click blocks, uncertain outcome, number/OCR, no send/bookkeep, test invoice controls retained. All Supabase calls mocked.`);
