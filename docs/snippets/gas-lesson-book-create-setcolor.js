// Paste into doPost → lesson_book_create, after event is created/updated, before cacheMonthlyEventsForBothMonths()
// Server sends body.colorId: "10" (Basil green) for regular/owner, "5" (Banana) for demo.

var colorIdCreate = String(body.colorId || '').trim();
if (colorIdCreate) {
  try {
    event.setColor(colorIdCreate);
  } catch (colorErrCreate) {}
}
