import { Router } from 'express';
import { z } from 'zod';
import { config, pushConfigured } from '../config.js';
import { db, nowIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, validate } from '../lib/http.js';
import { sendPushNotification } from '../push.js';

export const pushRouter = Router();
pushRouter.use(requireAuth);

const endpointSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === 'https:', 'L’endpoint push deve usare HTTPS.');

const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

pushRouter.get('/status', (req, res) => {
  const subscriptions = db.prepare('SELECT id, created_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : null;
  res.json({
    configured: pushConfigured(),
    publicKey: pushConfigured() ? config.push.vapidPublicKey : null,
    subscriptionCount: subscriptions.length,
    currentDevice: endpoint
      ? Boolean(db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').get(req.user.id, endpoint))
      : false,
  });
});

pushRouter.post('/subscriptions', (req, res) => {
  if (!pushConfigured()) throw new HttpError(503, 'Notifiche push non configurate sul server.');
  const body = validate(subscriptionSchema, req.body);
  const now = nowIso();
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at`,
  ).run(req.user.id, body.endpoint, body.keys.p256dh, body.keys.auth, now, now);
  const subscriptionCount = db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?').get(req.user.id).count;
  res.status(201).json({ ok: true, subscriptionCount });
});

pushRouter.delete('/subscriptions', (req, res) => {
  const body = validate(z.object({ endpoint: endpointSchema }), req.body);
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user.id, body.endpoint);
  res.json({ ok: true });
});

pushRouter.post('/test', async (req, res) => {
  if (!pushConfigured()) throw new HttpError(503, 'Notifiche push non configurate sul server.');
  const body = validate(z.object({ endpoint: endpointSchema }), req.body);
  const subscription = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').get(req.user.id, body.endpoint);
  if (!subscription) throw new HttpError(404, 'Questo dispositivo non ha una sottoscrizione attiva.');

  const payload = {
    title: 'Ghibiri Home',
    body: 'Le notifiche push sono attive su questo dispositivo.',
    url: '/',
  };
  try {
    await sendPushNotification(subscription, payload);
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(subscription.id);
      throw new HttpError(410, 'La sottoscrizione push è scaduta. Attiva di nuovo le notifiche.');
    }
    console.error(`[push] prova non riuscita per il profilo ${req.user.id}:`, err.message);
    throw new HttpError(502, 'Invio della notifica di prova non riuscito.');
  }
  res.json({ ok: true });
});
