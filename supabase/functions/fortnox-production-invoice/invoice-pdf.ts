import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

export async function invoicePdf(d:any){
 const pdf=await PDFDocument.create();
 const stamp=new Date(d.created_at+"T12:00:00Z");
 pdf.setCreationDate(stamp);pdf.setModificationDate(stamp);pdf.setTitle("Faktura "+d.invoice_number);pdf.setAuthor(d.company.name);pdf.setProducer("Bildiagnos OS");pdf.setCreator("Bildiagnos OS");
 const normal=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const cash=(v:any)=>Number(v).toLocaleString("sv-SE",{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/\u00a0/g," ");
 let page:any,y=0;
 const text=(s:any,x:number,at:number,size=9,b=false)=>page.drawText(String(s??""),{x,y:at,size,font:b?bold:normal,color:rgb(.06,.06,.06)});
 const line=(at:number)=>page.drawLine({start:{x:38,y:at},end:{x:557,y:at},thickness:.5,color:rgb(.5,.5,.5)});
 const wrap=(s:any,width:number,size=9)=>{
  const result:string[]=[];let current="";
  for(const word of String(s??"").split(/\s+/)){
   if(normal.widthOfTextAtSize((current?current+" ":"")+word,size)>width&&current){result.push(current);current=word;}else current+=(current?" ":"")+word;
  }
  if(current)result.push(current);return result;
 };
 const footer=()=>{
  line(92);text(d.company.name,38,77,9,true);text(d.company.address,38,64,8);text(d.company.postal_code+" "+d.company.city,38,52,8);
  text("Org.nr: "+d.company.organisation_number,230,77,8);text("VAT.nr: "+d.company.vat_number,230,64,8);if(d.company.tax_enabled)text("Godkänd för F-skatt",230,52,8);
  text("Bankgiro: "+d.company.bankgiro,410,77,8);text(d.company.phone,410,64,8);text(d.company.email,410,52,7);
 };
 const newPage=()=>{page=pdf.addPage([595.28,841.89]);y=797;text("BILDIAGNOS I UTBY AB",38,y,18,true);text("FAKTURA",365,y,20,true);text("Nr: "+d.invoice_number,475,y-19,10,true);line(y-35);y-=58;footer();};
 newPage();
 text("Ordernr: "+d.reference.replace("BOS-",""),38,y);text("Fakturadatum: "+d.created_at,215,y);text("Förfallodatum: "+d.due_at,400,y);y-=22;
 text("Representation av Fortnox faktura "+d.invoice_number+". Samma faktura - ingen ny betalningsfordran.",38,y,8);y-=29;
 text("Faktureringsadress",38,y,8);y-=16;text(d.customer.name,38,y,11,true);y-=15;
 for(const address of [d.customer.address,d.customer.address2,d.customer.postal_code+" "+d.customer.city,d.customer.organisation_number?"Organisationsnummer: "+d.customer.organisation_number:""]){if(address){text(address,38,y);y-=14;}}
 y-=16;line(y);y-=15;
 const v=d.vehicle||{};
 const fields=[["Reg nr",v.registration_plate],["Fabrikat",v.make],["Modell",v.model],["Årsmodell",v.model_year],["Mätarställning",v.mileage==null?"":v.mileage+" km"]];
 fields.forEach(([label,value],i)=>{text(label,38+i*104,y,7);text(value,38+i*104,y-16,9,true);});y-=34;
 text("Chassinummer: "+(v.vin||""),38,y,9);y-=13;line(y);y-=28;
 for(const [type,title] of [["service","Utfört arbete"],["part","Artiklar"]]){
  if(y<180){newPage();}text(title,38,y,11,true);y-=21;text("Beskrivning",38,y,8,true);text(type==="service"?"Timmar":"Antal",366,y,8,true);text("Pris/st",425,y,8,true);text("Belopp",508,y,8,true);y-=7;line(y);y-=17;
  for(const row of d.rows.filter((r:any)=>r.item_type===type)){
   const desc=wrap(row.description,305);const height=Math.max(18,desc.length*12+6);
   if(y-height<116){newPage();text(title+" (forts.)",38,y,11,true);y-=24;}
   desc.forEach((s:string,i:number)=>text(s,38,y-i*12));text(cash(row.quantity)+(type==="service"?" h":""),366,y,8);text(cash(row.unit_price),425,y,8);text(cash(row.quantity*row.unit_price),508,y,8);y-=height;
  }
  y-=21;
 }
 if(y<266)newPage();
 y=Math.min(y,266);const summary=y;
 text("Ange OCR-nr vid betalning:",38,summary-15,9,true);text(d.ocr,38,summary-31,11,true);text("Bankgiro: "+d.company.bankgiro,38,summary-49,10,true);text("Förfallodatum: "+d.due_at,38,summary-66);text("Betalningsvillkor: "+d.payment_terms+" dagar netto",38,summary-82);
 let sy=summary;text("Summering",360,sy,12,true);sy-=22;
 for(const [label,value] of [["Summa exkl. moms",d.subtotal],["Moms 25%",d.vat_total],...(d.round_off?[["Öresutjämning",d.round_off]]:[])]){text(label,360,sy);text(cash(value)+" kr",494,sy,9,true);sy-=17;}
 line(sy+4);text("Att betala",360,sy-17,12,true);text(cash(d.total)+" kr",474,sy-17,12,true);
 return await pdf.save({useObjectStreams:false});
}
