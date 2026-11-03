import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
const filename = process.argv[2] || new URL('../supabase/functions/fortnox-production-invoice/index.ts', import.meta.url);
const source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8').replace(/^import .*;\n/gm, ''));
const logs = [];
const context = vm.createContext({ Deno: { env: { get: key => ({ FORTNOX_CLIENT_ID: 'PRIVATE-CLIENT-ID', FORTNOX_CLIENT_SECRET: 'PRIVATE-CLIENT-SECRET' })[key] }, serve() {} }, console: { error: value => logs.push(JSON.parse(value)) }, createClient() {}, Response, Request, TextEncoder, URLSearchParams });
vm.runInContext(source + '\nglobalThis.check = {buildInvoicePayload,fortnoxFailure,sanitizeFortnoxMessage,payloadValues,fortnoxDescription,providerError,readFortnoxResponse};', context);
const { buildInvoicePayload, fortnoxFailure, sanitizeFortnoxMessage, payloadValues, fortnoxDescription, providerError, readFortnoxResponse } = context.check;
const lines = [{ description: 'Byte av framfjädrar', quantity: 3, unit_price: 1000, vat_rate: .25 }, { description: 'Spiralfjäder', quantity: 2, unit_price: 726, vat_rate: 25 }];
const payload = buildInvoicePayload('10004', 'BOS-700200', lines, 700200);
let checks = 0;
for (const row of payload.Invoice.InvoiceRows) { assert.equal(typeof row.DeliveredQuantity, 'string'); assert.equal(row.VATCode, 'MP1'); assert.equal('VAT' in row, false); assert.equal(row.Discount, 0); } checks++;
assert.equal(payload.Invoice.VATIncluded, false); assert.equal(payload.Invoice.Currency, 'SEK'); assert.equal(payload.Invoice.AdministrationFee, 0); assert.equal(payload.Invoice.Freight, 0); assert.equal(payload.Invoice.ExternalInvoiceReference1, 'BOS-700200'); checks++;
const subtotal = payload.Invoice.InvoiceRows.reduce((sum, row) => sum + Number(row.DeliveredQuantity) * row.Price, 0); assert.equal(subtotal, 4452); assert.equal(subtotal * 1.25, 5565); checks++;
for (const invalid of [{ ...lines[0], quantity: NaN }, { ...lines[0], quantity: 0 }, { ...lines[0], unit_price: Infinity }, { ...lines[0], unit_price: -1 }, { ...lines[0], vat_rate: 'invalid' }, { ...lines[0], description: 'x'.repeat(256) }]) { assert.throws(() => buildInvoicePayload('10004', 'BOS-700200', [invalid], 700200)); checks++; }
assert.throws(() => buildInvoicePayload(null, 'BOS-700200', lines, 700200)); assert.throws(() => buildInvoicePayload('10004', 'bad', lines, 700200)); checks++;
const exact = 'An account must be provided when using a custom VAT rate and EasyVat has been enabled.';
const failure = fortnoxFailure(400, { ErrorInformation: { Code: 2004167, Message: exact } }, 'POST /invoices'); assert.equal(logs[0].code, '2004167'); assert.equal(logs[0].message, exact); assert.equal(logs[0].httpStatus, 400); assert.ok(logs[0].diagnosticId); assert.match(failure.message, /2004167/); assert.ok(failure.message.includes(exact)); checks++;
const secretMessage = 'PRIVATE-CLIENT-ID PRIVATE-CLIENT-SECRET Bearer ABC123SECRET Basic BASE64SECRET person@example.com 19800101-1234 access_token="DANGEROUS" {"refresh_token":"SUPERSECRET"} ROX PRIVATE ROAD BOS-700200';
const redacted = sanitizeFortnoxMessage(secretMessage, ['ROX PRIVATE ROAD', ...payloadValues(payload)]);
for (const secret of ['PRIVATE-CLIENT-ID', 'PRIVATE-CLIENT-SECRET', 'ABC123SECRET', 'BASE64SECRET', 'person@example.com', '19800101-1234', 'DANGEROUS', 'SUPERSECRET', 'ROX PRIVATE ROAD', 'BOS-700200']) assert.equal(redacted.includes(secret), false, secret); checks++;
fortnoxFailure(404, { ErrorInformation: { Code: 200, Message: 'Not found' } }, 'GET /customers/10004'); assert.equal(logs[1].stage, 'GET /customers/:id'); assert.equal(JSON.stringify(logs).includes('10004'), false); checks++;
assert.equal(sanitizeFortnoxMessage('x'.repeat(2000)).length, 1500); assert.equal(sanitizeFortnoxMessage('a\nb').includes('\n'), false); checks++;

assert.equal(fortnoxDescription('1225-17283 · Spiralfjäder Kilen fram'), '1225-17283 - Spiralfjäder Kilen fram'); assert.equal(fortnoxDescription('Byte av framfjädrar'), 'Byte av framfjädrar'); assert.equal(fortnoxDescription('a\u0000b • c — d'), 'a b - c - d'); assert.throws(()=>fortnoxDescription('Oil 🔧')); checks++;
const outgoing=buildInvoicePayload('10004','BOS-700200',[{...lines[1],description:'1225-17283 · Spiralfjäder Kilen fram'}],700200);assert.equal(outgoing.Invoice.InvoiceRows[0].Description.includes('·'),false);checks++;
for (const [body,code,message] of [[{error:{code:2000359,message:'Invalid characters'}},2000359,'Invalid characters'],[{errorInformation:{code:2001392,message:'Invalid body'}},2001392,'Invalid body'],['<ErrorInformation><Code>2000359</Code><Message>Invalid characters</Message></ErrorInformation>','2000359','Invalid characters'],['Bad Request',undefined,'Bad Request'],['',undefined,'Empty Fortnox error response']]) { const parsed=providerError(body);assert.equal(parsed.Code,code);assert.equal(parsed.Message,message);checks++; }
const parsedText=await readFortnoxResponse(new Response('Bad Request',{status:400,headers:{'content-type':'text/plain; charset=utf-8'}}));assert.equal(parsedText.payload,'Bad Request');assert.equal(parsedText.contentType,'text/plain');assert.equal(parsedText.bodyBytes,11);checks++;

if (process.env.FORTNOX_SCHEMA_FIXTURE) fs.writeFileSync(process.env.FORTNOX_SCHEMA_FIXTURE, JSON.stringify(payload));
console.log(`PASS ${checks} payload/diagnostic checks: string quantities, MP1, explicit SEK/net prices, no implicit fees, exact total, invalid data rejection, exact safe error/code, secret/PII redaction and bounded logs. No network calls.`);
