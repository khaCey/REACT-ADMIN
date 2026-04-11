// Paste into doPost → lesson_book_create, after event is created/updated, before cacheMonthlyEventsForBothMonths()
// Server sends body.colorId only for regular lessons ("10" = Basil). Demo/owner omit colorId — keep calendar default.

var colorIdCreate = String(body.colorId || '').trim();
if (colorIdCreate) {
  try {
    event.setColor(colorIdCreate);
  } catch (colorErrCreate) {}
}
