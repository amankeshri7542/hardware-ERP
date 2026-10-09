import api from './axios';

export const createInvoice = (data, key, actorId) => api.post('/invoices', data, { timeout: 15000, headers: { 'Idempotency-Key': key, 'Idempotency-Actor': String(actorId) } });
export const quoteInvoice = (data) => api.post('/invoices/quote', data);
export const getInvoice = (id) => api.get(`/invoices/${id}`);
export const listInvoices = (params) => api.get('/invoices', { params });
export const getPdfStatus = (id) => api.get(`/invoices/${id}/pdf-status`);
export const getPdfUrl = (id) => api.get(`/invoices/${id}/pdf`);
export const downloadPdfBlob = (id) => api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
export const regeneratePdf = (id) => api.post(`/invoices/${id}/regenerate-pdf`);
export const quoteReturn = data => api.post(`/invoices/${data.original_invoice_id}/return/quote`, data);
export const processReturn = (data, key, actorId) => api.post(`/invoices/${data.original_invoice_id}/return`, data,
  { timeout:15000,headers:{'Idempotency-Key':key,'Idempotency-Actor':String(actorId)} });

/**
 * Download and open invoice PDF in a new tab.
 * Handles both S3 (JSON with pre-signed URL) and local dev (binary PDF blob).
 */
export async function openInvoicePdf(invoiceId) {
  // Use blob responseType to handle both JSON and binary responses
  const response = await api.get(`/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
  const blob = response.data;

  // If backend returned JSON (S3 pre-signed URL), parse and open directly
  if (blob.type === 'application/json' || blob.type?.includes('json')) {
    const text = await blob.text();
    const json = JSON.parse(text);
    if (json?.data?.url) {
      window.open(json.data.url, '_blank');
      return;
    }
  }

  // Binary PDF (local dev) — create blob URL and open
  const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
  const url = URL.createObjectURL(pdfBlob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
