import { Router } from 'express';
import { handleGetWeek } from '../lib/booking/availabilityService.js';
import { handleBookLesson } from '../lib/booking/bookLessonService.js';
import { handleConfirmReserved } from '../lib/booking/confirmReservedService.js';
import { handleMoveReserved } from '../lib/booking/moveReservedService.js';
import { handleCreateReserved } from '../lib/booking/createReservedService.js';
import {
  handleRenumberMonthTitles,
  renumberMonthLessonTitlesForStudent,
} from '../lib/booking/titleRenumberService.js';
import {
  handleRescheduleAwaitingDate,
  handleCancel,
  handleUncancel,
  handleLegacyReschedule,
  handleRescheduleLinked,
  handleUnrescheduleLinked,
} from '../lib/booking/cancelRescheduleService.js';
import { handleRemoveLesson } from '../lib/booking/removeLessonService.js';
import { handleSync } from '../lib/booking/_syncHandler.js';
import { handleGetTeachers } from '../lib/booking/_teachersHandler.js';
import { purgeAllReservedPlaceholders } from '../lib/booking/domainInternals.js';

const router = Router();

router.get('/', (req, res) => res.json({ ok: true, message: 'Schedule API' }));
router.get('/week', handleGetWeek);
router.post('/renumber-month-titles', handleRenumberMonthTitles);
router.get('/booking-warning', async (req, res) => {
  try {
    const { date: dateQ, time: timeQ } = req.query || {};
    if (!dateQ || !timeQ) return res.json({ warn: false });
    res.json({ warn: false, message: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/teachers', handleGetTeachers);
router.post('/book', handleBookLesson);
router.post('/confirm-reserved', handleConfirmReserved);
router.post('/move-reserved', handleMoveReserved);
router.post('/create-reserved', handleCreateReserved);
router.post('/sync', handleSync);
router.post(/^\/(.+)\/reschedule-awaiting-date\/?$/, handleRescheduleAwaitingDate);
router.patch(/^\/(.+)\/cancel\/?$/, handleCancel);
router.patch(/^\/(.+)\/uncancel\/?$/, handleUncancel);
router.patch(/^\/(.+)\/reschedule\/?$/, handleLegacyReschedule);
router.post('/reschedule-linked', handleRescheduleLinked);
router.post('/unreschedule-linked', handleUnrescheduleLinked);
router.delete(/^\/(.+)\/?$/, handleRemoveLesson);

export { purgeAllReservedPlaceholders, renumberMonthLessonTitlesForStudent };
export default router;
