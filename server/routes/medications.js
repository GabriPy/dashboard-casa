import { Router } from 'express';
import { z } from 'zod';
import { audit, db, nowIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, cleanText, toId, validate } from '../lib/http.js';
import { addDays, isoToLocalDateTime, todayLocal } from '../lib/time.js';
import { medicationOccurrences } from '../medication-schedule.js';
import { removeEntityReminders, syncMedicationReminders } from '../reminders.js';

export const medicationsRouter = Router();
medicationsRouter.use(requireAuth);

const medicationFrequencies = ['daily', 'every_two_days', 'weekly', 'monthly', 'custom'];
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Data non valida.');
const medicationSchema = z.object({
  name: z.string().trim().min(1, 'Inserisci il nome del farmaco.').max(100),
  dosage: z.string().trim().max(100).default(''),
  instructions: z.string().max(2000).nullish(),
  startDate: dateSchema,
  endDate: dateSchema.nullish(),
  frequency: z.enum(medicationFrequencies),
  intervalDays: z.coerce.number().int().min(1).max(365).default(1),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Orario non valido.')).min(1).max(8),
  visibility: z.enum(['private', 'shared']).default('private'),
  ownerUserId: z.coerce.number().int().positive().optional(),
  isActive: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'La data di fine deve essere successiva a quella di inizio.' });
  }
  if (new Set(value.times).size !== value.times.length) {
    ctx.addIssue({ code: 'custom', path: ['times'], message: 'Rimuovi gli orari duplicati.' });
  }
  if (value.frequency !== 'custom' && value.intervalDays !== 1) {
    ctx.addIssue({ code: 'custom', path: ['intervalDays'], message: 'L’intervallo personalizzato è disponibile solo per la frequenza personalizzata.' });
  }
});

const doseSchema = z.object({
  scheduledAt: z.string().datetime(),
  status: z.enum(['taken', 'skipped']).default('taken'),
  note: z.string().trim().max(500).nullish(),
});

function getMedication(id) {
  const medication = db.prepare('SELECT * FROM medications WHERE id = ?').get(id);
  if (!medication) throw new HttpError(404, 'Farmaco non trovato.');
  return medication;
}

function accessibleMedication(id, userId) {
  const medication = getMedication(id);
  if (medication.visibility === 'private' && medication.owner_user_id !== userId) {
    throw new HttpError(404, 'Farmaco non trovato.');
  }
  return medication;
}

function ownerUserId(value, fallback, visibility) {
  const id = value ?? fallback;
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(id);
  if (!user) throw new HttpError(400, 'Seleziona un profilo attivo della casa.');
  if (visibility === 'private' && user.id !== fallback) {
    throw new HttpError(400, 'Un farmaco privato deve appartenere al tuo profilo.');
  }
  return user.id;
}

function serializeDose(row) {
  return {
    id: row.id,
    scheduledAt: row.scheduled_at,
    scheduledAtLocal: isoToLocalDateTime(row.scheduled_at),
    status: row.status,
    takenAt: row.taken_at,
    takenAtLocal: isoToLocalDateTime(row.taken_at),
    takenBy: row.taken_by_user_id
      ? { id: row.taken_by_user_id, name: row.taken_by_name }
      : null,
    note: row.note || '',
  };
}

function serializeMedication(row, includeToday = false) {
  const medication = {
    id: row.id,
    name: row.name,
    dosage: row.dosage,
    instructions: row.instructions || '',
    startDate: row.start_date,
    endDate: row.end_date,
    frequency: row.frequency,
    intervalDays: row.interval_days,
    times: JSON.parse(row.times),
    visibility: row.visibility,
    owner: { id: row.owner_user_id, name: row.owner_name, emoji: row.owner_emoji },
    isActive: Boolean(row.is_active),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeToday && medication.isActive) {
    const today = todayLocal();
    const occurrences = medicationOccurrences(row, today, today);
    const existing = db.prepare(
      `SELECT d.*, u.name AS taken_by_name
       FROM medication_doses d LEFT JOIN users u ON u.id = d.taken_by_user_id
       WHERE d.medication_id = ? AND d.scheduled_at = ?`,
    );
    medication.todayDoses = occurrences.map((occurrence) => {
      const dose = existing.get(row.id, occurrence.scheduledAt);
      const status = dose?.status || (new Date(occurrence.scheduledAt).getTime() <= Date.now() ? 'due' : 'upcoming');
      return {
        ...occurrence,
        status,
        dose: dose ? serializeDose(dose) : null,
      };
    });
  } else {
    medication.todayDoses = [];
  }
  return medication;
}

