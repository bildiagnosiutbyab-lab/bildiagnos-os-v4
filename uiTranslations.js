const pairs = [
  ['Översikt','Inicio'],['Verkstadens sammanfattning','Resumen del taller'],['Öppna arbetsorder','Órdenes abiertas'],['Fordon idag','Vehículos hoy'],['Obetalda fakturor','Facturas pendientes'],['Registrerade timmar','Horas registradas'],
  ['Mål denna månad','Meta de este mes'],['Försäljning exkl. moms mot målet 60 000 kr','Facturación sin IVA hacia la meta de 60.000 kr'],['Försäljning exkl. moms','Facturación sin IVA'],['Kvar till målet','Falta para la meta'],['Behövs per dag','Necesario por día'],['Arbete','Trabajo'],['Delar, försäljning','Piezas, venta'],['Delar, inköpskostnad','Piezas, coste'],['Moms','IVA'],['Målet räknas exklusive moms. Moms visas separat och räknas inte som verkstadens intäkt.','La meta se calcula sin IVA. El IVA se muestra aparte y no cuenta como ingreso del taller.'],
  ['Dagens arbeten','Trabajos de hoy'],['Öppna Arbetsorder för att se fordon och uppdatera arbeten.','Abre Órdenes para ver los vehículos y actualizar los trabajos.'],
  ['Arbetsorder','Órdenes'],['Kunder','Clientes'],['Fordon','Vehículos'],['Reservdelar','Piezas'],['Lager','Inventario'],['Kalender','Calendario'],['Verkstadsystem','Sistema del taller'],
  ['Ny arbetsorder','Nueva orden'],['Kund','Cliente'],['Registreringsnummer','Matrícula'],['Mätarställning','Kilometraje'],['Beställt arbete','Trabajo solicitado'],['Orderstatus','Estado de la orden'],['Spara arbetsorder','Guardar orden'],['Spara ändringar','Guardar cambios'],['Avbryt','Cancelar'],['Ta bort arbetsorder','Eliminar orden'],['Historik','Historial'],['Sök historik via registreringsnummer','Buscar historial por matrícula'],
  ['Ingen historik för detta registreringsnummer.','No hay historial para esta matrícula.'],['Inga avslutade arbetsorder','No hay órdenes cerradas'],['Inga avbrutna arbetsorder','No hay órdenes canceladas'],['Inga öppna eller väntande arbetsorder','No hay órdenes abiertas o pendientes'],
  ['Kunduppgifter, fordon och fakturering','Datos del cliente, vehículos y facturación'],['Namn','Nombre'],['Ny kund','Nuevo cliente'],['Kund sparad','Cliente guardado'],['Ingen kontakt registrerad','Sin contacto registrado'],
  ['Nytt fordon','Nuevo vehículo'],['Ingen beskrivning','Sin descripción'],['Reservdelar och lager','Piezas e inventario'],
  ['Artikelnummer','Número de artículo'],['Beskrivning','Descripción'],['Pris','Precio'],['Pris/h','Precio/h'],['Inköpspris','Coste'],['Antal','Cantidad'],['Rabatt %','Desc. %'],['Spara','Guardar'],['Ta bort','Eliminar'],
  ['Lågt lager','Stock bajo'],['Räkna','Contar'],['Uttag registrerat.','Salida registrada.'],['Påfyllning registrerad.','Entrada registrada.'],['Ta ut flera','Quitar varias'],['Lägg till flera','Añadir varias'],['Räknat antal','Cantidad contada'],['Lagerplats','Ubicación'],['Leverantör','Proveedor'],
  ['Ny bokning','Nueva reserva'],['Idag','Hoy'],['Vecka','Semana'],['Månad','Mes'],
  ['Affärsflöde','Flujo comercial'],['Offert, betalning och dokument','Cotización, cobro y documentos'],['Arbeten i arbetsordern','Trabajos de la orden'],['Reservdelar i arbetsordern','Piezas de la orden'],['Kundoffert','Cotización del cliente'],['Förbered offert','Preparar cotización'],['Uppdatera offert','Actualizar cotización'],['Kunden godkänner','Cliente acepta'],['Kunden avvisar','Cliente rechaza'],['Markera reservdelar som beställda','Marcar piezas pedidas'],['Betalning och kvitto','Cobro y recibo'],['Belopp','Importe'],['Referens','Referencia'],['Bekräfta betalning','Confirmar pago'],['Faktura','Factura'],['Skapa faktura','Crear factura'],['Kundens e-post','Correo cliente'],['Betalningsvillkor','Condiciones de pago'],['Förfallodatum','Fecha de vencimiento'],['Skapa testfaktura i Fortnox Test','Crear factura ficticia en Fortnox Test'],['Skriv ut Fortnox Test-faktura','Imprimir factura Fortnox Test'],
  ['Väntar på godkännande','Pendiente de aprobación'],['Godkänd','Aprobado'],['Beställd','Pedido'],['Offert förberedd','Cotización preparada'],['Utkast','Borrador'],['Avvisad','Rechazado'],['Klar','Terminado'],['I offert','En cotización'],
  ['Öresutjämning','Redondeo'],['Att betala','A pagar'],['Total inkl. moms','Total con IVA'],['Exkl. moms','Sin IVA'],['Moms 25%','IVA 25%'],
  ['Svenska','Sueco'],['Español','Español']
];

const svToEs = new Map(pairs);
const esToSv = new Map(pairs.map(([sv, es]) => [es, sv]));

function translateValue(value, language) {
  if (!value) return value;
  const trimmed = value.trim();
  const map = language === 'es' ? svToEs : esToSv;
  const translated = map.get(trimmed);
  if (!translated) return value;
  const lead = value.match(/^\s*/)?.[0] || '';
  const trail = value.match(/\s*$/)?.[0] || '';
  return lead + translated + trail;
}

export function translateUi(root, language) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest('script,style')) continue;
    node.nodeValue = translateValue(node.nodeValue, language);
  }
  for (const el of root.querySelectorAll?.('input,textarea,button,[title],[aria-label]') || []) {
    for (const attr of ['placeholder','title','aria-label']) {
      const value = el.getAttribute?.(attr);
      if (value) el.setAttribute(attr, translateValue(value, language));
    }
  }
}
