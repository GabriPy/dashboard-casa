import { addDays, addMonths, diffDays, localDateTimeToIso } from './lib/time.js';

const DAY_INTERVALS = {
  daily: 1,
  every_two_days: 2,
  weekly: 7,
};

function medicationTimes(medication) {
  const parsed = Array.isArray(medication.times) ? medication.times : JSON.parse(medication.times || '[]');
  return parsed.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
}

export function medicationOccurrences(medication, from, to, max = 500) {
  if (!medication.start_date || from > to || (medication.end_date && medication.end_date < from)) return [];
  const start = medication.start_date;
  const end = medication.end_date && medication.end_date < to ? medication.end_date : to;
  const times = medicationTimes(medication);
  if (!times.length || end < start) return [];

  const dates = [];
  if (medication.frequency === 'monthly') {
    const [startYear, startMonth] = start.split('-').map(Number);
    const [fromYear, fromMonth] = from.split('-').map(Number);
    let monthOffset = Math.max(0, (fromYear - startYear) * 12 + fromMonth - startMonth);
    let date = addMonths(start, monthOffset);
    while (date < from) {
      monthOffset += 1;
      date = addMonths(start, monthOffset);
    }
    while (date <= end && dates.length < max) {
      dates.push(date);
      monthOffset += 1;
      date = addMonths(start, monthOffset);
    }
  } else {
    const interval = medication.frequency === 'custom'
      ? medication.interval_days
      : DAY_INTERVALS[medication.frequency];
    if (!Number.isInteger(interval) || interval < 1) return [];
    const offset = Math.max(0, diffDays(start, from));
    let occurrence = Math.ceil(offset / interval);
    let date = addDays(start, occurrence * interval);
    while (date <= end && dates.length < max) {
      dates.push(date);
      occurrence += 1;
      date = addDays(start, occurrence * interval);
    }
  }

  return dates
    .flatMap((date) => times.map((time) => ({
      date,
      time,
      scheduledAt: localDateTimeToIso(date, time),
    })))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, max);
}