const medicationSelect = `SELECT m.*, u.name AS owner_name, u.emoji AS owner_emoji
  FROM medications m JOIN users u ON u.id = m.owner_user_id`;
const doseSelect = `SELECT d.*, u.name AS taken_by_name
  FROM medication_doses d LEFT JOIN users u ON u.id = d.taken_by_user_id`;

medicationsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(`${medicationSelect}
      WHERE m.visibility = 'shared' OR m.owner_user_id = ?
      ORDER BY m.is_active DESC, m.name COLLATE NOCASE ASC, m.id ASC`)
    .all(req.user.id);
  const users = db
    .prepare('SELECT id, name, emoji FROM users WHERE is_active = 1 ORDER BY name COLLATE NOCASE ASC')
    .all();
  res.json({ medications: rows.map((row) => serializeMedication(row, true)), users, today: todayLocal() });
});

medicationsRouter.post('/', (req, res) => {
  const body = validate(medicationSchema, req.body);
  const userId = ownerUserId(body.ownerUserId, req.user.id, body.visibility);
  const now = nowIso();
  const result = db.prepare(
    `INSERT INTO medications
      (name, dosage, instructions, start_date, end_date, frequency, interval_days, times, visibility,
       owner_user_id, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    body.name,
    body.dosage,
    cleanText(body.instructions, 2000),
    body.startDate,
    body.endDate || null,
    body.frequency,
    body.frequency === 'custom' ? body.intervalDays : 1,
    JSON.stringify(body.times),
    body.visibility,
    userId,
    Number(body.isActive),
    req.user.id,
    now,
    now,
  );
  const id = Number(result.lastInsertRowid);
  syncMedicationReminders(id);
  audit(req.user.id, 'create_medication');
  const row = db.prepare(`${medicationSelect} WHERE m.id = ?`).get(id);
  res.status(201).json({ medication: serializeMedication(row, true) });
});

medicationsRouter.get('/:id', (req, res) => {
  const medication = accessibleMedication(toId(req.params.id), req.user.id);
  const row = db.prepare(`${medicationSelect} WHERE m.id = ?`).get(medication.id);
  const doses = db.prepare(`${doseSelect}
    WHERE d.medication_id = ? ORDER BY d.scheduled_at DESC, d.id DESC LIMIT 60`).all(medication.id);
  res.json({ medication: serializeMedication(row, true), doses: doses.map(serializeDose) });
});

medicationsRouter.patch('/:id', (req, res) => {
  const id = toId(req.params.id);
  const existing = accessibleMedication(id, req.user.id);
  const changes = validate(medicationSchema.partial(), req.body);
  const visibility = changes.visibility ?? existing.visibility;
  if (existing.visibility === 'shared' && visibility === 'private' && existing.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'Solo il profilo assegnato può rendere privato questo farmaco.');
  }
  const ownerId = ownerUserId(
    changes.ownerUserId,
    visibility === 'private' ? req.user.id : existing.owner_user_id,
    visibility,
  );
  const next = {
    name: changes.name ?? existing.name,
    dosage: changes.dosage ?? existing.dosage,
    instructions: changes.instructions === undefined ? existing.instructions : cleanText(changes.instructions, 2000),
    startDate: changes.startDate ?? existing.start_date,
    endDate: changes.endDate === undefined ? existing.end_date : changes.endDate || null,
    frequency: changes.frequency ?? existing.frequency,
    intervalDays: changes.intervalDays ?? (changes.frequency && changes.frequency !== 'custom' ? 1 : existing.interval_days),
    times: changes.times ?? JSON.parse(existing.times),
    visibility,
    ownerId,
    isActive: changes.isActive === undefined ? existing.is_active : Number(changes.isActive),
  };
  const validated = validate(medicationSchema, {
    ...next,
    startDate: next.startDate,
    endDate: next.endDate,
    ownerUserId: next.ownerId,
    isActive: Boolean(next.isActive),
  });
  db.prepare(
    `UPDATE medications SET name = ?, dosage = ?, instructions = ?, start_date = ?, end_date = ?,
      frequency = ?, interval_days = ?, times = ?, visibility = ?, owner_user_id = ?, is_active = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    validated.name,
    validated.dosage,
    cleanText(validated.instructions, 2000),
    validated.startDate,
    validated.endDate || null,
    validated.frequency,
    validated.frequency === 'custom' ? validated.intervalDays : 1,
    JSON.stringify(validated.times),
    validated.visibility,
    ownerId,
    Number(validated.isActive),
    nowIso(),
    id,
  );
  syncMedicationReminders(id);
  audit(req.user.id, 'update_medication');
  const row = db.prepare(`${medicationSelect} WHERE m.id = ?`).get(id);
  res.json({ medication: serializeMedication(row, true) });
});

