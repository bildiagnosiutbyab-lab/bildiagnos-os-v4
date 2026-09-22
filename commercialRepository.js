import { supabase } from './supabaseClient.js';

const VAT_RATE = 0.25;

function throwIfError(error) {
  if (error) throw error;
}

function quoteTotals(items) {
  const total = items.reduce(
    (sum, item) => sum + Number(item.quantity || 1) * Number(item.unit_price || 0),
    0
  );
  const subtotal = total / (1 + VAT_RATE);
  return { total, subtotal, vatTotal: total - subtotal };
}

async function refreshQuoteTotals(quoteIds) {
  const uniqueIds = [...new Set((quoteIds || []).filter(Boolean))];
  await Promise.all(uniqueIds.map(async (quoteId) => {
    const { data: items, error: itemsError } = await supabase
      .from('quote_items')
      .select('quantity,unit_price,vat_rate')
      .eq('quote_id', quoteId);
    throwIfError(itemsError);
    const totals = (items || []).reduce((result, item) => {
      const gross = Number(item.quantity || 0) * Number(item.unit_price || 0);
      const vatRate = Number(item.vat_rate ?? VAT_RATE);
      const net = vatRate > 0 ? gross / (1 + vatRate) : gross;
      result.total += gross;
      result.subtotal += net;
      result.vatTotal += gross - net;
      return result;
    }, { total: 0, subtotal: 0, vatTotal: 0 });
    const { error: quoteError } = await supabase.from('quotes').update({
      total: totals.total,
      subtotal: totals.subtotal,
      vat_total: totals.vatTotal,
    }).eq('id', quoteId);
    throwIfError(quoteError);
  }));
}

async function linkedQuotes(column, id) {
  const { data, error } = await supabase.from('quote_items').select('quote_id').eq(column, id);
  throwIfError(error);
  const quoteIds = [...new Set((data || []).map((item) => item.quote_id))];
  if (!quoteIds.length) return { editableIds: [], lockedIds: [] };
  const { data: quotes, error: quotesError } = await supabase.from('quotes').select('id,status').in('id', quoteIds);
  throwIfError(quotesError);
  const editableStatuses = new Set(['draft', 'prepared', 'pending_approval']);
  return {
    editableIds: (quotes || []).filter((quote) => editableStatuses.has(quote.status)).map((quote) => quote.id),
    lockedIds: (quotes || []).filter((quote) => !editableStatuses.has(quote.status)).map((quote) => quote.id),
  };
}

