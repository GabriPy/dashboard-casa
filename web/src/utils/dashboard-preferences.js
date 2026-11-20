export const dashboardCardOptions = [
  { id: 'shopping', label: 'Spesa', icon: 'basket', tone: 'primary', to: '/spesa' },
  { id: 'deadlines', label: 'Scadenze', icon: 'clock', tone: 'gold', to: '/scadenze' },
  { id: 'plants', label: 'Piante', icon: 'leaf', tone: '', to: '/piante' },
  { id: 'recipes', label: 'Ricette', icon: 'book', tone: 'rose', to: '/ricette' },
];

export const dashboardSectionOptions = [
  { id: 'agenda', label: 'Agenda e prossimi giorni' },
  { id: 'deadlines', label: 'Scadenze in arrivo' },
  { id: 'shopping', label: 'Lista della spesa' },
  { id: 'plants', label: 'Piante da curare' },
  { id: 'recipe', label: 'Ricetta del giorno' },
];

export const mobileNavOptions = [
  { id: 'today', label: 'Oggi', icon: 'home', to: '/', hint: 'La giornata in casa', tone: '' },
  { id: 'shopping', label: 'Spesa', icon: 'basket', to: '/spesa', hint: 'Lista della spesa', tone: '' },
  { id: 'calendar', label: 'Calendario', icon: 'calendar', to: '/calendario', hint: 'Eventi e appuntamenti', tone: '' },
  { id: 'deadlines', label: 'Scadenze', icon: 'clock', to: '/scadenze', hint: 'Promemoria e scadenze', tone: '' },
  { id: 'recipes', label: 'Ricette', icon: 'book', to: '/ricette', hint: 'Il ricettario di casa', tone: 'rose' },
  { id: 'plants', label: 'Piante', icon: 'leaf', to: '/piante', hint: 'Cura e diario verde', tone: 'sage' },
];

export function defaultDashboardPreferences() {
  return {
    cards: {
      order: dashboardCardOptions.map((item) => item.id),
      visible: dashboardCardOptions.map((item) => item.id),
    },
    sections: {
      order: dashboardSectionOptions.map((item) => item.id),
      visible: dashboardSectionOptions.map((item) => item.id),
    },
    mobileNav: { order: mobileNavOptions.map((item) => item.id) },
  };
}

export function copyDashboardPreferences(preferences) {
  return {
    cards: { order: [...preferences.cards.order], visible: [...preferences.cards.visible] },
    sections: { order: [...preferences.sections.order], visible: [...preferences.sections.visible] },
    mobileNav: { order: [...preferences.mobileNav.order] },
  };
}
