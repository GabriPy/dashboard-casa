import { Router } from 'express';
import { z } from 'zod';
import { audit, db, nowIso } from '../db.js';
import { config } from '../config.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { HttpError, validate } from '../lib/http.js';

export const homeAssistantRouter = Router();
homeAssistantRouter.use(requireAuth);

const supportedDomains = new Set(['light', 'switch', 'fan', 'input_boolean', 'media_player']);

function haConfigured() {
  return Boolean(config.homeAssistant.url && config.homeAssistant.token);
}

async function haFetch(path, options = {}) {
  if (!haConfigured()) throw new HttpError(503, 'Home Assistant non è configurato sul server.');
  let response;
  try {
    response = await fetch(`${config.homeAssistant.url}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${config.homeAssistant.token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    throw new HttpError(502, `Impossibile collegarsi a Home Assistant: ${err.message}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HttpError(response.status === 401 ? 502 : response.status, `Home Assistant ha risposto con un errore${text ? `: ${text.slice(0, 180)}` : '.'}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function deviceOut(row) {
  return {
    id: row.id,
    name: row.name,
    entityId: row.entity_id,
    room: row.room || '',
    groupName: row.group_name || '',
    icon: row.icon,
  };
}

function stateIsOn(state) {
  return state && !['off', 'unavailable', 'unknown'].includes(String(state).toLowerCase());
}

function serializeDevice(row, state) {
  const available = Boolean(state) && state.state !== 'unavailable' && state.state !== 'unknown';
  return {
    ...deviceOut(row),
    state: state?.state || 'unavailable',
    on: Boolean(state && stateIsOn(state.state)),
    available,
    friendlyName: state?.attributes?.friendly_name || row.name,
  };
}

homeAssistantRouter.get('/status', (_req, res) => {
  res.json({ configured: haConfigured() });
});

homeAssistantRouter.get('/devices', async (req, res) => {
  if (!haConfigured()) {
    res.json({ configured: false, devices: [], availableEntities: [] });
    return;
  }
  const rows = db.prepare('SELECT * FROM domotica_devices ORDER BY sort_order ASC, name COLLATE NOCASE ASC').all();
  try {
    const states = await haFetch('/api/states');
    const stateByEntity = new Map(states.map((state) => [state.entity_id, state]));
    const devices = rows.map((row) => serializeDevice(row, stateByEntity.get(row.entity_id)));
    const availableEntities = states
      .filter((state) => supportedDomains.has(String(state.entity_id).split('.')[0]))
      .map((state) => ({
        entityId: state.entity_id,
        name: state.attributes?.friendly_name || state.entity_id,
        state: state.state,
        domain: state.entity_id.split('.')[0],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    res.json({ configured: true, devices, availableEntities });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'Impossibile collegarsi a Home Assistant.');
  }
});

const deviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  entityId: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+\.[a-z0-9_]+$/, 'Inserisci un entity ID valido, ad esempio light.sala.')
    .max(180),
  room: z.string().trim().max(60).nullish(),
  groupName: z.string().trim().max(60).nullish(),
  icon: z.enum(['power', 'light', 'plug', 'fan', 'thermostat', 'lock', 'tv']).default('power'),
});

homeAssistantRouter.post('/devices', requireAdmin, (req, res) => {
  if (!haConfigured()) throw new HttpError(503, 'Configura Home Assistant nelle variabili del server.');
  const body = validate(deviceSchema, req.body);
  const domain = body.entityId.split('.')[0];
  if (!supportedDomains.has(domain)) throw new HttpError(400, 'Questo tipo di entità non è supportato.');
  const exists = db.prepare('SELECT id FROM domotica_devices WHERE entity_id = ?').get(body.entityId);
  if (exists) throw new HttpError(409, 'Questo dispositivo è già stato aggiunto.');
  const now = nowIso();
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM domotica_devices').get().next;
  const result = db.prepare(
    `INSERT INTO domotica_devices (name, entity_id, room, group_name, icon, sort_order, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(body.name, body.entityId, body.room || null, body.groupName || null, body.icon, sort, req.user.id, now, now);
  audit(req.user.id, 'add_domotica_device', 'domotica_device', Number(result.lastInsertRowid), { entityId: body.entityId });
  const row = db.prepare('SELECT * FROM domotica_devices WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ device: deviceOut(row) });
});

const deviceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  room: z.string().trim().max(60).nullish(),
  groupName: z.string().trim().max(60).nullish(),
  icon: z.enum(['power', 'light', 'plug', 'fan', 'thermostat', 'lock', 'tv']),
});

homeAssistantRouter.patch('/devices/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Dispositivo non valido.');
  const row = db.prepare('SELECT * FROM domotica_devices WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Dispositivo non trovato.');
  const body = validate(deviceUpdateSchema, req.body);
  db.prepare(
    `UPDATE domotica_devices
     SET name = ?, room = ?, group_name = ?, icon = ?, updated_at = ?
     WHERE id = ?`,
  ).run(body.name, body.room || null, body.groupName || null, body.icon, nowIso(), id);
  audit(req.user.id, 'update_domotica_device', 'domotica_device', id, {
    room: body.room || null,
    groupName: body.groupName || null,
  });
  res.json({ device: deviceOut(db.prepare('SELECT * FROM domotica_devices WHERE id = ?').get(id)) });
});