export async function loadCommercialOrder(orderId) {
  const { data: workOrder, error: orderError } = await supabase
    .from('work_orders')
    .select('*')
    .eq('id', orderId)
    .single();
  throwIfError(orderError);

  const [servicesResult, partsResult, quotesResult, invoicesResult, paymentsResult] =
    await Promise.all([
      supabase.from('work_order_services').select('*').eq('work_order_id', orderId).order('sort_order'),
      supabase.from('work_order_parts').select('*').eq('work_order_id', orderId).order('created_at'),
      supabase.from('quotes').select('*').eq('work_order_id', orderId).order('created_at', { ascending: false }),
      supabase.from('invoices').select('*').eq('work_order_id', orderId).order('created_at', { ascending: false }),
      supabase.from('payments').select('*').eq('work_order_id', orderId).order('created_at', { ascending: false }),
    ]);

  [servicesResult, partsResult, quotesResult, invoicesResult, paymentsResult].forEach((result) =>
    throwIfError(result.error)
  );

  const quoteIds = (quotesResult.data || []).map((quote) => quote.id);
  const invoiceIds = (invoicesResult.data || []).map((invoice) => invoice.id);
  const [quoteItemsResult, invoiceItemsResult] = await Promise.all([
    quoteIds.length
      ? supabase.from('quote_items').select('*').in('quote_id', quoteIds)
      : Promise.resolve({ data: [], error: null }),
    invoiceIds.length
      ? supabase.from('invoice_items').select('*').in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  throwIfError(quoteItemsResult.error);
  throwIfError(invoiceItemsResult.error);

  return {
    workOrder,
    services: servicesResult.data || [],
    parts: partsResult.data || [],
    quotes: quotesResult.data || [],
    quoteItems: quoteItemsResult.data || [],
    invoices: invoicesResult.data || [],
    invoiceItems: invoiceItemsResult.data || [],
    payments: paymentsResult.data || [],
  };
}

export async function addCommercialService(context, input) {
  const { workOrder } = context;
  const { error } = await supabase.from('work_order_services').insert({
    workshop_id: workOrder.workshop_id,
    work_order_id: workOrder.id,
    description: input.description.trim(),
    quantity: Number(input.quantity || 1),
    estimated_minutes: Math.round(Number(input.hours || 0) * 60) || null,
    unit_price: Number(input.unitPrice || 0),
    vat_rate: VAT_RATE,
    status: 'quote',
    sort_order: context.services.length,
  });
  throwIfError(error);
}

export async function addCommercialPart(context, input) {
  const { workOrder } = context;
  const { error } = await supabase.from('work_order_parts').insert({
    workshop_id: workOrder.workshop_id,
    work_order_id: workOrder.id,
    part_number_snapshot: input.partNumber.trim() || null,
    description_snapshot: input.description.trim(),
    quantity: Number(input.quantity || 1),
    actual_cost: input.cost === '' ? null : Number(input.cost || 0),
    sale_price: Number(input.salePrice || 0),
    discount_percent: input.discount === '' ? null : Number(input.discount || 0),
    vat_rate: VAT_RATE,
    status: 'quote',
  });
  throwIfError(error);
}

export async function updateCommercialService(id, input) {
  const description = String(input.description || '').trim();
  const hours = Number(input.hours);
  const unitPrice = Number(input.unitPrice);
  if (!description) throw new Error('El trabajo necesita una descripción.');
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Las horas deben ser cero o mayores.');
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('El precio debe ser cero o mayor.');

  const quoteLinks = await linkedQuotes('service_id', id);
  const { error } = await supabase.from('work_order_services').update({
    description,
    estimated_minutes: Math.round(hours * 60),
    unit_price: unitPrice,
  }).eq('id', id);
  throwIfError(error);
  if (quoteLinks.editableIds.length) {
    const { error: lineError } = await supabase.from('quote_items').update({
      description,
      unit_price: unitPrice,
    }).eq('service_id', id).in('quote_id', quoteLinks.editableIds);
    throwIfError(lineError);
  }
  await refreshQuoteTotals(quoteLinks.editableIds);
}

export async function updateCommercialPart(id, input) {
  const description = String(input.description || '').trim();
  const quantity = Number(input.quantity);
  const salePrice = Number(input.salePrice);
  const cost = input.cost === '' || input.cost === null ? null : Number(input.cost);
  const discount = input.discount === '' || input.discount === null ? null : Number(input.discount);
  if (!description) throw new Error('La pieza necesita una descripción.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La cantidad debe ser mayor que cero.');
  if (!Number.isFinite(salePrice) || salePrice < 0) throw new Error('El precio debe ser cero o mayor.');
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error('El coste debe ser cero o mayor.');
  if (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount > 100)) throw new Error('El descuento debe estar entre 0 y 100%.');

  const partNumber = String(input.partNumber || '').trim() || null;
  const quoteDescription = [partNumber, description].filter(Boolean).join(' · ');
  const quoteLinks = await linkedQuotes('part_line_id', id);
  const { error } = await supabase.from('work_order_parts').update({
    part_number_snapshot: partNumber,
    description_snapshot: description,
    quantity,
    actual_cost: cost,
    sale_price: salePrice,
    discount_percent: discount,
  }).eq('id', id);
  throwIfError(error);
  if (quoteLinks.editableIds.length) {
    const { error: lineError } = await supabase.from('quote_items').update({
      description: quoteDescription,
      quantity,
      unit_price: salePrice,
    }).eq('part_line_id', id).in('quote_id', quoteLinks.editableIds);
    throwIfError(lineError);
  }
  await refreshQuoteTotals(quoteLinks.editableIds);
}

export async function importCatalogOrderItems({ workOrderId, source, plate, parts, laborItems }) {
  const { data, error } = await supabase.rpc('import_catalog_order_items', {
    p_work_order_id: workOrderId, p_source: source, p_plate: plate || null,
    p_parts: parts, p_labor_items: laborItems,
  });
  throwIfError(error);
  return data;
}

function commercialLines(context) {
  const services = context.services
    .filter((item) => !['rejected', 'removed'].includes(item.status))
    .map((item) => ({
      item_type: 'service',
      description: item.description,
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.unit_price || 0),
      vat_rate: Number(item.vat_rate ?? VAT_RATE),
      service_id: item.id,
      part_line_id: null,
    }));
  const parts = context.parts
    .filter((item) => !['rejected', 'removed'].includes(item.status))
    .map((item) => ({
      item_type: 'part',
      description: [item.part_number_snapshot, item.description_snapshot].filter(Boolean).join(' · '),
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.sale_price || 0),
      vat_rate: Number(item.vat_rate ?? VAT_RATE),
      service_id: null,
      part_line_id: item.id,
    }));
  return [...services, ...parts];
}

