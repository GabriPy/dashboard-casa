import { diffDays, italianDate, isoToLocalDateTime, todayLocal } from './lib/time.js';

const TASK_LABELS = {
  acqua: 'Annaffiare',
  concime: 'Concimare',
  potatura: 'Potare',
  rinvaso: 'Rinvasare',
  controllo: 'Controllare',
};

export function buildReminderContent(entityType, entity, reminder) {
  let title;
  let subtitle;
  let details = [];
  let emoji = '🔔';

  if (entityType === 'deadline') {
    emoji = '📌';
    title = entity.title;
    const due = italianDate(entity.due_date, { weekday: true });
    const days = diffDays(todayLocal(), entity.due_date);
    const when = days === 0 ? 'oggi' : days === 1 ? 'domani' : days > 1 ? `fra ${days} giorni` : `${Math.abs(days)} giorni fa`;
    subtitle = `Scade ${due} (${when})`;
    details = [entity.category ? `Categoria: ${entity.category}` : '', entity.notes || ''];
  } else if (entityType === 'event') {
    emoji = '📅';
    title = entity.title;
    const local = isoToLocalDateTime(entity.starts_at);
    const date = italianDate((reminder && reminder.occurrence_at) || local.slice(0, 10), { weekday: true });
    subtitle = entity.all_day ? `${date} · tutto il giorno` : `${date} alle ${local.slice(11, 16)}`;
    details = [entity.location ? `Dove: ${entity.location}` : '', entity.description || ''];
  } else {
    emoji = '🌿';
    title = `${TASK_LABELS[entity.task_type] || 'Cura'} · ${entity.plant_name}`;
    subtitle = `Prevista ${italianDate(entity.next_due_date, { weekday: true })}`;
    details = [entity.location ? `Posizione: ${entity.location}` : '', entity.notes || ''];
  }

  return {
    subject: `${emoji} ${title}`,
    text: [title, subtitle, ...details].filter(Boolean).join('\n'),
  };
}
