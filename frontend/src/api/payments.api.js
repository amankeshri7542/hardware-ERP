import api from './axios';

export const recordPayment = (data, key, actorId) => api.post('/payments', data, { timeout: 15000, headers: { 'Idempotency-Key': key, 'Idempotency-Actor': String(actorId) } });
export const listPayments = (params) => api.get('/payments', { params });
export const getInvoicePayments = (id) => api.get(`/payments/invoice/${id}`);