export async function prepareCommercialQuote(context, settings) {
  const { workOrder } = context;
  const lines = commercialLines(context);
  const activeServiceIds = context.services.filter((item) => !['rejected', 'removed'].includes(item.status)).map((item) => item.id);
  const activePartIds = context.parts.filter((item) => !['rejected', 'removed'].includes(item.status)).map((item) => item.id);
  if (!lines.length) throw new Error('Añade al menos una operación o una pieza antes de preparar la cotización.');
  const totals = quoteTotals(lines);
  const lastQuote = context.quotes[0];
  const quotePayload = {
    workshop_id: workOrder.workshop_id,
    work_order_id: workOrder.id,
    customer_id: workOrder.customer_id,
    vehicle_id: workOrder.vehicle_id,
    status: 'prepared',
    prepared_at: new Date().toISOString(),
    rejected_at: null,
    approved_at: null,
    subtotal: totals.subtotal,
    vat_total: totals.vatTotal,
    total: totals.total,
    notes: settings.notes || null,
    variable_price: Boolean(settings.variablePrice),
    warranty_enabled: Boolean(settings.warrantyEnabled),
    warranty_months: settings.warrantyEnabled ? Number(settings.warrantyMonths || 0) : null,
    warranty_km: settings.warrantyEnabled ? Number(settings.warrantyKm || 0) : null,
    document_language: settings.documentLanguage || 'sv',
  };

  let quote;
  if (lastQuote && lastQuote.status !== 'approved') {
    const { data, error } = await supabase
      .from('quotes')
      .update(quotePayload)
      .eq('id', lastQuote.id)
      .select()
      .single();
    throwIfError(error);
    quote = data;
    const { error: deleteError } = await supabase.from('quote_items').delete().eq('quote_id', quote.id);
    throwIfError(deleteError);
  } else {
    const { data, error } = await supabase
      .from('quotes')
      .insert({ ...quotePayload, revision: (lastQuote?.revision || 0) + 1 })
      .select()
      .single();
    throwIfError(error);
    quote = data;
  }

  const { error: itemsError } = await supabase
    .from('quote_items')
    .insert(lines.map((line) => ({ ...line, workshop_id: workOrder.workshop_id, quote_id: quote.id })));
  throwIfError(itemsError);

  await Promise.all([
    activeServiceIds.length
      ? supabase.from('work_order_services').update({ status: 'pending_approval' }).in('id', activeServiceIds)
      : Promise.resolve({ error: null }),
    activePartIds.length
      ? supabase.from('work_order_parts').update({ status: 'pending_approval' }).in('id', activePartIds)
      : Promise.resolve({ error: null }),
  ].map(async (result) => throwIfError((await result).error)));

  return quote;
}

export async function decideCommercialQuote(context, decision) {
  const quote = context.quotes[0];
  if (!quote) throw new Error('Primero prepara una cotización.');
  const now = new Date().toISOString();
  const approved = decision === 'approved';
  const { error: quoteError } = await supabase
    .from('quotes')
    .update({ status: decision, approved_at: approved ? now : null, rejected_at: approved ? null : now })
    .eq('id', quote.id);
  throwIfError(quoteError);

  const quoteLines = context.quoteItems.filter((item) => item.quote_id === quote.id);
  const serviceIds = quoteLines.map((item) => item.service_id).filter(Boolean);
  const partIds = quoteLines.map((item) => item.part_line_id).filter(Boolean);
  const status = approved ? 'approved' : 'rejected';
  const results = await Promise.all([
    serviceIds.length ? supabase.from('work_order_services').update({ status }).in('id', serviceIds) : Promise.resolve({ error: null }),
    partIds.length ? supabase.from('work_order_parts').update({ status }).in('id', partIds) : Promise.resolve({ error: null }),
  ]);
  results.forEach((result) => throwIfError(result.error));

  if (approved) {
    const { error: orderError } = await supabase
      .from('work_orders')
      .update({ status_code: partIds.length ? 'waiting_parts' : 'repair', updated_at: now })
      .eq('id', context.workOrder.id);
    throwIfError(orderError);
  }
}

