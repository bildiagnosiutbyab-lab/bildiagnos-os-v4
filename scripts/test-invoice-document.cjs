const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const source = readFileSync('supabase/functions/fortnox-production-invoice/index.ts', 'utf8');
const fn = stripTypeScriptTypes(source.slice(source.indexOf('async function invoiceDocument('), source.indexOf('\nDeno.serve(')));
const invoice = { DocumentNumber: 300081, CustomerNumber: '10004', Currency: 'SEK', ExternalInvoiceReference1: 'BOS-700200', Total: 5565, TotalVAT: 1113, OCR: '30008189', InvoiceDate: '2026-11-04', DueDate: '2026-11-19', CustomerName: 'ROX INTERNATIONAL AB', OrganisationNumber: '556543-9030', Address1: 'J A GAHMS GATA 1', ZipCode: '42131', City: 'VÄSTRA FRÖLUNDA', TermsOfPayment: '15', InvoiceRows: [{ RowId: 1, Description: 'Spiralfjäder fram', DeliveredQuantity: '2', Price: 726, VAT: 25 }, { RowId: 2, Description: 'Byte av framfjädrar', DeliveredQuantity: '3', Price: 1000, VAT: 25 }] };
const company = { CompanyName: 'Bildiagnos i Utby AB', OrganizationNumber: '559082-4800', BG: '5927-4746', Address: 'Vagnmakaregatan 8C', ZipCode: '41572', City: 'Göteborg', VATNumber: 'SE559082480001' };
const rows = [{ description: 'Spiralfjäder fram', quantity: 2, unitPrice: 726 }, { description: 'Byte av framfjädrar', quantity: 3, unitPrice: 1000 }];
const tables = { fortnox_production_authorizations: { tenant_id: 'tenant', company_name: company.CompanyName }, customers: { customer_type: 'company', personal_or_org_number: invoice.OrganisationNumber }, fortnox_customer_links: { fortnox_customer_number: '10004' }, quotes: [{ id: 'q' }], quote_items: rows.map((r,i)=>({ description: r.description, quantity: r.quantity, unit_price: r.unitPrice, item_type: i ? 'service' : 'part' })), vehicles: { registration_plate: 'JAK77J', make: 'Mercedes-Benz', model: 'Vito', model_year: 2019, vin: 'WDF44760313558256' } };
tables.fortnox_company_billing_profiles = { organisation_number: '5590824800', company_name: company.CompanyName, billing_data: company, source_invoice_number: '300081', verified_at: '2026-11-04' };
const admin = { from(table) { const chain = { select(){return chain}, eq(){return chain}, order(){return chain}, limit(){return chain}, maybeSingle(){return chain}, single(){return chain}, then(resolve){resolve({data:tables[table],error:null})} }; return chain; } };
let calls = [], denySettings = false;
const api = async (path) => { calls.push(path); if(path==='/settings/company' && denySettings)throw new Error('Fortnox GET /settings/company HTTP 400; code 2000663; Har inte behörighet för scope.'); return path === '/companyinformation' ? { CompanyInformation: { CompanyName: company.CompanyName, OrganizationNumber: company.OrganizationNumber, Address: company.Address, City: company.City, ZipCode: company.ZipCode } } : path === '/settings/company' ? { CompanySettings: company } : { Invoice: invoice }; };
const cents = v => Math.round(Number(v)*100), org = v => String(v||'').replace(/[^0-9]/g,''), reply = body => ({status:200,body}), err = (error,status=400) => ({status,body:{ok:false,error}});
const getDocument = new Function('api','fortnoxAccess','cents','org','reply','err','fortnoxDescription','invoiceAccountingMethod',fn+';return invoiceDocument')(api,async()=>({}),cents,org,reply,err,String,async()=>null);
const order = { id:'o', order_number:700200, customer_id:'c', vehicle_id:'v', mileage:null }, member = {workshop_id:'w'}, job = {status:'submitted',fortnox_document_number:'300081',request_summary:{total:5565,vat:1113,rows}};
(async()=>{
  let result = await getDocument(admin,member,order,job);
  assert.equal(result.status,200); assert.equal(result.body.document.ocr,'30008189'); assert.equal(result.body.document.vehicle.mileage,null); assert.deepEqual(result.body.document.rows.map(r=>r.item_type),['part','service']); assert.equal(result.body.document.due_at,'2026-11-19');
  invoice.Address2=invoice.Address1;invoice.Address1='';result=await getDocument(admin,member,order,job);assert.equal(result.body.document.customer.address,invoice.Address2);assert.equal(result.body.document.customer.address2,'');invoice.Address1=invoice.Address2;invoice.Address2='';
  denySettings=true;result=await getDocument(admin,member,order,job);assert.equal(result.status,200);assert.equal(result.body.document.company.bankgiro,'5927-4746');assert.equal(result.body.document.company_settings_source,'verified_official_pdf:300081');
  tables.fortnox_company_billing_profiles.organisation_number='other';assert.equal((await getDocument(admin,member,order,job)).status,409);tables.fortnox_company_billing_profiles.organisation_number='5590824800';denySettings=false;
  for(const [key,value] of Object.entries({Total:5566,CustomerNumber:'999',Cancelled:true,ExternalInvoiceReference1:'BOS-OTHER',OCR:''})) { const original=invoice[key]; invoice[key]=value; assert.equal((await getDocument(admin,member,order,job)).status,409,key); invoice[key]=original; }
  invoice.InvoiceRows[0].Price=727; assert.equal((await getDocument(admin,member,order,job)).status,409); invoice.InvoiceRows[0].Price=726;
  assert.equal((await getDocument(admin,member,order,null)).status,409);
  assert.ok(calls.every(p=>p==='/invoices/300081'||p==='/companyinformation'||p==='/settings/company'));
  console.log('PASS: official identity, customer, totals, rows, OCR, due date, blank mileage, classification, read-only calls and mismatch blocking');
})().catch(e=>{console.error(e);process.exitCode=1});
