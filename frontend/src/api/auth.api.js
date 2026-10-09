import api from './axios.js';

export const loginApi = (data) => api.post('/auth/login', data);
export const logoutApi = () => api.post('/auth/logout');
export const getSessionApi = () => api.get('/auth/session');
