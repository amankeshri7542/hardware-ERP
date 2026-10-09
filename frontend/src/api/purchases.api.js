import api from './axios';

export const createPurchase = (data, key, actorId) => api.post('/purchases', data, {
  timeout: 15000, headers: { 'Idempotency-Key': key, 'Idempotency-Actor': String(actorId) },
});
export const quotePurchase = (data) => api.post('/purchases/quote', data);

export const getPurchases = (params) => api.get('/purchases', { params });

export const getPurchase = (id) => api.get(`/purchases/${id}`);

export const updatePurchaseNotes = (id, notes) =>
  api.put(`/purchases/${id}/notes`, { notes });

export const createPurchaseReturn = (id, data, key, actorId) =>
  api.post(`/purchases/${id}/returns`, data, {
    timeout: 15000, headers: { 'Idempotency-Key': key, 'Idempotency-Actor': String(actorId) },
  });
export const quotePurchaseReturn = (id, data) => api.post(`/purchases/${id}/returns/quote`, data);

export const getPurchaseReturns = (id) =>
  api.get(`/purchases/${id}/returns`);

export const uploadPurchaseInvoice = (id, file) => {
  const form = new FormData();
  form.append('invoice', file);
  return api.post(`/purchases/${id}/invoice`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const getPurchaseInvoiceUrl = (id) => api.get(`/purchases/${id}/invoice`);
