import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const ORIGIN="https://bildiagnosiutbyab-lab.github.io";
const headers={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":ORIGIN,"access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"authorization,apikey,content-type,x-client-info"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const err=(message:string,status=400)=>reply({ok:false,error:message},status);
function requireEnv(name:string){const v=Deno.env.get(name);if(!v)throw new Error("Missing server configuration: "+name);return v;}
function cents(v:unknown){return Math.round(Number(v)*100);}
function vatFraction(v:unknown){const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=100?(n>1?n/100:n):NaN;}
function payloadValues(value:any):string[]{
 if(value==null)return [];
 if(Array.isArray(value))return value.flatMap(payloadValues);
 if(typeof value==="object")return Object.values(value).flatMap(payloadValues);
 return typeof value==="string"||typeof value==="number"?[String(value)]:[];
}
function sanitizeFortnoxMessage(value:unknown,sensitive:string[]=[]){
 let message=String(value||"Fortnox returned no error message");
 const secrets=[...sensitive,Deno.env.get("FORTNOX_CLIENT_ID")||"",Deno.env.get("FORTNOX_CLIENT_SECRET")||""].filter(x=>x.length>=3).sort((a,b)=>b.length-a.length);
 for(const secret of secrets)message=message.split(secret).join("[REDACTED]");
 return message
  .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi,"[REDACTED AUTH]")
  .replace(/["']?(?:access_token|refresh_token|client_secret|password|authorization)["']?\s*[=:]\s*["']?[^\s,"'}]+/gi,"[REDACTED SECRET]")
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,"[REDACTED TOKEN]")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,"[REDACTED EMAIL]")
  .replace(/\b\d{6,}(?:[- ]\d+)*\b/g,"[REDACTED NUMBER]")
  .replace(/[\r\n\t]+/g," ")
  .slice(0,1500);
}
async function readFortnoxResponse(response:Response){
 const raw=await response.text();
 let payload:any;
 try{payload=JSON.parse(raw);}catch{payload=raw;}
 return {payload,contentType:(response.headers.get("content-type")||"").split(";")[0],bodyBytes:new TextEncoder().encode(raw).byteLength};
}
function providerError(payload:any){
 const info=payload?.ErrorInformation||payload?.errorInformation||payload?.error||payload?.errors?.[0]||payload;
 if(typeof info==="string"){
  const xmlMessage=info.match(/<(?:Message|message)>([\s\S]*?)<\/(?:Message|message)>/);
  const xmlCode=info.match(/<(?:Code|code)>(\d+)<\/(?:Code|code)>/);
  const text=(xmlMessage?.[1]||info).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<[^>]*>/g," ").trim();
  return {Code:xmlCode?.[1],Message:text||"Empty Fortnox error response"};
 }
 return {Code:info?.Code??info?.code??info?.Error??info?.errorCode,Message:info?.Message??info?.message??info?.error_description??info?.detail??info?.title??"Unrecognized Fortnox error response"};
}
function fortnoxFailure(status:number,payload:any,stage:string,sensitive:string[]=[],metadata:any={}){
 const information=providerError(payload);
 const rawCode=information.Code;
 const code=/^\d{1,10}$/.test(String(rawCode??""))?String(rawCode):"unknown";
 const message=sanitizeFortnoxMessage(information.Message,sensitive);
 const diagnosticId=globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);
 // Never log headers, tokens, request bodies, customer records or raw responses.
 const safeStage=stage.replace(/\/(customers|invoices|articles)\/[^/\s]+/g,"/$1/:id");
 console.error(JSON.stringify({event:"fortnox_api_error",diagnosticId,stage:safeStage,httpStatus:status,code,message,contentType:metadata.contentType,bodyBytes:metadata.bodyBytes}));
 return new Error(`Fortnox ${safeStage} HTTP ${status}; code ${code}; ${message}; diagnostic ${diagnosticId}`);
}
function fortnoxDescription(value:unknown){
 // Match the working test-invoice bridge and Fortnox's documented character set.
 // Only the outgoing text changes; the workshop's original description is retained.
 const text=String(value??"").normalize("NFC").replace(/[·•–—]/g," - ").replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim();
 const valid=/^[\p{L}0-9\u0308\u030a \\’`´,;:^¤#%§£$€¢¥©™°&\/()=+\-*_!?²³®½@.\u00a0]*$/u;
 if(!valid.test(text))throw new Error("Invoice description contains characters unsupported by Fortnox; review the text before creation");
 return text;
}
function buildInvoicePayload(customerNumber:unknown,reference:string,lines:any[],orderNumber:unknown){
 const number=String(customerNumber??"").trim();
 if(!number||["null","undefined"].includes(number.toLowerCase()))throw new Error("Valid Fortnox customer number required");
 if(!/^BOS-\d+$/.test(reference)||reference.length>50)throw new Error("Valid BOS invoice reference required");
 if(!lines.length)throw new Error("Invoice rows required");
 const rows=lines.map(line=>{
  const quantity=Number(line.quantity),price=Number(line.unit_price),description=fortnoxDescription(line.description);
  if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<0||!description||description.length>255||vatFraction(line.vat_rate)!==0.25)throw new Error("Invalid invoice row quantity, price, description or VAT");
  // Fortnox's request schema uses a STRING quantity. MP1 uses the configured
  // domestic 25% VAT/sales accounts; VAT:25 without an account is custom VAT.
  return {Description:description,DeliveredQuantity:String(quantity),Price:price,Discount:0,VATCode:"MP1"};
 });
 return {Invoice:{CustomerNumber:number,Currency:"SEK",VATIncluded:false,AdministrationFee:0,Freight:0,YourReference:reference,ExternalInvoiceReference1:reference,InvoiceRows:rows,Remarks:"Bildiagnos arbetsorder "+orderNumber}};
}

async function fortnoxAccess(tenant:string,scope="companyinformation customer invoice article payment"){
 const basic=btoa(requireEnv("FORTNOX_CLIENT_ID")+":"+requireEnv("FORTNOX_CLIENT_SECRET"));
 const r=await fetch("https://apps.fortnox.se/oauth-v1/token",{method:"POST",headers:{authorization:"Basic "+basic,"content-type":"application/x-www-form-urlencoded",TenantId:tenant},body:new URLSearchParams({grant_type:"client_credentials",scope})});
 if(!r.ok)throw new Error("Fortnox authorization failed: "+r.status);
 const token=String((await r.json()).access_token||"");if(!token)throw new Error("Fortnox token missing");
 return {Authorization:"Bearer "+token,Accept:"application/json"};
}
async function api(path:string,headers:Record<string,string>,method="GET",payload?:unknown){
 // Retry only safe reads on transient Fortnox rate limits. Never retry invoice creation/send.
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch("https://api.fortnox.se/3"+path,{method,headers:{...headers,...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
  if(r.status===429 && method==="GET" && attempt<2){
   const retry=Number(r.headers.get("retry-after"));
   const ms=Number.isFinite(retry)&&retry>0?Math.min(retry*1000,5000):(1000*(attempt+1));
   await new Promise(resolve=>setTimeout(resolve,ms));
   continue;
  }
  const parsed=await readFortnoxResponse(r);
  if(!r.ok)throw fortnoxFailure(r.status,parsed.payload,method+" "+path.split("?")[0],payloadValues(payload),parsed);
  if(!parsed.payload||typeof parsed.payload!=="object")throw new Error("Fortnox returned a non-JSON success response");
  return parsed.payload;
 }
 throw new Error("Fortnox rate limit: retry attempts exhausted");
}
async function invoiceAccountingMethod(invoice:any,h:Record<string,string>){
 const known=(value:any)=>["CASH","ACCRUAL"].includes(String(value||"").toUpperCase())?String(value).toUpperCase():null;
 if(known(invoice.AccountingMethod))return known(invoice.AccountingMethod);
 const same=(candidate:any)=>String(candidate?.DocumentNumber)===String(invoice.DocumentNumber)&&String(candidate?.CustomerNumber)===String(invoice.CustomerNumber)&&cents(candidate?.Total)===cents(invoice.Total);
 try{
  const v2=(await api("/invoices-v2/"+encodeURIComponent(String(invoice.DocumentNumber)),h)).Invoice;
  if(same(v2)&&known(v2.AccountingMethod))return known(v2.AccountingMethod);
  // The v2 list explicitly exposes AccountingMethod even on older invoice records.
  const list=await api("/invoices-v2?filter=unbooked&limit=500&page=1",h);
  const match=(list.Invoices||[]).find(same);
  if(match&&known(match.AccountingMethod))return known(match.AccountingMethod);
 }catch{ /* Unknown is reported as unknown; never infer accrual accounting. */ }
 return null;
}
async function bookkeepInvoice(admin:any,existingJob:any,h:Record<string,string>){
 const number=String(existingJob.fortnox_document_number||"");
 if(!number||!existingJob.sent_at)throw new Error("Invoice must be sent and linked before bookkeeping");
 const current=(await api("/invoices/"+encodeURIComponent(number),h)).Invoice;
 if(!current||String(current.DocumentNumber)!==number)throw new Error("Fortnox invoice identity mismatch");
 // Safe reconciliation, even when a previous booking attempt has uncertain outcome.
 if(current.Booked===true){
  const {error}=await admin.from("fortnox_invoice_jobs").update({booked_at:existingJob.booked_at||new Date().toISOString(),bookkeep_error:null}).eq("id",existingJob.id);
  if(error)throw new Error("Booked in Fortnox, but local confirmation could not be stored");
  return {booked:true,alreadyBooked:true};
 }
 if(current.Cancelled===true||current.Credit===true||cents(current.Total)!==cents(existingJob.request_summary?.total)||![current.YourReference,current.ExternalInvoiceReference1].includes(existingJob.request_summary?.reference))throw new Error("Official invoice identity/amount changed; bookkeeping blocked");
 const method=await invoiceAccountingMethod(current,h);
 if(method==="CASH")throw new Error("Método de caja (kontantmetoden): Fortnox contabiliza al registrar el cobro. No se ha contabilizado ni registrado ningún pago.");
 if(method!=="ACCRUAL")throw new Error("Método contable no verificado; contabilización bloqueada hasta comprobarlo en Fortnox.");
 if(existingJob.bookkeep_attempted_at)throw new Error("Previous bookkeeping attempt may have succeeded; inspect Fortnox before retry");
 const {data:claimed,error:claimError}=await admin.from("fortnox_invoice_jobs").update({bookkeep_attempted_at:new Date().toISOString()}).eq("id",existingJob.id).is("bookkeep_attempted_at",null).is("booked_at",null).select("id").maybeSingle();
 if(claimError||!claimed)throw new Error("Bookkeeping already claimed; inspect Fortnox before retry");
 try{
  // Fortnox requires a JSON content type for invoice bookkeep actions.
  const r=await fetch("https://api.fortnox.se/3/invoices/"+encodeURIComponent(number)+"/bookkeep",{method:"PUT",headers:{...h,"Content-Type":"application/json"},body:"{}"});
  if(!r.ok)throw new Error("Fortnox bookkeeping HTTP "+r.status+"; reconcile before retry");
  const confirmed=(await api("/invoices/"+encodeURIComponent(number),h)).Invoice;
  if(!confirmed||confirmed.Booked!==true)throw new Error("Fortnox bookkeeping confirmation unavailable; reconcile before retry");
  const {error}=await admin.from("fortnox_invoice_jobs").update({booked_at:new Date().toISOString(),bookkeep_error:null}).eq("id",existingJob.id);
  if(error)throw new Error("Fortnox booked invoice but local status could not be saved");
  return {booked:true,alreadyBooked:false};
 }catch(e){
  const message=e instanceof Error?e.message:"Unknown bookkeeping error";
  await admin.from("fortnox_invoice_jobs").update({bookkeep_error:message}).eq("id",existingJob.id);
  throw e;
 }
}
function org(v:unknown){return String(v||"").replace(/[^0-9]/g,"");}
async function diagnose700200(admin:any,member:any,order:any,input:any){
 if(order.id!=="d678b517-6a3c-4cab-8d55-afc92060afab"||order.plate_snapshot!=="JAK77J"||input.confirmReference!=="BOS-700200")return err("Diagnostic order confirmation mismatch",409);
 const {data:authz}=await admin.from("fortnox_production_authorizations").select("tenant_id,company_name").eq("workshop_id",member.workshop_id).eq("status","verified").order("verified_at",{ascending:false}).limit(1).maybeSingle();
 if(!authz?.tenant_id||authz.company_name!=="Bildiagnos i Utby AB")return err("Production authorization missing",403);
 const h=await fortnoxAccess(authz.tenant_id);
 if((await api("/companyinformation",h)).CompanyInformation?.CompanyName!=="Bildiagnos i Utby AB")return err("Wrong company",409);
 const customer=(await api("/customers/10004",h)).Customer;
 if(org(customer?.OrganisationNumber)!=="5565439030")return err("Wrong ROX customer",409);
 const found=await findInvoiceByReference(h,"BOS-700200");
 let predefined:any;
 try{
  const result=await api("/predefinedaccounts",h);
  predefined=(result.PreDefinedAccounts||[]).filter((x:any)=>["SALES","SALES2","SALES_25_SE"].includes(x.Name)).map((x:any)=>({name:x.Name,account:x.Account}));
 }catch(e){predefined={unavailable:e instanceof Error?e.message:"Unavailable"};}
 const list=await api("/invoices?customernumber=10004&limit=500&page=1",h);
 if(!Array.isArray(list.Invoices))return err("Customer invoice list unavailable",409);
 const latest=[...list.Invoices].sort((a:any,b:any)=>Number(b.DocumentNumber)-Number(a.DocumentNumber))[0];
 let establishedRows:any[]=[];
 if(latest){
  const invoice=(await api("/invoices/"+encodeURIComponent(String(latest.DocumentNumber)),h)).Invoice;
  if(String(invoice?.CustomerNumber)!=="10004")return err("Invoice customer mismatch",409);
  establishedRows=(invoice.InvoiceRows||[]).map((x:any)=>({account:x.AccountNumber,vat:x.VAT,vatCode:x.VATCode,quantityType:typeof x.DeliveredQuantity}));
 }
 // Invalid document number is a read-only response-format probe, never a create.
 const probe=await fetch("https://api.fortnox.se/3/invoices/0",{headers:h});
 const parsed=await readFortnoxResponse(probe);
 const probeError=providerError(parsed.payload);
 return reply({ok:true,diagnostic:true,invoiceCreated:false,sent:false,booked:false,existingInvoiceNumber:found,customer:{active:customer.Active,vatType:customer.VATType,currency:customer.Currency,countryCode:customer.CountryCode,salesAccount:customer.SalesAccount},predefined,establishedRows,responseProbe:{httpStatus:probe.status,contentType:parsed.contentType,bodyBytes:parsed.bodyBytes,code:probeError.Code,message:sanitizeFortnoxMessage(probeError.Message,payloadValues(customer))}});
}
async function recover700200(admin:any,member:any,order:any,job:any,input:any){
 const reference="BOS-700200";
 const target="d678b517-6a3c-4cab-8d55-afc92060afab";
 if(order.id!==target||Number(order.order_number)!==700200||order.plate_snapshot!=="JAK77J"||input.confirmReference!==reference||input.expectedJobId!=="f39d5a07-ebfb-41a3-96e2-67cacaa188d8")return err("Recovery is restricted to the confirmed 700200 / JAK77J attempt",409);
 if(!job||job.id!==input.expectedJobId)return err("Recovery job identity mismatch",409);
 if(job.status==="reconciled"||job.status==="submitted")return reply({ok:true,alreadyRecovered:true,status:job.status,documentNumber:job.fortnox_document_number,ocr:job.ocr,invoiceCreated:false,sent:false});
 const firstError=job.error_message==="Fortnox returned HTTP 400; check Fortnox before retry";
 const secondError=job.error_message==="Fortnox POST /invoices HTTP 400; code unknown; Fortnox returned no error message; diagnostic 4c591658-a538-4afd-bbfd-5c76bfcd25f5" && input.expectedJobUpdatedAt==="2026-11-03T19:40:58.728+00:00" && job.updated_at===input.expectedJobUpdatedAt;
 if(job.status!=="uncertain"||job.fortnox_document_number||!firstError&&!secondError||job.send_attempted_at||job.sent_at||job.bookkeep_attempted_at||job.booked_at)return err("Job not eligible for this recovery",409);
 if(job.request_summary?.reference!==reference||cents(job.request_summary?.total)!==556500)return err("Original attempt amount/reference mismatch",409);
 const {data:quotes,error:quoteError}=await admin.from("quotes").select("id,status,subtotal,vat_total,total").eq("work_order_id",target).eq("status","approved");
 if(quoteError||quotes?.length!==1||cents(quotes[0].subtotal)!==445200||cents(quotes[0].vat_total)!==111300||cents(quotes[0].total)!==556500)return err("Expected approved quote 4452 + 1113 = 5565 SEK not verified",409);
 const {data:local,error:localError}=await admin.from("invoices").select("id,status,fortnox_reference").eq("work_order_id",target);
 if(localError||local?.some((x:any)=>!["cancelled","credited"].includes(x.status)||x.fortnox_reference))return err("Active local invoice or existing Fortnox link; stop recovery",409);
 const {data:payments,error:paymentError}=await admin.from("payments").select("id").eq("work_order_id",target);
 if(paymentError||payments?.length)return err("Payment exists or payment check unavailable",409);
 const {data:customer,error:customerError}=await admin.from("customers").select("id,personal_or_org_number").eq("id",order.customer_id).eq("workshop_id",member.workshop_id).maybeSingle();
 const {data:linked,error:linkError}=await admin.from("fortnox_customer_links").select("fortnox_customer_number").eq("customer_id",order.customer_id).eq("workshop_id",member.workshop_id).eq("environment","production").maybeSingle();
 if(customerError||linkError||org(customer?.personal_or_org_number)!=="5565439030"||String(linked?.fortnox_customer_number)!=="10004")return err("ROX customer identity not verified",409);
 const {data:authz,error:authzError}=await admin.from("fortnox_production_authorizations").select("tenant_id,company_name").eq("workshop_id",member.workshop_id).eq("status","verified").order("verified_at",{ascending:false}).limit(1).maybeSingle();
 if(authzError||!authz?.tenant_id||authz.company_name!=="Bildiagnos i Utby AB")return err("Production authorization missing",403);
 const h=await fortnoxAccess(authz.tenant_id);
 const company=(await api("/companyinformation",h)).CompanyInformation;
 if(company?.CompanyName!=="Bildiagnos i Utby AB")return err("Wrong Fortnox production company",409);
 const fortnoxCustomer=(await api("/customers/10004",h)).Customer;
 if(org(fortnoxCustomer?.OrganisationNumber)!=="5565439030")return err("Fortnox ROX customer mismatch",409);
 const candidates=new Map<string,boolean>();
 const searches:any[]=[];
 for(const [field,value] of [["yourreference",reference],["ourreference",reference],["yourordernumber",reference],["externalinvoicereference1",reference],["externalinvoicereference2",reference],["customernumber","10004"]]){
  let complete=false,count=0;
  for(let page=1;page<=100;page++){
   const result=await api("/invoices?"+field+"="+encodeURIComponent(value)+"&limit=500&page="+page,h);
   if(!Array.isArray(result.Invoices))throw new Error("Incomplete Fortnox recovery search: "+field);
   for(const row of result.Invoices){
    const number=String(row.DocumentNumber||"");
    if(!number)throw new Error("Recovery result lacks invoice number");
    candidates.set(number,Boolean(candidates.get(number))||field!=="customernumber");count++;
   }
   const totalPages=Number(result.MetaInformation?.TotalPages);
   if(Number.isFinite(totalPages)&&totalPages>0){if(totalPages>100)throw new Error("Recovery pagination exceeds safety limit");if(page>=totalPages){complete=true;break;}}
   else if(result.Invoices.length<500){complete=true;break;}
  }
  if(!complete)throw new Error("Incomplete Fortnox recovery pagination: "+field);
  searches.push({field,count,complete});
 }
 const matches:any[]=[];
 for(const [number,targeted] of candidates){
  const invoice=(await api("/invoices/"+encodeURIComponent(number),h)).Invoice;
  if(!invoice||String(invoice.DocumentNumber)!==number)throw new Error("Recovery invoice detail identity unavailable");
  const matchesReference=[invoice.YourReference,invoice.OurReference,invoice.YourOrderNumber,invoice.ExternalInvoiceReference1,invoice.ExternalInvoiceReference2,invoice.Remarks].some(x=>String(x||"").includes(reference));
  if(targeted&&!matchesReference)throw new Error("Conflicting Fortnox reference search result; recovery blocked");
  if(!matchesReference)continue;
  if(String(invoice.CustomerNumber)!=="10004"||cents(invoice.Total)!==556500||String(invoice.Currency)!=="SEK"||invoice.Cancelled===true||invoice.Credit===true)throw new Error("Matching reference has conflicting invoice amount/customer/status; recovery blocked");
  matches.push(invoice);
 }
 if(matches.length>1)return err("Multiple Fortnox invoices match BOS-700200; recovery blocked",409);
 const now=new Date().toISOString();
 const invoice=matches[0]||null;
 const check={method:"production_api_reference_and_customer_search",company:"Bildiagnos i Utby AB",customerNumber:"10004",reference,searches,detailCount:candidates.size,checked_job_status:job.status,checked_job_error:job.error_message,checked_job_updated_at:job.updated_at,checked_request_summary:job.request_summary,result:invoice?"existing_invoice_found":"none_found",invoice:invoice?{documentNumber:String(invoice.DocumentNumber),ocr:String(invoice.OCR||""),total:Number(invoice.Total),sent:invoice.Sent===true,booked:invoice.Booked===true}:null};
 const {data:prior,error:priorError}=await admin.from("fortnox_invoice_recovery_audit").select("id,reference,checked_at,check_details").eq("job_id",job.id).maybeSingle();
 if(priorError||prior&&prior.reference!==reference)return err("Recovery audit conflict",409);
 const audit={workshop_id:member.workshop_id,work_order_id:target,job_id:job.id,original_status:job.status,original_error:job.error_message,original_document_number:job.fortnox_document_number,reference,checked_at:now,check_details:check};
 const auditResult=prior
  ?await admin.from("fortnox_invoice_recovery_audit").update({checked_at:now,check_details:{...check,previous_checks:[...(Array.isArray(prior.check_details?.previous_checks)?prior.check_details.previous_checks:[]),{checked_at:prior.checked_at,check_details:Object.fromEntries(Object.entries(prior.check_details||{}).filter(([key])=>key!=="previous_checks"))}]}}).eq("id",prior.id).eq("checked_at",prior.checked_at).select("id").maybeSingle()
  :await admin.from("fortnox_invoice_recovery_audit").insert(audit).select("id").single();
 if(auditResult.error||!auditResult.data)return err("Audit could not be saved; job remains blocked",409);
 const update=invoice?{status:"submitted",fortnox_document_number:String(invoice.DocumentNumber),ocr:String(invoice.OCR||""),invoice_status:String(invoice.Status||"recovered"),sent_at:invoice.Sent===true?now:null,booked_at:invoice.Booked===true?now:null,updated_at:now}:{status:"reconciled",updated_at:now};
 const {data:changed,error:updateError}=await admin.from("fortnox_invoice_jobs").update(update).eq("id",job.id).eq("work_order_id",target).eq("status","uncertain").eq("updated_at",job.updated_at).is("fortnox_document_number",null).is("send_attempted_at",null).is("bookkeep_attempted_at",null).select("id").maybeSingle();
 if(updateError||!changed)return err("Job changed during recovery; no retry allowed until verified",409);
 return reply({ok:true,recovered:Boolean(invoice),reconciled:!invoice,status:invoice?"submitted":"reconciled",reference,documentNumber:invoice?String(invoice.DocumentNumber):null,ocr:invoice?String(invoice.OCR||""):null,checkedAt:now,invoiceCreated:false,sent:false,booked:false});
}
async function findInvoiceByReference(h:Record<string,string>,reference:string){
 // Fortnox supports filtering invoice lists by reference. Do not fetch every invoice
 // detail: it causes HTTP 429 and is unnecessary for the integration reference.
 // Fail closed whenever a query/pagination is incomplete or inconsistent.
 const filters=["yourreference","ourreference","yourordernumber","externalinvoicereference1","externalinvoicereference2"];
 const numbers=new Set<string>();
 for(const field of filters){
  let complete=false;
  for(let page=1;page<=100;page++){
   const result=await api("/invoices?"+field+"="+encodeURIComponent(reference)+"&limit=500&page="+page,h);
   if(!Array.isArray(result.Invoices))throw new Error("Fortnox invoice reference search unavailable: "+field);
   const batch=result.Invoices;
   for(const row of batch){
    const n=String(row.DocumentNumber||"").trim();
    if(!n)throw new Error("Fortnox invoice missing document number");
    numbers.add(n);
   }
   if(batch.length<500){complete=true;break;}
  }
  if(!complete)throw new Error("Fortnox invoice reference search incomplete: "+field);
 }
 for(const number of numbers){
  const detail=(await api("/invoices/"+encodeURIComponent(number),h)).Invoice;
  if(!detail)throw new Error("Fortnox invoice details unavailable");
  if([detail.YourReference,detail.OurReference,detail.YourOrderNumber,detail.ExternalInvoiceReference1,detail.ExternalInvoiceReference2,detail.Remarks].some(x=>String(x||"").includes(reference)))return number;
  // A targeted result without a matching detail is ambiguous; never treat as no match.
  throw new Error("Fortnox returned conflicting invoice reference; manual reconciliation required");
 }
 return null;
}
async function resolveCustomer(db:any,member:any,customer:any,h:Record<string,string>,create:boolean){
 const {data:linked}=await db.from("fortnox_customer_links").select("fortnox_customer_number").eq("workshop_id",member.workshop_id).eq("customer_id",customer.id).eq("environment","production").maybeSingle();
 if(linked?.fortnox_customer_number)return String(linked.fortnox_customer_number);
 const isPerson=customer.customer_type==="person";
 if(!isPerson&&customer.customer_type!=="company")throw new Error("Unknown customer type");
 const number=org(customer.personal_or_org_number);
 if(!isPerson&&number.length!==10)throw new Error("Valid company organization number required");
 let found:any=null;
 if(!isPerson){
  const result=await api("/customers?organisationnumber="+encodeURIComponent(number),h);
  const matching=(result.Customers||[]).filter((x:any)=>org(x.OrganisationNumber)===number);
  if(matching.length>1)throw new Error("Multiple Fortnox customers with same org number: manual reconciliation required");
  found=matching[0];
 }else{
  // Read all customer pages before creating a person; never match solely on a shared email.
  const candidates:any[]=[];
  let complete=false;
  for(let page=1;page<=100;page++){
   const result=await api("/customers?limit=500&page="+page,h);
   const batch=Array.isArray(result.Customers)?result.Customers:[];
   candidates.push(...batch);
   if(batch.length<500){complete=true;break;}
  }
  if(!complete)throw new Error("Fortnox customer list too large to reconcile safely");
  const name=String(customer.display_name||"").trim().toLocaleLowerCase();
  const names=candidates.filter((x:any)=>String(x.Name||"").trim().toLocaleLowerCase()===name);
  // A matching name must be reconciled carefully: never create a possible duplicate.
  if(names.length>1)throw new Error("Multiple Fortnox customers with same name: manual reconciliation required");
  if(names.length===1){
   const detail=(await api("/customers/"+encodeURIComponent(String(names[0].CustomerNumber)),h)).Customer;
   const norm=(x:unknown)=>String(x||"").trim().toLocaleLowerCase().replace(/\\s+/g," ");
   if(norm(detail?.Address1)!==norm(customer.address_line)||norm(detail?.ZipCode).replace(/\\s/g,"")!==norm(customer.postal_code).replace(/\\s/g,""))throw new Error("Fortnox customer with same name but different address: reconcile manually");
   found=detail;
  }
 }
 if(!found){
  if(!create)throw new Error("Customer is not linked. Create action will synchronize it first.");
  const details={Name:String(customer.display_name||""),Address1:String(customer.address_line||""),ZipCode:String(customer.postal_code||""),City:String(customer.city||""),Email:String(customer.email||"")};
  const payload={Customer:isPerson?details:{...details,OrganisationNumber:number}};
  if(!payload.Customer.Name||!payload.Customer.Address1||!payload.Customer.ZipCode||!payload.Customer.City||!payload.Customer.Email)throw new Error("Complete company name, address, postal code, city, email first");
  const created=await api("/customers",h,"POST",payload);found=created.Customer;
 }
 const custNo=String(found?.CustomerNumber||"");if(!custNo)throw new Error("No Fortnox customer number; reconcile manually");
 const {error:linkError}=await db.from("fortnox_customer_links").upsert({workshop_id:member.workshop_id,environment:"production",customer_id:customer.id,fortnox_customer_number:custNo,last_synced_at:new Date().toISOString()},{onConflict:"workshop_id,environment,customer_id"});
 if(linkError)throw new Error("Customer found in Fortnox but link could not be stored: "+linkError.message);
 return custNo;
}

// Read-only official document data. Never creates, sends, books or updates invoices.
async function invoiceDocument(admin:any,member:any,order:any,job:any){
 if(!job?.fortnox_document_number||job.status!=="submitted")return err("No linked production invoice; document unavailable",409);
 const {data:authorization,error:authorizationError}=await admin.from("fortnox_production_authorizations").select("tenant_id,company_name").eq("workshop_id",member.workshop_id).eq("status","verified").order("verified_at",{ascending:false}).limit(1).maybeSingle();
 if(authorizationError||!authorization?.tenant_id)return err("Production authorization unavailable",403);
 const h=await fortnoxAccess(authorization.tenant_id);
 const number=String(job.fortnox_document_number),reference="BOS-"+order.order_number;
 const invoice=(await api("/invoices/"+encodeURIComponent(number),h)).Invoice;
 const company=(await api("/companyinformation",h)).CompanyInformation;
 if(company)company.OrganisationNumber=company.OrganizationNumber||company.OrganisationNumber;
 let settings:any,settingsSource="fortnox_api";
 try { settings=(await api("/settings/company",h)).CompanySettings; }
 catch(error){
  if(!(error instanceof Error)||!error.message.includes("code 2000663"))throw error;
  // A verified official-PDF profile supplies workshop payment details only.
  // Invoice identity, OCR, dates, customer, rows and totals always come from the live API.
  const {data:profile,error:profileError}=await admin.from("fortnox_company_billing_profiles").select("organisation_number,company_name,billing_data,source_invoice_number,verified_at").eq("workshop_id",member.workshop_id).maybeSingle();
  if(profileError||!profile||profile.company_name!==company?.CompanyName||org(profile.organisation_number)!==org(company?.OrganisationNumber))return err("Verified company payment profile unavailable; enable Fortnox settings scope",409);
  settings=profile.billing_data;settingsSource="verified_official_pdf:"+profile.source_invoice_number;
 }
 if(settings)Object.assign(company,{BG:settings.BG,VATNumber:settings.VATNumber,Email:settings.Email,Phone1:settings.Phone1,TaxEnabled:settings.TaxEnabled});
 const {data:customer,error:customerError}=await admin.from("customers").select("customer_type,personal_or_org_number").eq("id",order.customer_id).eq("workshop_id",member.workshop_id).single();
 const {data:link,error:linkError}=await admin.from("fortnox_customer_links").select("fortnox_customer_number").eq("customer_id",order.customer_id).eq("workshop_id",member.workshop_id).eq("environment","production").maybeSingle();
 if(customerError||linkError||!link||String(invoice?.CustomerNumber)!==String(link.fortnox_customer_number))return err("Official invoice customer mismatch",409);
 if(!company||company.CompanyName!==authorization.company_name||org(company.OrganisationNumber)!=="5590824800"){
  console.error(JSON.stringify({event:"invoice_company_schema",fields:Object.keys(company||{}),nameMatches:company?.CompanyName===authorization.company_name,organizationMatches:org(company?.OrganisationNumber)==="5590824800"}));
  return err("Wrong production company",409);
 }
 if(!invoice||String(invoice.DocumentNumber)!==number||invoice.Cancelled===true||invoice.Credit===true||invoice.Currency!=="SEK"||![invoice.ExternalInvoiceReference1,invoice.YourReference].includes(reference))return err("Official invoice identity/reference/status mismatch",409);
 if(cents(invoice.Total)!==cents(job.request_summary?.total)||cents(invoice.TotalVAT)!==cents(job.request_summary?.vat))return err("Official invoice amount differs from linked operation",409);
 if(customer.customer_type==="company"&&org(invoice.OrganisationNumber)!==org(customer.personal_or_org_number))return err("Official organization number mismatch",409);
 const rows=(invoice.InvoiceRows||[]).filter((r:any)=>Number(r.DeliveredQuantity)>0);
 const originals=job.request_summary?.rows||[];
 if(!rows.length||rows.length!==originals.length||rows.some((r:any,i:number)=>Number(r.DeliveredQuantity)!==Number(originals[i].quantity)||cents(r.Price)!==cents(originals[i].unitPrice)||Number(r.Discount||0)!==0||Number(r.VAT)!==25))return err("Official invoice rows differ from linked operation",409);
 const net=rows.reduce((sum:number,r:any)=>sum+Number(r.DeliveredQuantity)*Number(r.Price),0);
 const {data:quotes,error:quotesError}=await admin.from("quotes").select("id").eq("work_order_id",order.id).eq("status","approved");
 if(quotesError||quotes?.length!==1)return err("Approved line classification unavailable",409);
 const {data:items,error:itemsError}=await admin.from("quote_items").select("description,quantity,unit_price,item_type").eq("quote_id",quotes[0].id);
 if(itemsError)return err("Approved invoice lines unavailable",409);
 const rowTypes=originals.map((r:any)=>{
  const matches=(items||[]).filter((x:any)=>fortnoxDescription(x.description)===fortnoxDescription(r.description)&&Number(x.quantity)===Number(r.quantity)&&cents(x.unit_price)===cents(r.unitPrice));
  const types=[...new Set(matches.map((x:any)=>x.item_type))];
  return types.length===1?types[0]:null;
 });
 if(rowTypes.some((t:any)=>!["service","part"].includes(t)))return err("Work/parts classification mismatch; document blocked",409);
 if(cents(net+Number(invoice.TotalVAT)+Number(invoice.RoundOff||0))!==cents(invoice.Total))return err("Official invoice totals do not reconcile",409);
 const required={OCR:invoice.OCR,InvoiceDate:invoice.InvoiceDate,DueDate:invoice.DueDate,CustomerName:invoice.CustomerName,Address:invoice.Address1||invoice.Address2,ZipCode:invoice.ZipCode,City:invoice.City,CompanyBG:company.BG,CompanyAddress:company.Address,CompanyZipCode:company.ZipCode,CompanyCity:company.City,CompanyVATNumber:company.VATNumber};
 const missing=Object.entries(required).filter(([,value])=>!value).map(([key])=>key);
 if(missing.length)return err("Official billing or bank details incomplete: "+missing.join(", "),409);
 const {data:vehicle,error:vehicleError}=await admin.from("vehicles").select("registration_plate,make,model,model_year,vin").eq("id",order.vehicle_id).eq("workshop_id",member.workshop_id).maybeSingle();
 if(vehicleError)return err("Vehicle details unavailable",409);
 // Use the invoice's billing snapshot, not today's editable customer card.
 return reply({ok:true,invoiceCreated:false,sent:false,booked:false,document:{
  fortnox_production:true,invoice_number:number,ocr:String(invoice.OCR),created_at:invoice.InvoiceDate,due_at:invoice.DueDate,
  reference,total:Number(invoice.Total),subtotal:net,vat_total:Number(invoice.TotalVAT),round_off:Number(invoice.RoundOff||0),payment_terms:String(invoice.TermsOfPayment||""),
  customer:{name:invoice.CustomerName,address:invoice.Address1||invoice.Address2,address2:invoice.Address1?invoice.Address2||"":"",postal_code:invoice.ZipCode,city:invoice.City,organisation_number:customer.customer_type==="company"?invoice.OrganisationNumber:null,email:invoice.EmailInformation?.EmailAddressTo||""},
  company:{name:company.CompanyName,address:company.Address,postal_code:company.ZipCode,city:company.City,organisation_number:company.OrganisationNumber,vat_number:company.VATNumber,bankgiro:company.BG,email:company.Email||"",phone:company.Phone1||"",tax_enabled:company.TaxEnabled===true},
  vehicle:{...vehicle,mileage:order.mileage??null},
  rows:rows.map((r:any,i:number)=>({id:String(r.RowId||i),description:r.Description,quantity:Number(r.DeliveredQuantity),unit_price:Number(r.Price),item_type:rowTypes[i]})),
  bookkeeping:{accountingMethod:await invoiceAccountingMethod(invoice,h),booked:invoice.Booked===true,balance:invoice.Balance==null?null:Number(invoice.Balance),voucherNumber:invoice.VoucherNumber||null,sentInFortnox:invoice.Sent===true},
  checked_at:new Date().toISOString(),company_settings_source:settingsSource
 }});
}

function smtpConfiguration(){
 const host=Deno.env.get("SMTP_HOSTNAME")||Deno.env.get("SMTP_HOST")||"smtp.gmail.com";
 const user=Deno.env.get("SMTP_USERNAME")||Deno.env.get("SMTP_USER")||"bildiagnosiutbyab@gmail.com";
 const rawPass=Deno.env.get("SMTP_PASSWORD")||"";
 const pass=host==="smtp.gmail.com"?rawPass.replace(/\s/g,""):rawPass,from=Deno.env.get("SMTP_FROM")||user;
 const port=Number(Deno.env.get("SMTP_PORT")||465);
 return {host,user,pass,from,port,configured:Boolean(host&&user&&pass&&from&&port===465)};
}
async function verifyWorkshopEmail(){
 const config=smtpConfiguration();
 if(!config.configured)return err("Falta guardar la contraseña de aplicación del correo del taller.",409);
 let transport:any;
 try{
  const {default:nodemailer}=await import("npm:nodemailer@10.3.1");
  transport=nodemailer.createTransport({host:config.host,port:config.port,secure:true,auth:{user:config.user,pass:config.pass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true});
  await transport.verify();
  return reply({ok:true,verified:true,account:config.from,sent:false,message:"Correo del taller conectado. No se ha enviado ningún mensaje."});
 }catch(e){
  const code=/^[A-Z]{2,20}$/.test(String((e as any)?.code||""))?String((e as any).code):"CONNECTION";
  return err("No se pudo verificar el correo del taller ("+code+"). Comprueba la contraseña de aplicación de Gmail.",502);
 }finally{transport?.close();}
}
async function emailDelivery(admin:any,orderId:string){
 const {data,error}=await admin.from("invoice_email_deliveries").select("status,recipient,document_number,channel,message_id,sent_at,created_at").eq("work_order_id",orderId).maybeSingle();
 if(error)throw new Error("Email delivery history unavailable; sending blocked");
 return data;
}
async function prepareInvoiceEmail(admin:any,member:any,order:any,job:any){
 if(!job?.fortnox_document_number||job.status!=="submitted")throw new Error("A linked production invoice is required");
 if(job.sent_at||job.send_attempted_at||await emailDelivery(admin,order.id))throw new Error("Invoice already sent or send attempt exists; do not resend");
 const response=await invoiceDocument(admin,member,order,job),body=await response.json();
 if(!body.ok||!body.document)throw new Error(body.error||"Official document unavailable");
 const document=body.document;
 const {data:customer,error}=await admin.from("customers").select("email,billing_details").eq("id",order.customer_id).eq("workshop_id",member.workshop_id).single();
 const recipient=String(document.customer.email||customer?.billing_details?.invoice_email||customer?.email||"").trim().toLowerCase();
 if(error||!/^[-+.\w]+@[-.\w]+\.[A-Za-z]{2,}$/.test(recipient))throw new Error("A single valid customer invoice email is required");
 const {invoicePdf}=await import("./invoice-pdf.ts");
 const bytes=await invoicePdf(document);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
 const filename="Faktura-"+document.invoice_number+"-"+String(document.vehicle.registration_plate||order.order_number).replace(/[^A-Za-z0-9-]/g,"")+".pdf";
 return {document,recipient,bytes,hash,filename};
}
async function sendInvoiceEmail(admin:any,member:any,order:any,job:any,input:any){
 const config=smtpConfiguration();
 if(!config.configured)return err("Conecta el correo del taller antes de enviar desde Bildiagnos.",409);
 const preview=await prepareInvoiceEmail(admin,member,order,job),d=preview.document;
 if(String(input.confirmDocumentNumber)!==String(d.invoice_number)||String(input.confirmRecipient).toLowerCase()!==preview.recipient||input.confirmPdfHash!==preview.hash||cents(input.confirmTotal)!==cents(d.total))return err("PDF, recipient or amount changed; review a fresh preview before sending",409);
 if(config.from.toLowerCase()!==String(d.company.email).toLowerCase())return err("Configured sender differs from the verified workshop email",409);
 // Claim before touching SMTP. Never retry an ambiguous attempt automatically.
 const now=new Date().toISOString();
 const {data:claim,error:claimError}=await admin.from("fortnox_invoice_jobs").update({send_attempted_at:now}).eq("id",job.id).is("sent_at",null).is("send_attempted_at",null).select("id").maybeSingle();
 if(claimError||!claim)return err("Email already claimed; inspect delivery history",409);
 const {data:delivery,error:deliveryError}=await admin.from("invoice_email_deliveries").insert({workshop_id:member.workshop_id,work_order_id:order.id,job_id:job.id,document_number:String(d.invoice_number),recipient:preview.recipient,pdf_sha256:preview.hash,status:"sending",channel:"workshop_smtp"}).select("id").single();
 if(deliveryError||!delivery)return err("Delivery reservation could not be stored; reconcile before retry",409);
 try{
  const {default:nodemailer}=await import("npm:nodemailer@10.3.1");
  const {Buffer}=await import("node:buffer");
  const transport=nodemailer.createTransport({host:config.host,port:config.port,secure:true,auth:{user:config.user,pass:config.pass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true});
  const message=await transport.sendMail({from:config.from,to:preview.recipient,subject:"Faktura "+d.invoice_number+" - "+(d.vehicle.registration_plate||d.reference)+" - "+d.company.name,text:"Hej!\n\nBifogat finns faktura "+d.invoice_number+" för "+(d.vehicle.registration_plate||d.reference)+".\nBelopp: "+Number(d.total).toFixed(2)+" SEK inklusive moms.\nFörfallodatum: "+d.due_at+"\nOCR: "+d.ocr+"\nBankgiro: "+d.company.bankgiro+"\n\nMed vänlig hälsning\n"+d.company.name,attachments:[{filename:preview.filename,content:Buffer.from(preview.bytes),contentType:"application/pdf"}]});
  if(!message.messageId||!message.accepted?.some((x:any)=>String(x).toLowerCase()===preview.recipient))throw new Error("Mail server acceptance unavailable");
  const sentAt=new Date().toISOString();
  const {error:saveError}=await admin.from("invoice_email_deliveries").update({status:"sent",sent_at:sentAt,message_id:message.messageId}).eq("id",delivery.id).eq("status","sending");
  if(saveError)throw new Error("Mail accepted but delivery receipt could not be saved");
  const {error:jobError}=await admin.from("fortnox_invoice_jobs").update({sent_at:sentAt}).eq("id",job.id).is("sent_at",null);
  if(jobError)throw new Error("Mail accepted but invoice status could not be saved");
  return reply({ok:true,sent:true,documentNumber:String(d.invoice_number),recipient:preview.recipient,messageId:message.messageId,sentAt,booked:false});
 }catch{
  await admin.from("invoice_email_deliveries").update({status:"uncertain",error_message:"Email outcome requires manual verification; do not retry automatically"}).eq("id",delivery.id).eq("status","sending");
  return err("No se pudo confirmar el envío. Comprueba el correo antes de reintentar; el intento queda bloqueado.",502);
 }
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return err("POST required",405);
 try{
  const auth=req.headers.get("authorization")||"";
  if(!auth.toLowerCase().startsWith("bearer "))return err("Sign in required",401);
  const url=requireEnv("SUPABASE_URL");
  const admin=createClient(url,requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const userClient=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")||requireEnv("SUPABASE_PUBLISHABLE_KEY"),{global:{headers:{Authorization:auth}}});
  const {data:{user},error:authError}=await userClient.auth.getUser();
  if(authError||!user)return err("Invalid session",401);
  const {data:member,error:memberError}=await admin.from("workshop_members").select("workshop_id,role").eq("user_id",user.id).limit(1).maybeSingle();
  if(memberError||!member||!["owner","admin"].includes(member.role))return err("Admin role required",403);
  const input=await req.json().catch(()=>({}));
  const orderId=String(input.workOrderId||"");
  const action=String(input.action||"preview");
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(orderId))return err("Valid order ID required");
  if(!["preview","create","status","document","email-verify","email-preview","email-send","send","reconcile","bookkeep","recover700200","diagnose700200"].includes(action))return err("Unsupported action");
  const {data:order}=await admin.from("work_orders").select("*").eq("id",orderId).eq("workshop_id",member.workshop_id).maybeSingle();
  if(!order)return err("Order not found",404);
  const {data:existingJob}=await admin.from("fortnox_invoice_jobs").select("*").eq("work_order_id",orderId).maybeSingle();
  if(action==="email-verify")return await verifyWorkshopEmail();
  if(action==="status")return reply({ok:true,email:{configured:smtpConfiguration().configured,delivery:await emailDelivery(admin,orderId)},job:existingJob&&{status:existingJob.status,documentNumber:existingJob.fortnox_document_number,ocr:existingJob.ocr,invoiceStatus:existingJob.invoice_status,sentAt:existingJob.sent_at,sendAttemptedAt:existingJob.send_attempted_at,bookedAt:existingJob.booked_at,bookkeepAttemptedAt:existingJob.bookkeep_attempted_at,bookkeepError:existingJob.bookkeep_error}});
  if(action==="email-preview"){
   const p=await prepareInvoiceEmail(admin,member,order,existingJob);
   let raw="";for(const byte of p.bytes)raw+=String.fromCharCode(byte);
   return reply({ok:true,documentNumber:p.document.invoice_number,total:p.document.total,recipient:p.recipient,pdfHash:p.hash,filename:p.filename,pdfBase64:btoa(raw)});
  }
  if(action==="email-send"||action==="send")return await sendInvoiceEmail(admin,member,order,existingJob,input);
  if(action==="document"){
   try {
    const result=await invoiceDocument(admin,member,order,existingJob);
    if(result.status>=400)console.error(JSON.stringify({event:"invoice_document_blocked",error:(await result.clone().json()).error}));
    return result;
   }catch(e){
    const message=e instanceof Error?e.message:"Document retrieval failed";
    console.error(JSON.stringify({event:"invoice_document_failed",error:sanitizeFortnoxMessage(message)}));
    return err(message,502);
   }
  }
  if(action==="recover700200")return await recover700200(admin,member,order,existingJob,input);
  if(action==="diagnose700200")return await diagnose700200(admin,member,order,input);
  if(action==="reconcile"){
   if(!existingJob||existingJob.status!=="failed"||existingJob.fortnox_document_number||existingJob.error_message!=="Valid company organization number required")return err("Job not eligible for recovery",409);
   const reference="BOS-"+order.order_number;
   if(reference!=="BOS-700201"||input.confirmReference!==reference)return err("Explicit reference confirmation required",409);
   const {data:localInvoices,error:invoiceError}=await admin.from("invoices").select("id").eq("work_order_id",orderId);
   const {data:links,error:linkError}=await admin.from("fortnox_links").select("id").eq("work_order_id",orderId);
   if(invoiceError||linkError||localInvoices?.length||links?.length)return err("Existing local invoice or unavailable local reconciliation",409);
   const {data:quotes,error:quoteError}=await admin.from("quotes").select("status,subtotal,vat_total,total").eq("work_order_id",orderId).eq("status","approved");
   if(quoteError||quotes?.length!==1||cents(quotes[0].subtotal)!==8000||cents(quotes[0].vat_total)!==2000||cents(quotes[0].total)!==10000)return err("Expected approved quote 80+20=100 SEK not verified",409);
   const {data:authz}=await admin.from("fortnox_production_authorizations").select("tenant_id,company_name").eq("workshop_id",member.workshop_id).eq("status","verified").order("verified_at",{ascending:false}).limit(1).maybeSingle();
   if(!authz?.tenant_id||authz.company_name!=="Bildiagnos i Utby AB")return err("Fortnox production authorization missing",403);
   const h=await fortnoxAccess(authz.tenant_id);
   const company=(await api("/companyinformation",h)).CompanyInformation;
   if(String(company?.CompanyName||"")!=="Bildiagnos i Utby AB")return err("Wrong Fortnox tenant",409);
   const found=await findInvoiceByReference(h,reference);
   if(found)return reply({ok:false,existingInvoiceNumber:found,error:"Existing invoice found; do not retry, link manually"},409);
   // The audit has a unique index on job_id. Preserve earlier evidence and append this
   // successful Fortnox check instead of inserting a second row for the same job.
   const {data:priorAudit,error:priorAuditError}=await admin.from("fortnox_invoice_recovery_audit")
     .select("id,reference,checked_at,check_details").eq("job_id",existingJob.id).maybeSingle();
   if(priorAuditError)return err("Audit lookup failed; not reconciled",409);
   if(priorAudit && priorAudit.reference!==reference)return err("Audit reference conflict; not reconciled",409);
   const now=new Date().toISOString();
   const check={method:"fortnox_reference_filtered_search",result:"none_found",company:"Bildiagnos i Utby AB"};
   let auditError:any=null;
   if(priorAudit){
     const prior=priorAudit.check_details||{};
     const earlier=Array.isArray(prior.previous_checks)?prior.previous_checks:[];
     const priorCheck={checked_at:priorAudit.checked_at,check_details:Object.fromEntries(Object.entries(prior).filter(([k])=>k!=="previous_checks"))};
     const result=await admin.from("fortnox_invoice_recovery_audit")
       .update({checked_at:now,check_details:{...check,previous_checks:[...earlier,priorCheck]}})
       .eq("id",priorAudit.id).eq("job_id",existingJob.id).eq("reference",reference).select("id").single();
     auditError=result.error||(!result.data?new Error("Audit update yielded no row"):null);
   }else{
     const result=await admin.from("fortnox_invoice_recovery_audit").insert({
       workshop_id:member.workshop_id,work_order_id:orderId,job_id:existingJob.id,
       original_status:existingJob.status,original_error:existingJob.error_message,
       original_document_number:existingJob.fortnox_document_number,reference,
       checked_at:now,check_details:check
     });
     auditError=result.error;
   }
   if(auditError)return err("Audit write failed; not reconciled",409);
   const {data:changed,error:updateError}=await admin.from("fortnox_invoice_jobs").update({status:"reconciled",updated_at:new Date().toISOString()}).eq("id",existingJob.id).eq("status","failed").is("fortnox_document_number",null).select("id").maybeSingle();
   if(updateError||!changed)return err("State change failed; do not retry",409);
   return reply({ok:true,reconciled:true,invoiceCreated:false,reference});
  }

  if(action==="bookkeep"){
   if(!existingJob?.fortnox_document_number||existingJob.status!=="submitted"||!existingJob.sent_at)return err("Only existing sent invoices can be booked",409);
   if(input.confirmDocumentNumber!==existingJob.fortnox_document_number)return err("Explicit invoice number confirmation required",409);
   const {data:authorization}=await admin.from("fortnox_production_authorizations").select("tenant_id").eq("workshop_id",member.workshop_id).eq("status","verified").order("verified_at",{ascending:false}).limit(1).maybeSingle();
   if(!authorization?.tenant_id)return err("Fortnox production authorization missing",403);
   const h=await fortnoxAccess(authorization.tenant_id);
   try{return reply({ok:true,...await bookkeepInvoice(admin,existingJob,h),documentNumber:existingJob.fortnox_document_number});}
   catch(e){return err((e instanceof Error?e.message:"Bookkeeping status unknown")+"; do not retry until reconciled",409);}
  }
  if(existingJob&&existingJob.status!=="reconciled")return reply({ok:false,duplicate:true,jobStatus:existingJob.status,documentNumber:existingJob.fortnox_document_number||null,error:"An invoice operation already exists for this order. Manual reconciliation required before retry."},409);
  const {data:localInvoices}=await admin.from("invoices").select("id,status,fortnox_reference").eq("work_order_id",orderId);
  if(localInvoices?.some((x:any)=>!["cancelled","credited"].includes(x.status)))return err("Order already has a local invoice; reconcile before issuing in Fortnox",409);
  const {data:quotes}=await admin.from("quotes").select("*").eq("work_order_id",orderId).eq("status","approved").order("approved_at",{ascending:false}).limit(1);
  const quote=quotes?.[0];
  if(!quote)return err("Approved quote required");
  const {data:lines,error:lineError}=await admin.from("quote_items").select("description,quantity,unit_price,vat_rate").eq("quote_id",quote.id);
  if(lineError||!lines?.length)return err("Approved quote has no invoice rows");
  if(lines.some((l:any)=>!l.description||Number(l.quantity)<=0||Number(l.unit_price)<0||Math.abs(vatFraction(l.vat_rate)-0.25)>0.00001))return err("Invalid rows or VAT; review invoice lines");
  const subtotal=lines.reduce((s:number,l:any)=>s+cents(Number(l.quantity)*Number(l.unit_price)),0);
  const quoteSubtotal=cents(quote.subtotal), quoteTotal=cents(quote.total);
  if(subtotal!==quoteSubtotal||Math.abs(quoteTotal-Math.round(subtotal*1.25))>2||quoteTotal<=0)return err("Quote total/VAT mismatch; review before invoicing");
  // This repaired order is approved only for 5,565 SEK including 25% VAT.
  if(Number(order.order_number)===700200 && (order.id!=="d678b517-6a3c-4cab-8d55-afc92060afab" || String(order.plate_snapshot||"").toUpperCase()!=="JAK77J" || quoteSubtotal!==445200 || cents(quote.vat_total)!==111300 || quoteTotal!==556500))return err("Order 700200 / JAK77J requires exactly 4452 + 1113 VAT = 5565 SEK",409);
  const {data:customer}=await admin.from("customers").select("*").eq("id",order.customer_id).eq("workshop_id",member.workshop_id).maybeSingle();
  if(!customer)return err("Customer missing");
  // Customer creation is strictly limited to explicit invoice creation; preview never writes.
  const {data:linked}=await admin.from("fortnox_customer_links").select("fortnox_customer_number").eq("workshop_id",member.workshop_id).eq("customer_id",customer.id).eq("environment","production").maybeSingle();
  let customerNumber=linked?.fortnox_customer_number||null;
  const {data:authorization}=await admin.from("fortnox_production_authorizations").select("tenant_id,company_name").eq("workshop_id",member.workshop_id).eq("status","verified").order("verified_at",{ascending:false}).limit(1).maybeSingle();
  if(!authorization?.tenant_id||authorization.company_name!=="Bildiagnos i Utby AB")return err("Production Fortnox authorization not verified");
  const reference="BOS-"+order.order_number;
  const preview={orderNumber:order.order_number,customerNumber:String(customerNumber),customerName:customer.display_name,reference,total:quote.total,vat:quote.vat_total,rows:lines.map((l:any)=>({description:l.description,quantity:Number(l.quantity),unitPrice:Number(l.unit_price),vatRate:vatFraction(l.vat_rate)}))};
  if(action==="preview")return reply({ok:true,dryRun:true,mode:"production_preview",preview,message:"No invoice created or sent"});
  if(input.confirmReference!==reference)return err("Explicit order reference confirmation required");
  if(cents(input.confirmTotal)!==quoteTotal)return err("Confirm the current invoice total before creation",409);
  // Unique work_order_id is the idempotency barrier. Never automatically retry a reserved/uncertain job.
  // Always reconcile Fortnox before reserving a first attempt or a recovered attempt.
  {
   const {data:authz}=await admin.from("fortnox_production_authorizations").select("tenant_id").eq("workshop_id",member.workshop_id).eq("status","verified").order("verified_at",{ascending:false}).limit(1).maybeSingle();
   if(!authz?.tenant_id) return err("Production authorization missing",403);
   const h=await fortnoxAccess(authz.tenant_id);
   const found=await findInvoiceByReference(h,reference);
   if(found)return err("Fortnox invoice already exists; creation blocked",409);
  }
  const reservation=existingJob?.status==="reconciled"
    ?await admin.from("fortnox_invoice_jobs").update({status:"reserved",updated_at:new Date().toISOString()}).eq("id",existingJob.id).eq("status","reconciled").select("id").single()
    :await admin.from("fortnox_invoice_jobs").insert({workshop_id:member.workshop_id,work_order_id:orderId,status:"reserved",request_summary:preview}).select("id").single();
  const {data:job,error:reservationError}=reservation;
  if(reservationError||!job)return err("Invoice already reserved or database lock failed; do not retry",409);
  let attempted=false;
  try{
   const basic=btoa(requireEnv("FORTNOX_CLIENT_ID")+":"+requireEnv("FORTNOX_CLIENT_SECRET"));
   const tokenRes=await fetch("https://apps.fortnox.se/oauth-v1/token",{method:"POST",headers:{authorization:"Basic "+basic,"content-type":"application/x-www-form-urlencoded",TenantId:authorization.tenant_id},body:new URLSearchParams({grant_type:"client_credentials",scope:"companyinformation customer invoice article payment"})});
   if(!tokenRes.ok)throw new Error("Fortnox authentication failed: "+tokenRes.status);
   const access=String((await tokenRes.json()).access_token||"");
   if(!access)throw new Error("Fortnox access token absent");
   const companyRes=await fetch("https://api.fortnox.se/3/companyinformation",{headers:{Authorization:"Bearer "+access,Accept:"application/json"}});
   if(!companyRes.ok)throw new Error("Cannot verify production company");
   const companyBody=await companyRes.json();
   if(String((companyBody.CompanyInformation||companyBody).CompanyName||"")!=="Bildiagnos i Utby AB")throw new Error("Wrong Fortnox company; blocked");
   if(!customerNumber){
     const identifier=customer.customer_type==="person"?"person:"+customer.id:org(customer.personal_or_org_number);
     if(customer.customer_type==="company"&&org(customer.personal_or_org_number).length!==10)throw new Error("Valid company organization number required");
     if(!["person","company"].includes(customer.customer_type))throw new Error("Unknown customer type");
     const {error:lockError}=await admin.from("fortnox_customer_sync_locks").insert({workshop_id:member.workshop_id,organisation_number:identifier,customer_id:customer.id,status:"reserved"});
     if(lockError)throw new Error("Customer sync already reserved or requires reconciliation; do not retry");
     customerNumber=await resolveCustomer(admin,member,customer,{Authorization:"Bearer "+access,Accept:"application/json"},true);
     await admin.from("fortnox_customer_sync_locks").update({status:"linked",fortnox_customer_number:String(customerNumber)}).eq("workshop_id",member.workshop_id).eq("organisation_number",identifier);
   }
   if(!customerNumber)throw new Error("Fortnox customer unresolved");
   const body=buildInvoicePayload(customerNumber,reference,lines,order.order_number);
   attempted=true;
   const result=await fetch("https://api.fortnox.se/3/invoices",{method:"POST",headers:{Authorization:"Bearer "+access,Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(body)});
   const parsed=await readFortnoxResponse(result);
   const payload=parsed.payload;
   if(!result.ok)throw fortnoxFailure(result.status,payload,"POST /invoices",[...payloadValues(body),...payloadValues(customer),access,basic],parsed);
   const number=String(payload?.Invoice?.DocumentNumber||"");
   if(!number)throw new Error("Fortnox response lacks invoice number; reconcile manually");
   const {data:saved,error:saveError}=await admin.from("fortnox_invoice_jobs").update({status:"submitted",fortnox_document_number:number,ocr:String(payload?.Invoice?.OCR||""),invoice_status:String(payload?.Invoice?.Status||"created"),updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","reserved").select("id").maybeSingle();
   if(saveError||!saved)throw new Error("Fortnox invoice created but persistence failed; manual reconciliation required");
   return reply({ok:true,created:true,sent:false,documentNumber:number,ocr:String(payload?.Invoice?.OCR||""),invoiceStatus:String(payload?.Invoice?.Status||"created"),reference});
  }catch(e){
   const message=e instanceof Error?e.message:"Unknown error";
   await admin.from("fortnox_invoice_jobs").update({status:attempted?"uncertain":"failed",error_message:message,updated_at:new Date().toISOString()}).eq("id",job.id);
   return err(message+"; reserved job retained: do not retry automatically",502);
  }
 }catch(e){return err(e instanceof Error?e.message:"Unexpected error",500);}
});

