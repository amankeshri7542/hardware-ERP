import api from './axios';

const command = (path, payload, key, actorId) => api.post(path, payload, {
  timeout: 15000,
  headers: { 'Idempotency-Key': key, 'Idempotency-Actor': String(actorId) },
});
export const getFinanceAccount = (party, id, params) => api.get(`/finance/${party}s/${id}`, { params });
export const getAnonymousLiabilities = params => api.get('/finance/anonymous', { params });
export const quoteCustomerSettlement = payload => api.post('/finance/customer/quote', payload);
export const quoteSupplierSettlement = payload => api.post('/finance/supplier/quote', payload);
export const recordCustomerSettlement = (payload, key, actorId) => command('/finance/customer/commands', payload, key, actorId);
export const recordSupplierSettlement = (payload, key, actorId) => command('/finance/supplier/commands', payload, key, actorId);
export const getFinanceStatement = (party, id, params) => api.get(`/finance/statements/${party}/${id}`, { params });
export const getFinanceReports = params => api.get('/finance/reports', { params });
export const getFinanceExport = params => api.get('/finance/export.csv', { params, responseType: 'blob' });
export const getFinanceDay = date => api.get('/finance/days', { params: { date } });
export const quoteFinanceDay = payload => api.post('/finance/days/quote', payload);
export const openFinanceDay = (payload, key, actorId) => command('/finance/days/open', payload, key, actorId);
export const closeFinanceDay = (payload, key, actorId) => command('/finance/days/close', payload, key, actorId);
