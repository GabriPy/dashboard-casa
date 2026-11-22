import { Router } from 'express';
import { z } from 'zod';
import { audit, db, nowIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, cleanText, toId, validate } from '../lib/http.js';
import { todayLocal } from '../lib/time.js';
import { removeEntityReminders, removeVehicleReminders, syncVehicleReminders } from '../reminders.js';

export const vehiclesRouter = Router();
vehiclesRouter.use(requireAuth);

const vehicleTypes = ['car', 'scooter'];
const recordTypes = ['fuel', 'service', 'inspection', 'insurance', 'tax', 'tires', 'other'];
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Data non valida.');
const optionalAmount = z.union([z.number().nonnegative().max(10000000), z.literal(''), z.null()]).optional();
const optionalInteger = z.union([z.number().int().nonnegative().max(100000000), z.literal(''), z.null()]).optional();
const vehicleSelect = `SELECT v.*, u.name AS main_user_name, u.emoji AS main_user_emoji,
  (SELECT COUNT(*) FROM vehicle_records r WHERE r.vehicle_id = v.id) AS record_count,
  (SELECT odometer FROM vehicle_records r WHERE r.vehicle_id = v.id AND odometer IS NOT NULL
   ORDER BY occurred_on DESC, id DESC LIMIT 1) AS last_odometer,
  (SELECT next_due_date FROM vehicle_records r WHERE r.vehicle_id = v.id AND next_due_date IS NOT NULL
   ORDER BY CASE WHEN next_due_date < ? THEN 0 ELSE 1 END, next_due_date ASC, id DESC LIMIT 1) AS next_due_date,
  (SELECT next_due_odometer FROM vehicle_records r WHERE r.vehicle_id = v.id AND next_due_odometer IS NOT NULL
   ORDER BY next_due_odometer ASC, id DESC LIMIT 1) AS next_due_odometer
 FROM vehicles v LEFT JOIN users u ON u.id = v.main_user_id`;

function getVehicle(id) {
  const row = db
    .prepare(`${vehicleSelect} WHERE v.id = ?`)
    .get(todayLocal(), id);
  if (!row) throw new HttpError(404, 'Veicolo non trovato.');
  return row;
}

function vehicleOut(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    plate: row.plate || '',
    mainUser: row.main_user_id
      ? { id: row.main_user_id, name: row.main_user_name, emoji: row.main_user_emoji }
      : null,
    notes: row.notes || '',
    recordCount: row.record_count ?? 0,
    lastOdometer: row.last_odometer ?? null,
    nextDueDate: row.next_due_date || null,
    nextDueOdometer: row.next_due_odometer ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function recordOut(row) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    type: row.type,
    occurredOn: row.occurred_on,
    odometer: row.odometer,
    amount: row.amount,
    liters: row.liters,
    description: row.description || '',
    nextDueDate: row.next_due_date,
    nextDueOdometer: row.next_due_odometer,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function getRecord(vehicleId, recordId) {
  const row = db.prepare('SELECT * FROM vehicle_records WHERE id = ? AND vehicle_id = ?').get(recordId, vehicleId);
  if (!row) throw new HttpError(404, 'Attività del veicolo non trovata.');
  return row;
}

function validateMainUser(mainUserId) {
  if (mainUserId === undefined || mainUserId === null || mainUserId === '') return null;
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(mainUserId);
  if (!user) throw new HttpError(400, 'Seleziona un utente attivo della casa.');
  return user.id;
}

const vehicleSchema = z.object({
  name: z.string().trim().min(1, 'Inserisci il nome o modello del veicolo.').max(100),
  type: z.enum(vehicleTypes),
  plate: z.string().trim().max(20).nullish(),
  mainUserId: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional(),
  notes: z.string().max(2000).nullish(),
});

const recordSchema = z.object({
  type: z.enum(recordTypes),
  occurredOn: dateSchema,
  odometer: optionalInteger,
  amount: optionalAmount,
  liters: optionalAmount,
  description: z.string().trim().max(500).nullish(),
  nextDueDate: dateSchema.nullish(),
  nextDueOdometer: optionalInteger,
});

vehiclesRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(`${vehicleSelect} ORDER BY v.name COLLATE NOCASE ASC, v.id ASC`)
    .all(todayLocal());
  const users = db
    .prepare('SELECT id, name, emoji FROM users WHERE is_active = 1 ORDER BY role = ? DESC, name COLLATE NOCASE ASC')
    .all('admin');
  res.json({ vehicles: rows.map(vehicleOut), users });
});

