import { defineStore } from 'pinia';
import { api } from '@/api.js';
import { useAuthStore } from '@/stores/auth.js';
import { defaultDashboardPreferences } from '@/utils/dashboard-preferences.js';

export const useDashboardPreferencesStore = defineStore('dashboardPreferences', {
  state: () => ({
    loaded: false,
    ownerId: null,
    preferences: defaultDashboardPreferences(),
  }),
  actions: {
    async load(force = false) {
      const userId = useAuthStore().user?.id ?? null;
      if (this.loaded && this.ownerId === userId && !force) return this.preferences;
      const data = await api('/api/dashboard/preferences');
      this.preferences = data.preferences;
      this.loaded = true;
      this.ownerId = userId;
      return this.preferences;
    },
    async save(preferences) {
      const data = await api('/api/dashboard/preferences', { method: 'PUT', body: preferences });
      this.preferences = data.preferences;
      this.loaded = true;
      this.ownerId = useAuthStore().user?.id ?? null;
      return this.preferences;
    },
  },
});
