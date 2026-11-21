import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { validate } from '../lib/http.js';

export const logsRouter = Router();
logsRouter.use(requireAuth);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeId: z.coerce.number().int().positive().optional(),
});

logsRouter.get('/', requireAdmin, (req, res) => {
  const { limit, beforeId } = validate(querySchema, req.query);
  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, u.name AS user_name, a.action, a.entity_type, a.entity_id, a.detail, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE (? IS NULL OR a.id < ?)
       ORDER BY a.id DESC
       LIMIT ?`,
    )
    .all(beforeId ?? null, beforeId ?? null, limit + 1);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  const logs = rows.map((row) => {
    let detail = null;
    if (row.detail) {
      try {
        detail = JSON.parse(row.detail);
      } catch {
        detail = row.detail;
      }
    }
    return {
      id: row.id,
      actorName: row.user_name || 'Utente non disponibile',
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      detail,
      createdAt: row.created_at,
    };
  });
  res.json({
    logs,
    nextCursor: hasMore ? rows[rows.length - 1].id : null,
  });
});
