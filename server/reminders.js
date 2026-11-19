import { config, smtpConfigured } from './config.js';
import { db, getSetting, nowIso } from './db.js';
import { buildReminderContent, reminderRecipients, sendMail } from './mailer.js';
import { addDays, expandRecurrence, isoToLocalDate, localDateTimeToIso, todayLocal } from './lib/time.js';
import { pushConfigured, sendPushNotification } from './push.js';

const RETRY_MINUTES = 15;
const MAX_ATTEMPTS = 3;

function deletePendingAuto(entityType, entityId) {
  db.prepare("DELETE FROM reminders WHERE entity_type = ? AND entity_id = ? AND status = 'pending' AND source = 'auto'").run(
    entityType,
    entityId,
  );
}

function insertReminder({ entityType, entityId, sendAt, occurrenceAt = null }) {
  if (!sendAt) return;
  if (new Date(sendAt).getTime() < Date.now() + 60_000) return;
  const exists = db
    .prepare(
      "SELECT 1 FROM reminders WHERE entity_type = ? AND entity_id = ? AND send_at = ? AND status = 'pending'",
    )
    .get(entityType, entityId, sendAt);
  if (exists) return;
  db.prepare(
    `INSERT INTO reminders (entity_type, entity_id, send_at, occurrence_at, channel, status, source, created_at)
     VALUES (?, ?, ?, ?, 'email', 'pending', 'auto', ?)`,
  ).run(entityType, entityId, sendAt, occurrenceAt, nowIso());
}

export function reminderHour() {
  const raw = getSetting('reminder_hour', config.reminderHour) || '09:00';
  return /^\d{2}:\d{2}$/.test(raw) ? raw : '09:00';
}

function deadlineOffsets() {
  return String(getSetting('deadline_offsets', '7,1'))
    .split(',')
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .slice(0, 4);
}

export function syncDeadlineReminders(deadline) {
  deletePendingAuto('deadline', deadline.id);
  if (deadline.status !== 'open') return;
  const hour = reminderHour();
  for (const offset of deadlineOffsets()) {
    const date = addDays(deadline.due_date, -offset);
    insertReminder({
      entityType: 'deadline',
      entityId: deadline.id,
      sendAt: localDateTimeToIso(date, hour),
      occurrenceAt: date,
    });
  }
}

export function syncEventReminders(event) {
  deletePendingAuto('event', event.id);
  const hour = reminderHour();
  const offset = Math.max(0, Number.parseInt(getSetting('event_offset_days', '1'), 10) || 0);
  const today = todayLocal();
  const horizon = addDays(today, 120);
  const startDate = isoToLocalDate(event.starts_at);
  const occurrences = expandRecurrence({
    startDate,
    recurrence: event.recurrence || 'none',
    until: event.recurrence_until,
    from: today,
    to: horizon,
    max: 8,
  });
  for (const occurrence of occurrences) {
    const date = addDays(occurrence, -offset);
    insertReminder({
      entityType: 'event',
      entityId: event.id,
      sendAt: localDateTimeToIso(date, hour),
      occurrenceAt: occurrence,
    });
  }
}

export function syncPlantTaskReminders(taskId) {
  const task = db
    .prepare(
      `SELECT t.*, p.name AS plant_name, p.location
       FROM plant_tasks t JOIN plants p ON p.id = t.plant_id WHERE t.id = ?`,
    )
    .get(taskId);
  if (!task) return;
  deletePendingAuto('plant_task', task.id);
  if (getSetting('plant_reminders', 'true') !== 'true') return;
  insertReminder({
    entityType: 'plant_task',
    entityId: task.id,
    sendAt: localDateTimeToIso(task.next_due_date, reminderHour()),
    occurrenceAt: task.next_due_date,
  });
}

export function syncEntityReminders(entityType, entityId) {
  if (entityType === 'deadline') {
    const row = db.prepare('SELECT * FROM deadlines WHERE id = ?').get(entityId);
    if (row) syncDeadlineReminders(row);
  } else if (entityType === 'event') {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(entityId);
    if (row) syncEventReminders(row);
  } else if (entityType === 'plant_task') {
    syncPlantTaskReminders(entityId);
  }
}

