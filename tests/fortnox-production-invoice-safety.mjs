import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(fs.readFileSync(process.argv[2] || new URL('../supabase/functions/fortnox-production-invoice/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''));
const orderId = 'd678b517-6a3c-4cab-8d55-afc92060afab';
async function run(action, options = {}) {
  const { found = false, confirmedTotal = 5565, job = null, failSearch = false, quoteTotal = 5565, wrongPlate = false, authorized = true, role = 'owner', otherOrder = false, missingReference = false, missingTotal = false } = options;
  let handler;
  const writes = [], calls = [];
  const net = quoteTotal / 1.25;
  const fixtures = {
    workshop_members: { workshop_id: 'workshop', role },
    work_orders: { id: orderId, order_number: otherOrder ? 700202 : 700200, customer_id: 'customer', plate_snapshot: wrongPlate ? 'OTHER' : 'JAK77J' },
    fortnox_invoice_jobs: job,
    invoices: [{ id: 'internal', status: 'cancelled' }],
    quotes: [{ id: 'quote', subtotal: net, vat_total: quoteTotal - net, total: quoteTotal }],
    quote_items: [{ description: 'Labor', quantity: 3, unit_price: 1000, vat_rate: 25 }, { description: 'Springs', quantity: 2, unit_price: (net - 3000) / 2, vat_rate: 0.25 }],
    customers: { id: 'customer', customer_type: 'company', display_name: 'ROX INTERNATIONAL AB' },
    fortnox_customer_links: { fortnox_customer_number: '10004' },
    fortnox_production_authorizations: { tenant_id: 'fake', company_name: 'Bildiagnos i Utby AB' },
  };
  const db = {
    auth: { getUser: async () => ({ data: { user: authorized ? { id: 'user' } : null } }) },
    from(table) {
      let mutation = null;
      const q = {};
      for (const key of ['select', 'eq', 'is', 'limit', 'order']) q[key] = () => q;
      for (const key of ['insert', 'update', 'upsert']) q[key] = value => { mutation = { table, key, value }; writes.push(mutation); return q; };
      q.then = resolve => Promise.resolve({ data: mutation ? { id: 'job' } : fixtures[table], error: null }).then(resolve);
      q.maybeSingle = q.single = () => q;
      return q;
    },
  };
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if (url.includes('oauth-v1')) return Response.json({ access_token: 'fake' });
    if (url.includes('/invoices?')) return failSearch ? new Response('{}', { status: 500 }) : Response.json({ Invoices: found ? [{ DocumentNumber: '300081' }] : [] });
    if (url.endsWith('/invoices/300081')) return Response.json({ Invoice: { DocumentNumber: '300081', YourReference: 'BOS-700200' } });
    if (url.endsWith('/companyinformation')) return Response.json({ CompanyInformation: { CompanyName: 'Bildiagnos i Utby AB' } });
    if (url.endsWith('/invoices') && opts.method === 'POST') return Response.json({ Invoice: { DocumentNumber: '300082', OCR: 'fake' } });
    throw new Error('Unexpected fetch ' + url);
  };
  vm.runInNewContext(source, { Deno: { env: { get: () => 'fake' }, serve(fn) { handler = fn; } }, createClient: () => db, Response, Request, URLSearchParams, fetch, btoa, setTimeout });
  const body = { action, workOrderId: orderId, ...(missingReference ? {} : { confirmReference: otherOrder ? 'BOS-700202' : 'BOS-700200' }), ...(missingTotal ? {} : { confirmTotal: confirmedTotal }) };
  const response = await handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: response.status, data: await response.json(), writes, calls };
}
let checks = 0;
function noSideEffects(result) { assert.equal(result.writes.length, 0); assert.equal(result.calls.filter(x => x.method !== 'GET' && !x.url.includes('oauth-v1')).length, 0); }
let r = await run('preview'); assert.equal(r.data.preview.total, 5565); assert.equal(r.data.preview.vat, 1113); assert.equal(r.data.dryRun, true); assert.equal(r.calls.length, 0); noSideEffects(r); checks++;
for (const quoteTotal of [6000, 79815]) { r = await run('preview', { quoteTotal }); assert.equal(r.status, 409); assert.match(r.data.error, /requires exactly/); noSideEffects(r); checks++; }
r = await run('preview', { wrongPlate: true }); assert.equal(r.status, 409); noSideEffects(r); checks++;
r = await run('preview', { quoteTotal: 6000, otherOrder: true }); assert.equal(r.status, 200); assert.equal(r.data.preview.total, 6000); noSideEffects(r); checks++;
for (const options of [{ confirmedTotal: 79815 }, { missingTotal: true }, { missingReference: true }]) { r = await run('create', options); assert.ok(r.status >= 400); assert.equal(r.calls.length, 0); noSideEffects(r); checks++; }
r = await run('create', { found: true }); assert.equal(r.status, 409); assert.match(r.data.error, /already exists/); noSideEffects(r); checks++;
r = await run('create', { failSearch: true }); assert.equal(r.status, 500); noSideEffects(r); checks++;
r = await run('create'); assert.equal(r.data.created, true); assert.equal(r.data.sent, false); assert.equal(r.calls.filter(x => x.method === 'POST' && x.url.endsWith('/invoices')).length, 1); assert.equal(r.writes.filter(x => x.table === 'fortnox_invoice_jobs' && x.key === 'insert').length, 1); assert.equal(r.calls.some(x => /email|bookkeep/.test(x.url)), false); checks++;
for (const status of ['reserved', 'uncertain', 'submitted', 'failed']) { r = await run('create', { job: { status, fortnox_document_number: status === 'submitted' ? '300082' : null } }); assert.equal(r.status, 409); assert.equal(r.calls.length, 0); noSideEffects(r); checks++; }
r = await run('preview', { authorized: false }); assert.equal(r.status, 401); noSideEffects(r); checks++;
r = await run('preview', { role: 'technician' }); assert.equal(r.status, 403); noSideEffects(r); checks++;
console.log(`PASS ${checks} checks: exact JAK77J amount/identity, read-only preview, unrelated order unchanged, explicit confirmations, duplicate detection before first creation, failed search closed, reservation/idempotency, auth/roles. All database writes and Fortnox calls mocked.`);