export async function markApprovedPartsOrdered(context) {
  const partIds = context.parts.filter((part) => part.status === 'approved').map((part) => part.id);
  if (!partIds.length) throw new Error('No hay piezas aprobadas para pedir.');
  const { error } = await supabase.from('work_order_parts').update({ status: 'ordered' }).in('id', partIds);
  throwIfError(error);
}

export async function createCommercialInvoice(context, form) {
  const quote = context.quotes.find((item) => item.status === 'approved') || context.quotes[0];
  if (!quote) throw new Error('Primero prepara una cotización válida.');
  const lines = context.quoteItems.filter((item) => item.quote_id === quote.id);
  if (!lines.length) throw new Error('La cotización no tiene líneas facturables.');
  const { workOrder } = context;
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      workshop_id: workOrder.workshop_id,
      work_order_id: workOrder.id,
      customer_id: workOrder.customer_id,
      vehicle_id: workOrder.vehicle_id,
      status: 'issued',
      issued_at: new Date().toISOString(),
      due_at: form.dueDate ? new Date(`${form.dueDate}T12:00:00`).toISOString() : null,
      subtotal: quote.subtotal,
      vat_total: quote.vat_total,
      total: quote.total,
      billing_snapshot: {
        email: form.email || null,
        reference: form.reference || null,
        ocr: form.ocr || null,
        notes: form.notes || null,
        customer: workOrder.customer_name_snapshot,
        plate: workOrder.plate_snapshot,
        vehicle: workOrder.vehicle_snapshot,
      },
    })
    .select()
    .single();
  throwIfError(invoiceError);
  const { error: linesError } = await supabase.from('invoice_items').insert(
    lines.map((line) => ({
      workshop_id: workOrder.workshop_id,
      invoice_id: invoice.id,
      item_type: line.item_type,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      vat_rate: line.vat_rate,
      service_id: line.service_id,
      part_line_id: line.part_line_id,
    }))
  );
  throwIfError(linesError);
  return invoice;
}

export async function confirmCommercialPayment(context, form) {
  const { workOrder } = context;
  const invoice = form.invoiceId ? context.invoices.find((item) => item.id === form.invoiceId) : null;
  if (invoice?.status === 'paid') throw new Error('La factura ya está pagada.');
  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      workshop_id: workOrder.workshop_id,
      invoice_id: invoice?.id || null,
      work_order_id: workOrder.id,
      customer_id: workOrder.customer_id,
      vehicle_id: workOrder.vehicle_id,
      method: form.method,
      amount: Number(form.amount),
      status: 'accepted',
      external_reference: form.reference || null,
      accepted_at: new Date().toISOString(),
    })
    .select()
    .single();
  throwIfError(error);
  if (invoice) {
    const { error: invoiceError } = await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.id);
    throwIfError(invoiceError);
  }
  return payment;
}

export async function removeCommercialService(id) {
  const quoteLinks = await linkedQuotes('service_id', id);
  if (quoteLinks.editableIds.length) {
    const { error: quoteError } = await supabase.from('quote_items').delete().eq('service_id', id).in('quote_id', quoteLinks.editableIds);
    throwIfError(quoteError);
  }
  const { count, error: invoiceError } = await supabase.from('invoice_items').select('id', { count: 'exact', head: true }).eq('service_id', id);
  throwIfError(invoiceError);
  const referencedHistorically = quoteLinks.lockedIds.length > 0 || Number(count || 0) > 0;
  const result = referencedHistorically
    ? await supabase.from('work_order_services').update({ status: 'removed' }).eq('id', id)
    : await supabase.from('work_order_services').delete().eq('id', id);
  throwIfError(result.error);
  await refreshQuoteTotals(quoteLinks.editableIds);
}
export async function removeCommercialPart(id) {
  const quoteLinks = await linkedQuotes('part_line_id', id);
  if (quoteLinks.editableIds.length) {
    const { error: quoteError } = await supabase.from('quote_items').delete().eq('part_line_id', id).in('quote_id', quoteLinks.editableIds);
    throwIfError(quoteError);
  }
  const { count, error: invoiceError } = await supabase.from('invoice_items').select('id', { count: 'exact', head: true }).eq('part_line_id', id);
  throwIfError(invoiceError);
  const referencedHistorically = quoteLinks.lockedIds.length > 0 || Number(count || 0) > 0;
  const result = referencedHistorically
    ? await supabase.from('work_order_parts').update({ status: 'removed' }).eq('id', id)
    : await supabase.from('work_order_parts').delete().eq('id', id);
  throwIfError(result.error);
  await refreshQuoteTotals(quoteLinks.editableIds);
}
