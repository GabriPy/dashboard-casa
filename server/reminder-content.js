import { diffDays, italianDate, isoToLocalDateTime, todayLocal } from './lib/time.js';

const TASK_LABELS = {
  acqua: 'Annaffiare',
  concime: 'Concimare',
  potatura: 'Potare',
  rinvaso: 'Rinvasare',
  controllo: 'Controllare',
};

const VEHICLE_RECORD_LABELS = {
  fuel: 'Rifornimento',
  service: 'Manutenzione',
  inspection: 'Revisione',
  insurance: 'Assicurazione',
  tax: 'Bollo',
  tires: 'Pneumatici',
  other: 'Attività',
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
  } else if (entityType === 'vehicle_record') {
    emoji = '🚗';
    title = `${VEHICLE_RECORD_LABELS[entity.type] || 'Scadenza'} · ${entity.vehicle_name}`;
    if (reminder?.occurrence_at?.startsWith('km:')) {
      const dueOdometer = Number(reminder.occurrence_at.split(':')[2]);
      const remaining = dueOdometer - entity.current_odometer;
      subtitle =
        remaining <= 0
          ? `Scadenza raggiunta a ${dueOdometer.toLocaleString('it-IT')} km`
          : `Mancano ${remaining.toLocaleString('it-IT')} km alla scadenza`;
    } else {
      const days = diffDays(todayLocal(), entity.next_due_date);
      const when = days === 0 ? 'oggi' : days === 1 ? 'domani' : days > 1 ? `fra ${days} giorni` : `${Math.abs(days)} giorni fa`;
      subtitle = `Scade ${italianDate(entity.next_due_date, { weekday: true })} (${when})`;
    }
    details = [
      entity.vehicle_plate ? `Targa: ${entity.vehicle_plate}` : '',
      entity.description || '',
    ];
  } else if (entityType === 'medication') {
    emoji = '💊';
    title = 'Promemoria farmaco';
    subtitle = 'È il momento di un’assunzione programmata.';
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
