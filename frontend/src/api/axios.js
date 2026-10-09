import axios from 'axios';
import useAuthStore from '../store/authStore.js';

const api = axios.create({
  baseURL: import.meta.env?.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clearSession();
    }
    // A financial mutation may already have committed; never replay it here.
    return Promise.reject(error);
  },
);

export default api;
