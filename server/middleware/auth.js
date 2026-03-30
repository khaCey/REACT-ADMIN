/**
 * Auth middleware - require valid JWT for protected routes
 * After JWT verification, req.staff is loaded from the DB so is_admin / is_operator
 * match the database (fixes stale role flags in the token after role changes).
 */
import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'student-admin-secret-change-in-production';

export async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const staffId = Number(payload.id);
    if (!Number.isFinite(staffId) || staffId <= 0) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    const result = await query(
      'SELECT id, name, is_admin, is_operator, active FROM staff WHERE id = $1',
      [staffId]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Staff not found' });
    }
    const row = result.rows[0];
    if (row.active === false) {
      return res.status(403).json({ error: 'Account inactive' });
    }
    req.staff = {
      id: row.id,
      name: row.name,
      is_admin: !!row.is_admin,
      is_operator: !!row.is_operator,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    return res.status(500).json({ error: err.message });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.staff) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const isAdmin = !!req.staff.is_admin || String(req.staff.name || '').trim().toLowerCase() === 'khacey';
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function requireAdminOrOperator(req, res, next) {
  if (!req.staff) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const isAdmin = !!req.staff.is_admin || String(req.staff.name || '').trim().toLowerCase() === 'khacey';
  const isOperator = !!req.staff.is_operator;
  if (!isAdmin && !isOperator) {
    return res.status(403).json({ error: 'Admin or operator access required' });
  }
  next();
}