export function removeEntityReminders(entityType, entityId) {
  db.prepare('DELETE FROM reminders WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
}

export function refreshRecurringEvents() {
  const rows = db
    .prepare("SELECT * FROM events WHERE recurrence <> 'none' AND starts_at <= ?")
    .all(addDays(todayLocal(), 120));
  for (const row of rows) syncEventReminders(row);
}

export function syncAllReminders() {
  for (const row of db.prepare("SELECT * FROM deadlines WHERE status = 'open'").all()) syncDeadlineReminders(row);
  for (const row of db.prepare('SELECT * FROM events').all()) syncEventReminders(row);
  for (const task of db.prepare('SELECT id FROM plant_tasks').all()) syncPlantTaskReminders(task.id);
}

function loadReminderEntity(type, id) {
  if (type === 'plant_task') {
    return db
      .prepare(
        `SELECT t.*, t.type AS task_type, p.name AS plant_name, p.location
         FROM plant_tasks t JOIN plants p ON p.id = t.plant_id WHERE t.id = ?`,
      )
      .get(id);
  }
  if (type === 'event') return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (type === 'deadline') return db.prepare('SELECT * FROM deadlines WHERE id = ?').get(id);
  return null;
}

function pushPath(entityType) {
  if (entityType === 'event') return '/calendario';
  if (entityType === 'deadline') return '/scadenze';
  return '/piante';
}

async function processDuePushReminders(now) {
  if (!pushConfigured()) return { sent: 0, failed: 0 };
  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
  const reminders = db
    .prepare(
      `SELECT * FROM reminders
       WHERE channel = 'email' AND status <> 'cancelled' AND send_at <= ? AND send_at >= ?
       ORDER BY send_at ASC LIMIT 100`,
    )
    .all(now, cutoff);
  const stats = { sent: 0, failed: 0 };
  const saveDelivery = db.prepare(
    `INSERT INTO push_deliveries (reminder_id, subscription_id, dedupe_key, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT(subscription_id, dedupe_key) DO UPDATE SET reminder_id = excluded.reminder_id
     WHERE push_deliveries.status = 'pending'`,
  );
  const subscriptionsForReminder = db.prepare(
    `SELECT s.* FROM push_subscriptions s
     JOIN users u ON u.id = s.user_id AND u.is_active = 1
     WHERE (? = 1 OR u.id = ?)`,
  );
  const pendingDeliveries = db.prepare(
    `SELECT d.reminder_id, d.subscription_id, d.attempts, s.user_id, s.endpoint, s.p256dh, s.auth
     FROM push_deliveries d JOIN push_subscriptions s ON s.id = d.subscription_id
     WHERE d.reminder_id = ? AND d.status = 'pending' AND d.attempts < ?`,
  );
  db.prepare('DELETE FROM push_deliveries WHERE reminder_id IS NULL AND created_at < ?').run(
    new Date(Date.now() - 90 * 86400_000).toISOString(),
  );

  for (const reminder of reminders) {
    const entity = loadReminderEntity(reminder.entity_type, reminder.entity_id);
    if (!entity || (reminder.entity_type === 'deadline' && entity.status !== 'open')) continue;
    const isPrivate = ['event', 'deadline'].includes(reminder.entity_type) && entity.visibility === 'private';
    const targets = isPrivate
      ? entity.created_by
        ? subscriptionsForReminder.all(0, entity.created_by)
        : []
      : subscriptionsForReminder.all(1, null);
    for (const subscription of targets) {
      saveDelivery.run(
        reminder.id,
        subscription.id,
        `${reminder.entity_type}:${reminder.entity_id}:${reminder.occurrence_at || reminder.send_at}`,
        nowIso(),
      );
    }

    const content = buildReminderContent(reminder.entity_type, entity, reminder);
    const payload = {
      title: content.subject,
      body: content.text.split('\n').filter(Boolean).slice(1, 3).join(' · ').slice(0, 180),
      url: pushPath(reminder.entity_type),
    };
    for (const delivery of pendingDeliveries.all(reminder.id, MAX_ATTEMPTS)) {
      try {
        await sendPushNotification(delivery, payload);
        db.prepare(
          "UPDATE push_deliveries SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE reminder_id = ? AND subscription_id = ?",
        ).run(nowIso(), reminder.id, delivery.subscription_id);
        stats.sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(delivery.subscription_id);
          continue;
        }
        const attempts = delivery.attempts + 1;
        const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        db.prepare('UPDATE push_deliveries SET status = ?, attempts = ?, last_error = ? WHERE reminder_id = ? AND subscription_id = ?').run(
          status,
          attempts,
          String(err.message).slice(0, 500),
          reminder.id,
          delivery.subscription_id,
        );
        if (status === 'failed') stats.failed += 1;
        console.warn(`[push] errore sul promemoria #${reminder.id}: ${err.message}`);
      }
    }
  }
  return stats;
}

