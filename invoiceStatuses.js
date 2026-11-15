import { supabase } from './supabaseClient.js';

// Display-only reconciliation: never creates invoices, payments or changes order rows.
export async function loadInvoiceStatuses() {
  const [ordersResult, jobsResult, deliveriesResult] = await Promise.all([
    supabase.from('work_orders').select('id,legacy_order_id'),
    supabase.from('fortnox_invoice_jobs').select('work_order_id,fortnox_document_number,invoice_status,sent_at,booked_at'),
    supabase.from('invoice_email_deliveries').select('work_order_id,document_number,status,sent_at'),
  ]);
  for (const result of [ordersResult, jobsResult, deliveriesResult]) {
    if (result.error) throw result.error;
  }
  const byUuid = new Map((ordersResult.data || []).map((order) => [order.id, String(order.legacy_order_id || '')]));
  const statuses = {};
  for (const job of jobsResult.data || []) {
    const id = byUuid.get(job.work_order_id);
    if (!id || !job.fortnox_document_number) continue;
    const existing = statuses[id] || {};
    statuses[id] = {
      ...existing,
      invoiceNumber: job.fortnox_document_number,
      sent: existing.sent || Boolean(job.sent_at) || job.invoice_status === 'sent',
    };
  }
  for (const delivery of deliveriesResult.data || []) {
    const id = byUuid.get(delivery.work_order_id);
    if (!id || !delivery.document_number || delivery.status !== 'sent' || !delivery.sent_at) continue;
    statuses[id] = { ...statuses[id], invoiceNumber: delivery.document_number, sent: true };
  }
  return statuses;
}

export function displayOrderStatus(order, invoiceStatuses) {
  const invoice = invoiceStatuses[String(order.id)];
  if (order.status === 'Pagada' || order.status === 'Cancelada') return order.status;
  return invoice?.sent ? 'Facturada' : (order.status || 'Abierta');
}

export function isOrderActive(order, invoiceStatuses) {
  return !['Terminada', 'Facturada', 'Pagada', 'Cancelada'].includes(displayOrderStatus(order, invoiceStatuses));
}
