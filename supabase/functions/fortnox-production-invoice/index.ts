import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const ORIGIN="https://bildiagnosiutbyab-lab.github.io";
const headers={"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":ORIGIN,"access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"authorization,apikey,content-type,x-client-info"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const err=(message:string,status=400)=>reply({ok:false,error:message},status);
function requireEnv(name:string){const v=Deno.env.get(name);if(!v)throw new Error("Missing server configuration: "+name);return v;}
function cents(v:unknown){return Math.round(Number(v)*100);}
function vatFraction(v:unknown){const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=100?(n>1?n/100:n):NaN;}

async function fortnoxAccess(tenant:string){
 const basic=btoa(requireEnv("FORTNOX_CLIENT_ID")+":"+requireEnv("FORTNOX_CLIENT_SECRET"));
 const r=await fetch("https://apps.fortnox.se/oauth-v1/token",{method:"POST",headers:{authorization:"Basic "+basic,"content-type":"application/x-www-form-urlencoded",TenantId:tenant},body:new URLSearchParams({grant_type:"client_credentials",scope:"companyinformation customer invoice article payment"})});
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
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error("Fortnox "+method+" "+path.split("?")[0]+" HTTP "+r.status);
  return body;
 }
 throw new Error("Fortnox rate limit: retry attempts exhausted");
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
async function recover700200(admin:any,member:any,order:any,job:any,input:any){
 const reference="BOS-700200";
 const target="d678b517-6a3c-4cab-8d55-afc92060afab";
 if(order.id!==target||Number(order.order_number)!==700200||order.plate_snapshot!=="JAK77J"||input.confirmReference!==reference||input.expectedJobId!=="f39d5a07-ebfb-41a3-96e2-67cacaa188d8")return err("Recovery is restricted to the confirmed 700200 / JAK77J attempt",409);
 if(!job||job.id!==input.expectedJobId)return err("Recovery job identity mismatch",409);
 if(job.status==="reconciled"||job.status==="submitted")return reply({ok:true,alreadyRecovered:true,status:job.status,documentNumber:job.fortnox_document_number,ocr:job.ocr,invoiceCreated:false,sent:false});
 if(job.status!=="uncertain"||job.fortnox_document_number||job.error_message!=="Fortnox returned HTTP 400; check Fortnox before retry"||job.send_attempted_at||job.sent_at||job.bookkeep_attempted_at||job.booked_at)return err("Job not eligible for this recovery",409);
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
 const check={method:"production_api_reference_and_customer_search",company:"Bildiagnos i Utby AB",customerNumber:"10004",reference,searches,detailCount:candidates.size,result:invoice?"existing_invoice_found":"none_found",invoice:invoice?{documentNumber:String(invoice.DocumentNumber),ocr:String(invoice.OCR||""),total:Number(invoice.Total),sent:invoice.Sent===true,booked:invoice.Booked===true}:null};
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
  if(!["preview","create","status","send","reconcile","bookkeep","recover700200"].includes(action))return err("Unsupported action");
  const {data:order}=await admin.from("work_orders").select("*").eq("id",orderId).eq("workshop_id",member.workshop_id).maybeSingle();
  if(!order)return err("Order not found",404);
  const {data:existingJob}=await admin.from("fortnox_invoice_jobs").select("*").eq("work_order_id",orderId).maybeSingle();
  if(action==="status")return reply({ok:true,job:existingJob&&{status:existingJob.status,documentNumber:existingJob.fortnox_document_number,ocr:existingJob.ocr,invoiceStatus:existingJob.invoice_status,sentAt:existingJob.sent_at,bookedAt:existingJob.booked_at,bookkeepAttemptedAt:existingJob.bookkeep_attempted_at,bookkeepError:existingJob.bookkeep_error}});
  if(action==="recover700200")return await recover700200(admin,member,order,existingJob,input);
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
  if(action==="send"){
   if(!existingJob?.fortnox_document_number||existingJob.status!=="submitted")return err("Invoice must exist before sending",409);
   if(existingJob.sent_at||existingJob.send_attempted_at)return err("Invoice already sent or send attempt is uncertain; reconcile manually",409);
   if(input.confirmDocumentNumber!==existingJob.fortnox_document_number)return err("Explicit invoice number confirmation required");
   const {data:authorization}=await admin.from("fortnox_production_authorizations").select("tenant_id").eq("workshop_id",member.workshop_id).eq("status","verified").order("verified_at",{ascending:false}).limit(1).maybeSingle();
   if(!authorization?.tenant_id)return err("Fortnox production authorization missing");
   const {data:claimed}=await admin.from("fortnox_invoice_jobs").update({send_attempted_at:new Date().toISOString()}).eq("id",existingJob.id).is("send_attempted_at",null).is("sent_at",null).select("id").maybeSingle();
   if(!claimed)return err("Sending already in progress; check Fortnox",409);
   try{
    const h=await fortnoxAccess(authorization.tenant_id);
    const number=encodeURIComponent(existingJob.fortnox_document_number);
    const current=(await api("/invoices/"+number,h)).Invoice;
    if(!current||current.Sent===true)throw new Error("Invoice already sent or not found");
    const sent=(await api("/invoices/"+number+"/email",h)).Invoice||{};
    const {data:stored,error:storeError}=await admin.from("fortnox_invoice_jobs").update({sent_at:new Date().toISOString(),invoice_status:String(sent.Status||current.Status||"sent")}).eq("id",existingJob.id).is("sent_at",null).select("id").maybeSingle();
    if(storeError||!stored)throw new Error("Fortnox email request succeeded but confirmation could not be saved; reconcile manually");
    // Sending and booking are separately recorded: never resend when booking fails.
    try{
     const refreshed={...existingJob,sent_at:new Date().toISOString()};
     const booked=await bookkeepInvoice(admin,refreshed,h);
     return reply({ok:true,sent:true,...booked,documentNumber:existingJob.fortnox_document_number});
    }catch(e){
     return reply({ok:true,sent:true,booked:false,bookkeepError:e instanceof Error?e.message:"Bookkeeping status uncertain",documentNumber:existingJob.fortnox_document_number});
    }
   }catch(e){return err((e instanceof Error?e.message:"Send status unknown")+"; check Fortnox before any retry",502);}
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
   const invoiceRows=lines.map((l:any)=>({Description:String(l.description),DeliveredQuantity:Number(l.quantity),Price:Number(l.unit_price),VAT:25}));
   const body={Invoice:{CustomerNumber:String(customerNumber),YourReference:reference,InvoiceRows:invoiceRows,Remarks:"Bildiagnos arbetsorder "+order.order_number}};
   attempted=true;
   const result=await fetch("https://api.fortnox.se/3/invoices",{method:"POST",headers:{Authorization:"Bearer "+access,Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(body)});
   const payload=await result.json().catch(()=>({}));
   if(!result.ok)throw new Error("Fortnox returned HTTP "+result.status+"; check Fortnox before retry");
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