medicationsRouter.delete('/:id', (req, res) => {
  const id = toId(req.params.id);
  const medication = accessibleMedication(id, req.user.id);
  if (medication.visibility === 'shared' && medication.owner_user_id !== req.user.id) {
    throw new HttpError(403, 'Solo il profilo assegnato può eliminare questo farmaco condiviso.');
  }
  removeEntityReminders('medication', id);
  db.prepare('DELETE FROM medications WHERE id = ?').run(id);
  audit(req.user.id, 'delete_medication');
  res.json({ ok: true });
});

medicationsRouter.post('/:id/doses', (req, res) => {
  const id = toId(req.params.id);
  const medication = accessibleMedication(id, req.user.id);
  const body = validate(doseSchema, req.body);
  if (new Date(body.scheduledAt).getTime() > Date.now()) {
    throw new HttpError(400, 'Non puoi registrare in anticipo un’assunzione programmata.');
  }
  const today = todayLocal();
  const firstDay = addDays(today, -30);
  const validDose = medicationOccurrences(medication, firstDay, today)
    .some((occurrence) => occurrence.scheduledAt === body.scheduledAt);
  if (!validDose) throw new HttpError(400, 'Questa assunzione non corrisponde a un orario previsto negli ultimi 30 giorni.');
  if (db.prepare('SELECT 1 FROM medication_doses WHERE medication_id = ? AND scheduled_at = ?').get(id, body.scheduledAt)) {
    throw new HttpError(409, 'Questa dose è già stata registrata.');
  }
  const now = nowIso();
  const result = db.prepare(
    `INSERT INTO medication_doses
      (medication_id, scheduled_at, status, taken_at, taken_by_user_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, body.scheduledAt, body.status, now, req.user.id, cleanText(body.note, 500), now);
  const dose = db.prepare(`${doseSelect} WHERE d.id = ?`).get(result.lastInsertRowid);
  removeEntityReminders('medication', id);
  syncMedicationReminders(id);
  audit(req.user.id, body.status === 'taken' ? 'record_medication_dose' : 'skip_medication_dose');
  res.status(201).json({ dose: serializeDose(dose) });
});

medicationsRouter.delete('/:id/doses/:doseId', (req, res) => {
  const id = toId(req.params.id);
  accessibleMedication(id, req.user.id);
  const doseId = toId(req.params.doseId);
  const result = db.prepare('DELETE FROM medication_doses WHERE id = ? AND medication_id = ?').run(doseId, id);
  if (!result.changes) throw new HttpError(404, 'Assunzione non trovata.');
  audit(req.user.id, 'undo_medication_dose');
  res.json({ ok: true });
});
