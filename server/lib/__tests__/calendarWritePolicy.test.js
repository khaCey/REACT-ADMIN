import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWritesEnabled, calendarWritePauseMiddleware } from '../calendarWritePolicy.js';
import { createBookedLessonEventInGas, updateBookedLessonEventInGas, createReservedRecurringHoldInGas } from '../bookingCalendarSync.js';
import { createRecoveryGasConfig } from '../calendarRecoveryGas.js';
import { runDailyLessonCounterReconciliation, reconcileCountersForAffectedRows } from '../booking/lessonCounterReconcile.js';
test('pause blocks every Calendar write before any fetch or DB call; reads and local removal remain available', async () => {
 const old=process.env.CALENDAR_WRITES_ENABLED, fetchBefore=globalThis.fetch;
 let requests=0, queries=0;
 globalThis.fetch=async()=>{ requests++; throw Error('Unexpected network access'); };
 try {
  delete process.env.CALENDAR_WRITES_ENABLED;
  assert.equal(calendarWritesEnabled(),false);
  for(const value of ['false','0','TRUE','']) { process.env.CALENDAR_WRITES_ENABLED=value; assert.equal(calendarWritesEnabled(),false); }
  process.env.CALENDAR_WRITES_ENABLED='false';
  for(const fn of [()=>createBookedLessonEventInGas({}),()=>updateBookedLessonEventInGas('test',{}),()=>createReservedRecurringHoldInGas({})]) assert.equal((await fn()).actionTaken,'writes_disabled');
  const db=async()=>{queries++;throw Error('Unexpected database access');};
  assert.equal((await runDailyLessonCounterReconciliation(db)).skipped,true);
  assert.equal((await reconcileCountersForAffectedRows([],db)).skipped,true);
  for(const path of ['/SCHEDULE/book','/schedule/book','/schedule/sync','/schedule/create-reserved','/schedule/move-reserved','/schedule/event/cancel','/schedule/event/reschedule','/schedule/renumber-month-titles','/calendar-recovery/rebuild']) {
   let status,body,next=false;
   calendarWritePauseMiddleware({method:'POST',path},{status(s){status=s;return this;},json(b){body=b;}},()=>{next=true;});
   assert.equal(status,423,path);assert.equal(body.code,'CALENDAR_WRITES_DISABLED');assert.equal(next,false);
  }
  for(const req of [{method:'GET',path:'/schedule/week'},{method:'POST',path:'/schedule/remove-local'},{method:'POST',path:'/calendar-recovery/preview'},{method:'POST',path:'/payments'}]) {
   let next=false;calendarWritePauseMiddleware(req,{},()=>{next=true;});assert.equal(next,true);
  }
  assert.equal(requests,0);assert.equal(queries,0);
  // Recovery inspection is allowed, but insertion must stop before its network request.
  process.env.BOOKING_GAS_URL='https://example.test/exec';process.env.BOOKING_API_KEY='fake';
  globalThis.fetch=async()=>{requests++;return{ok:true,status:200,json:async()=>({ok:true,calendarRecoveryVersion:1,calendars:[{id:'test',label:'Test'}]})};};
  const config=await createRecoveryGasConfig();assert.equal(requests,1);
  await assert.rejects(config.api.events.insert({calendarId:'test',requestBody:{}}),/paused/);assert.equal(requests,1);
  process.env.CALENDAR_WRITES_ENABLED='true';assert.equal(calendarWritesEnabled(),true);
 } finally {globalThis.fetch=fetchBefore;if(old===undefined)delete process.env.CALENDAR_WRITES_ENABLED;else process.env.CALENDAR_WRITES_ENABLED=old;}
});
