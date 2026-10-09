import { create } from 'zustand';
import { getSessionApi, logoutApi } from '../api/auth.api.js';

let initialization;
const removeLegacyCredentials = () => {
  try {
    localStorage.removeItem('erp_token');
    localStorage.removeItem('erp_user');
  } catch (_) { /* Storage may be unavailable; the cookie remains authoritative. */ }
};

const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isInitializing: true,
  login: (user) => {
    removeLegacyCredentials();
    set({ user, isAuthenticated: true, isInitializing: false });
  },
  clearSession: () => {
    removeLegacyCredentials();
    set({ user: null, isAuthenticated: false });
  },
  logout: async () => {
    await logoutApi();
    useAuthStore.getState().clearSession();
  },
  initialize: () => {
    removeLegacyCredentials();
    if (!initialization) {
      initialization = getSessionApi()
        .then(({ data }) => set({ user: data.data.user, isAuthenticated: true }))
        .catch(() => set({ user: null, isAuthenticated: false }))
        .finally(() => set({ isInitializing: false }));
    }
    return initialization;
  },
}));

export default useAuthStore;