let running = false;

export async function processDueReminders({ force = false } = {}) {
  if (running) return { skipped: 'already_running' };
  running = true;
  const stats = { sent: 0, failed: 0, cancelled: 0, retried: 0 };
  try {
    const now = nowIso();
    db.prepare(
      "UPDATE reminders SET status = 'cancelled', last_error = 'promemoria troppo vecchio' WHERE status = 'pending' AND send_at < ?",
    ).run(new Date(Date.now() - 48 * 3600_000).toISOString());

    const pushStats = await processDuePushReminders(now);
    stats.pushSent = pushStats.sent;
    stats.pushFailed = pushStats.failed;

    if (!smtpConfigured() && !force) return { ...stats, skipped: 'smtp_not_configured' };
    if (getSetting('reminder_email_enabled', 'true') !== 'true' && !force) return { ...stats, skipped: 'disabled' };

    const due = db
      .prepare("SELECT * FROM reminders WHERE status = 'pending' AND send_at <= ? ORDER BY send_at ASC LIMIT 40")
      .all(now);

    for (const reminder of due) {
      const entity = loadReminderEntity(reminder.entity_type, reminder.entity_id);
      if (!entity) {
        db.prepare("UPDATE reminders SET status = 'cancelled', last_error = 'elemento eliminato' WHERE id = ?").run(reminder.id);
        stats.cancelled += 1;
        continue;
      }
      if (reminder.entity_type === 'deadline' && entity.status !== 'open') {
        db.prepare("UPDATE reminders SET status = 'cancelled', last_error = 'scadenza completata' WHERE id = ?").run(reminder.id);
        stats.cancelled += 1;
        continue;
      }

      const recipients = reminderRecipients(reminder.entity_type, entity);
      if (!recipients.length) {
        db.prepare(
          "UPDATE reminders SET status = 'failed', last_error = 'nessun indirizzo email configurato' WHERE id = ?",
        ).run(reminder.id);
        stats.failed += 1;
        continue;
      }

      try {
        const content = buildReminderContent(reminder.entity_type, entity, reminder);
        await sendMail({ to: recipients.map((r) => r.email).join(', '), ...content });
        db.prepare("UPDATE reminders SET status = 'sent', sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?").run(
          nowIso(),
          reminder.id,
        );
        stats.sent += 1;
        console.log(`[promemoria] inviato: ${content.subject} → ${recipients.map((r) => r.email).join(', ')}`);
      } catch (err) {
        const attempts = reminder.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          db.prepare("UPDATE reminders SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?").run(
            attempts,
            String(err.message).slice(0, 500),
            reminder.id,
          );
          stats.failed += 1;
          console.error(`[promemoria] fallito definitivamente #${reminder.id}: ${err.message}`);
        } else {
          const next = new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString();
          db.prepare('UPDATE reminders SET attempts = ?, send_at = ?, last_error = ? WHERE id = ?').run(
            attempts,
            next,
            String(err.message).slice(0, 500),
            reminder.id,
          );
          stats.retried += 1;
          console.warn(`[promemoria] errore #${reminder.id}, riprovo fra ${RETRY_MINUTES} minuti: ${err.message}`);
        }
      }
    }
    return stats;
  } finally {
    running = false;
  }
}

export function startScheduler() {
  try {
    syncAllReminders();
  } catch (err) {
    console.error('[promemoria] sincronizzazione iniziale non riuscita:', err.message);
  }
  const run = () => {
    processDueReminders().catch((err) => console.error('[promemoria] errore scheduler:', err));
  };
  setTimeout(run, 8000).unref();
  setInterval(run, 60_000).unref();

  const refresh = () => {
    try {
      refreshRecurringEvents();
    } catch (err) {
      console.error('[promemoria] refresh ricorrenze:', err.message);
    }
  };
  setTimeout(refresh, 15_000).unref();
  setInterval(refresh, 6 * 3600_000).unref();
}
