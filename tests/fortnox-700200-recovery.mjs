import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/fortnox-production-invoice/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''));
const target = 'd678b517-6a3c-4cab-8d55-afc92060afab';
const jobId = 'f39d5a07-ebfb-41a3-96e2-67cacaa188d8';
async function scenario(options = {}) {
  const calls = [], writes = [];
  const job = { id: jobId, status: options.status || 'uncertain', error_message: 'Fortnox returned HTTP 400; check Fortnox before retry', request_summary: { reference: 'BOS-700200', total: 5565 }, updated_at: '2026-11-03T19:17:00.182Z' };
  const fixtures = {
    quotes: [{ id: 'quote', status: 'approved', subtotal: 4452, vat_total: 1113, total: options.badAmount ? 79815 : 5565 }],
    invoices: [{ id: 'internal', status: 'cancelled', fortnox_reference: null }], payments: [],
    customers: { id: 'customer', personal_or_org_number: '556543-9030' },
    fortnox_customer_links: { fortnox_customer_number: '10004' },
    fortnox_production_authorizations: { tenant_id: 'fake', company_name: 'Bildiagnos i Utby AB' },
    fortnox_invoice_recovery_audit: null,
  };
  const admin = { from(table) {
    let mutation;
    const q = {};
    for (const method of ['select', 'eq', 'is', 'order', 'limit']) q[method] = () => q;
    for (const method of ['insert', 'update']) q[method] = value => { mutation = { table, method, value }; writes.push(mutation); return q; };
    q.maybeSingle = q.single = () => q;
    q.then = resolve => Promise.resolve(mutation ? { data: options.casFail && table === 'fortnox_invoice_jobs' ? null : { id: 'saved' }, error: options.auditFail && table === 'fortnox_invoice_recovery_audit' ? new Error('Audit failed') : null } : { data: fixtures[table], error: null }).then(resolve);
    return q;
  } };
  const fetch = async (raw, settings = {}) => {
    const url = new URL(raw); calls.push({ path: url.pathname, query: url.searchParams, method: settings.method || 'GET' });
    if (url.pathname.endsWith('/token')) return Response.json({ access_token: 'fake' });
    assert.equal(settings.method || 'GET', 'GET', 'Recovery must never mutate Fortnox');
    if (url.pathname.endsWith('/companyinformation')) return Response.json({ CompanyInformation: { CompanyName: 'Bildiagnos i Utby AB' } });
    if (url.pathname.endsWith('/customers/10004')) return Response.json({ Customer: { OrganisationNumber: '5565439030' } });
    if (url.pathname.endsWith('/invoices')) {
      if (options.searchError) return new Response('{}', { status: 500 });
      const customer = url.searchParams.has('customernumber');
      const targeted = url.searchParams.has('yourreference');
      const second = url.searchParams.get('page') === '2';
      let rows = customer ? [{ DocumentNumber: 'OLD' }] : [];
      if (options.found && (customer || targeted)) rows.push({ DocumentNumber: 'FOUND' });
      if (options.multiple && targeted) rows.push({ DocumentNumber: 'FOUND2' });
      return Response.json({ Invoices: second ? [] : rows, ...(options.pagination ? { MetaInformation: { TotalPages: 2 } } : {}) });
    }
    if (/\/invoices\//.test(url.pathname)) {
      const number = url.pathname.split('/').pop();
      return Response.json({ Invoice: { DocumentNumber: number, CustomerNumber: '10004', Total: options.conflict ? 6000 : 5565, Currency: 'SEK', YourReference: number === 'OLD' ? 'OLD-REFERENCE' : 'BOS-700200', OCR: 'MOCK-OCR', Sent: false, Booked: false } });
    }
    throw new Error('Unexpected API route ' + raw);
  };
  const context = vm.createContext({ Deno: { env: { get: () => 'fake' }, serve() {} }, createClient() {}, Response, Request, TextEncoder, URLSearchParams, fetch, btoa, setTimeout });
  vm.runInContext(source + '\nglobalThis.recover = recover700200;', context);
  let response;
  try { response = await context.recover(admin, { workshop_id: 'workshop' }, { id: target, order_number: 700200, plate_snapshot: 'JAK77J', customer_id: 'customer' }, job, { confirmReference: 'BOS-700200', expectedJobId: options.wrongJob ? 'other' : jobId }); }
  catch (error) { return { thrown: error.message, calls, writes }; }
  return { status: response.status, data: await response.json(), calls, writes };
}
let checks = 0;
let r = await scenario(); assert.equal(r.data.reconciled, true); assert.equal(r.data.invoiceCreated, false); assert.equal(r.writes[0].table, 'fortnox_invoice_recovery_audit'); assert.equal(r.writes[0].value.original_status, 'uncertain'); assert.match(r.writes[0].value.original_error, /HTTP 400/); assert.equal(r.writes[1].value.status, 'reconciled'); assert.equal(r.writes[1].value.error_message, undefined); checks++;
r = await scenario({ found: true }); assert.equal(r.data.documentNumber, 'FOUND'); assert.equal(r.data.ocr, 'MOCK-OCR'); assert.equal(r.data.invoiceCreated, false); assert.equal(r.data.sent, false); assert.equal(r.data.booked, false); assert.equal(r.writes[1].value.status, 'submitted'); checks++;
for (const options of [{ badAmount: true }, { wrongJob: true }, { found: true, conflict: true }, { found: true, multiple: true }]) { r = await scenario(options); assert.ok(r.status >= 400 || r.thrown); assert.equal(r.writes.length, 0); checks++; }
r = await scenario({ searchError: true }); assert.ok(r.thrown); assert.equal(r.writes.length, 0); checks++;
r = await scenario({ auditFail: true }); assert.equal(r.status, 409); assert.equal(r.writes.filter(x => x.table === 'fortnox_invoice_jobs').length, 0); checks++;
r = await scenario({ casFail: true }); assert.equal(r.status, 409); checks++;
r = await scenario({ status: 'reconciled' }); assert.equal(r.data.alreadyRecovered, true); assert.equal(r.calls.length, 0); assert.equal(r.writes.length, 0); checks++;
r = await scenario({ pagination: true }); assert.equal(r.data.reconciled, true); assert.equal(r.calls.filter(x => x.path.endsWith('/invoices')).length, 12); checks++;
console.log(`PASS ${checks} recovery checks: no invoice, existing invoice+OCR, wrong amount/job, conflicting/multiple matches, failed API, audit failure, concurrent state change, repeat, pagination. All Fortnox calls mocked; no create/send/bookkeep paths.`);