homeAssistantRouter.delete('/devices/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Dispositivo non valido.');
  const row = db.prepare('SELECT * FROM domotica_devices WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Dispositivo non trovato.');
  db.prepare('DELETE FROM domotica_devices WHERE id = ?').run(id);
  audit(req.user.id, 'remove_domotica_device', 'domotica_device', id, { entityId: row.entity_id });
  res.json({ ok: true });
});

const actionSchema = z.object({
  turnOn: z.boolean(),
});

async function setEntities(domain, service, entityIds) {
  return haFetch(`/api/services/${domain}/${service}`, {
    method: 'POST',
    body: JSON.stringify({ entity_id: entityIds }),
  });
}

async function readStates() {
  return haFetch('/api/states');
}

homeAssistantRouter.post('/devices/:id/action', async (req, res) => {
  if (!haConfigured()) throw new HttpError(503, 'Home Assistant non è configurato sul server.');
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Dispositivo non valido.');
  const row = db.prepare('SELECT * FROM domotica_devices WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Dispositivo non trovato.');
  const body = validate(actionSchema, req.body);
  const domain = row.entity_id.split('.')[0];
  if (!supportedDomains.has(domain)) throw new HttpError(400, 'Questo tipo di entità non è supportato.');
  const service = body.turnOn ? 'turn_on' : 'turn_off';
  await setEntities(domain, service, row.entity_id);
  const states = await readStates();
  res.json({ device: serializeDevice(row, states.find((item) => item.entity_id === row.entity_id)) });
});

const groupActionSchema = z.object({
  room: z.string().trim().min(1).max(60),
  groupName: z.string().trim().min(1).max(60),
  turnOn: z.boolean(),
});

homeAssistantRouter.post('/groups/action', async (req, res) => {
  if (!haConfigured()) throw new HttpError(503, 'Home Assistant non è configurato sul server.');
  const body = validate(groupActionSchema, req.body);
  const rows = db
    .prepare("SELECT * FROM domotica_devices WHERE COALESCE(NULLIF(room, ''), 'Casa') = ? AND group_name = ? ORDER BY sort_order ASC, name COLLATE NOCASE ASC")
    .all(body.room, body.groupName);
  if (!rows.length) throw new HttpError(404, 'Gruppo non trovato.');

  const states = await readStates();
  const stateByEntity = new Map(states.map((state) => [state.entity_id, state]));
  const availableRows = rows.filter((row) => {
    const state = stateByEntity.get(row.entity_id);
    return state && state.state !== 'unavailable' && state.state !== 'unknown';
  });
  if (!availableRows.length) throw new HttpError(409, 'Nessun dispositivo del gruppo è disponibile.');

  const service = body.turnOn ? 'turn_on' : 'turn_off';
  const entitiesByDomain = new Map();
  for (const row of availableRows) {
    const domain = row.entity_id.split('.')[0];
    if (!supportedDomains.has(domain)) continue;
    if (!entitiesByDomain.has(domain)) entitiesByDomain.set(domain, []);
    entitiesByDomain.get(domain).push(row.entity_id);
  }
  await Promise.all([...entitiesByDomain.entries()].map(([domain, entityIds]) => setEntities(domain, service, entityIds)));

  const updatedStates = await readStates();
  const updatedByEntity = new Map(updatedStates.map((state) => [state.entity_id, state]));
  res.json({ devices: rows.map((row) => serializeDevice(row, updatedByEntity.get(row.entity_id))) });
});