vehiclesRouter.post('/', (req, res) => {
  const body = validate(vehicleSchema, req.body);
  const mainUserId = validateMainUser(body.mainUserId);
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO vehicles (name, type, plate, main_user_id, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(body.name, body.type, body.plate || null, mainUserId, cleanText(body.notes, 2000), req.user.id, now, now);
  audit(req.user.id, 'create_vehicle', 'vehicle', Number(result.lastInsertRowid), { name: body.name, type: body.type });
  res.status(201).json({ vehicle: vehicleOut(getVehicle(Number(result.lastInsertRowid))) });
});

vehiclesRouter.get('/:id', (req, res) => {
  const id = toId(req.params.id);
  const rows = db
    .prepare('SELECT * FROM vehicle_records WHERE vehicle_id = ? ORDER BY occurred_on DESC, id DESC')
    .all(id);
  res.json({ vehicle: vehicleOut(getVehicle(id)), records: rows.map(recordOut) });
});

vehiclesRouter.patch('/:id', (req, res) => {
  const id = toId(req.params.id);
  const existing = getVehicle(id);
  const body = validate(vehicleSchema.partial(), req.body);
  const mainUserId = body.mainUserId === undefined ? existing.main_user_id : validateMainUser(body.mainUserId);
  db.prepare(
    `UPDATE vehicles SET name = ?, type = ?, plate = ?, main_user_id = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(
    body.name ?? existing.name,
    body.type ?? existing.type,
    body.plate === undefined ? existing.plate : body.plate || null,
    mainUserId,
    body.notes === undefined ? existing.notes : cleanText(body.notes, 2000),
    nowIso(),
    id,
  );
  audit(req.user.id, 'update_vehicle', 'vehicle', id, { fields: Object.keys(body) });
  res.json({ vehicle: vehicleOut(getVehicle(id)) });
});

vehiclesRouter.delete('/:id', (req, res) => {
  const id = toId(req.params.id);
  const vehicle = getVehicle(id);
  removeVehicleReminders(id);
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
  audit(req.user.id, 'delete_vehicle', 'vehicle', id, { name: vehicle.name });
  res.json({ ok: true });
});

vehiclesRouter.post('/:id/records', (req, res) => {
  const id = toId(req.params.id);
  getVehicle(id);
  const body = validate(recordSchema, req.body);
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO vehicle_records
       (vehicle_id, type, occurred_on, odometer, amount, liters, description, next_due_date, next_due_odometer, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      body.type,
      body.occurredOn,
      body.odometer === '' || body.odometer === null ? null : body.odometer,
      body.amount === '' || body.amount === null ? null : body.amount,
      body.liters === '' || body.liters === null ? null : body.liters,
      cleanText(body.description, 500),
      body.nextDueDate || null,
      body.nextDueOdometer === '' || body.nextDueOdometer === null ? null : body.nextDueOdometer,
      req.user.id,
      now,
      now,
    );
  audit(req.user.id, 'create_vehicle_record', 'vehicle', id, { type: body.type, occurredOn: body.occurredOn });
  const row = db.prepare('SELECT * FROM vehicle_records WHERE id = ?').get(result.lastInsertRowid);
  syncVehicleReminders(id);
  res.status(201).json({ record: recordOut(row) });
});

vehiclesRouter.patch('/:id/records/:recordId', (req, res) => {
  const vehicleId = toId(req.params.id);
  const recordId = toId(req.params.recordId);
  const existing = getRecord(vehicleId, recordId);
  const body = validate(recordSchema.partial(), req.body);
  db.prepare(
    `UPDATE vehicle_records
     SET type = ?, occurred_on = ?, odometer = ?, amount = ?, liters = ?, description = ?,
       next_due_date = ?, next_due_odometer = ?, updated_at = ?
     WHERE id = ? AND vehicle_id = ?`,
  ).run(
    body.type ?? existing.type,
    body.occurredOn ?? existing.occurred_on,
    body.odometer === undefined ? existing.odometer : body.odometer === '' || body.odometer === null ? null : body.odometer,
    body.amount === undefined ? existing.amount : body.amount === '' || body.amount === null ? null : body.amount,
    body.liters === undefined ? existing.liters : body.liters === '' || body.liters === null ? null : body.liters,
    body.description === undefined ? existing.description : cleanText(body.description, 500),
    body.nextDueDate === undefined ? existing.next_due_date : body.nextDueDate || null,
    body.nextDueOdometer === undefined
      ? existing.next_due_odometer
      : body.nextDueOdometer === '' || body.nextDueOdometer === null
        ? null
        : body.nextDueOdometer,
    nowIso(),
    recordId,
    vehicleId,
  );
  syncVehicleReminders(vehicleId);
  audit(req.user.id, 'update_vehicle_record', 'vehicle', vehicleId, { type: body.type ?? existing.type });
  res.json({ record: recordOut(getRecord(vehicleId, recordId)) });
});

vehiclesRouter.delete('/:id/records/:recordId', (req, res) => {
  const vehicleId = toId(req.params.id);
  const recordId = toId(req.params.recordId);
  const record = getRecord(vehicleId, recordId);
  removeEntityReminders('vehicle_record', recordId);
  db.prepare('DELETE FROM vehicle_records WHERE id = ?').run(recordId);
  syncVehicleReminders(vehicleId);
  audit(req.user.id, 'delete_vehicle_record', 'vehicle', vehicleId, { type: record.type });
  res.json({ ok: true });
});
