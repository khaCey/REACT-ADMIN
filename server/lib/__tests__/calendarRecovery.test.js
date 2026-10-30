import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRecoveryRows, classifyRecovery, recoveryPayload, relinkRecovery, recoveryGoogleId } from '../calendarRecovery.js';
import { deleteBookedLessonEventInGas, deleteReservedCalendarSeriesInGas } from '../bookingCalendarSync.js';
const row = (extra={}) => ({event_id:'old@google.com_2026-07-02_02-00-00', calendar_source_event_id:'old@google.com', calendar_google_event_id:null, lesson_uuid:'same-uuid', student_id:635,student_name:'Akihiro Noguchi',start:'2026-07-02T02:00:00Z',end:'2026-07-02T02:50:00Z',status:'scheduled',calendar_sync_status:'synced',title:'Akihiro Noguchi (Cafe) 1/5',lesson_mode:'cafe',...extra});
const group = extra => groupRecoveryRows([row(extra)])[0];
test('local-only, pending and unlinked records cannot be rebuilt',()=>{
 for(const extra of [{event_id:'local-booking-abc',calendar_source_event_id:'wrong@google.com'},{calendar_sync_status:'pending'},{student_id:null},{calendar_source_event_id:null,event_id:'unknown'}])assert.equal(classifyRecovery(group(extra),[],'schedule').status,'excluded');
});
test('Google API occurrence and legacy iCal identities find the existing lesson across calendars',()=>{
 const event={id:'old_20260702T020000Z',iCalUID:'old@google.com',start:{dateTime:'2026-07-02T11:00:00+09:00'}};
 assert.equal(classifyRecovery(group(),[event],'schedule').status,'present');
 assert.equal(classifyRecovery(group({calendar_google_event_id:event.id}),[event],'schedule').status,'present');
});
test('a replacement at the same student/time blocks duplicate creation; empty verified snapshots are eligible',()=>{
 const g=group();
 assert.equal(classifyRecovery(g,[],'schedule').status,'missing');
 assert.equal(classifyRecovery(g,[{id:'another',summary:g.title,start:{dateTime:g.start},end:{dateTime:g.end}}],'schedule').status,'review');
});
test('all group members share one recovered event and identity conflicts are excluded',()=>{
 const g=groupRecoveryRows([row(),row({student_id:636,student_name:'Other Student'})]);
 assert.equal(g.length,1);assert.equal(g[0].members.length,2);
 const conflicting=groupRecoveryRows([row(),row({student_name:'Other',calendar_source_event_id:'other@google.com'})])[0];
 assert.equal(classifyRecovery(conflicting,[],'schedule').reason,'ambiguous_calendar_identity');
});
test('retry payload has a deterministic valid Calendar ID, stable UUID, original title/time and no recurrence',()=>{
 const p=recoveryPayload(group(),'schedule');
 assert.match(p.id,/^[0-9a-v]+$/);assert.equal(p.id,recoveryPayload(group(),'schedule').id);
 assert.notEqual(p.id,recoveryGoogleId(group().eventId,'another-calendar'));
 assert.equal(p.extendedProperties.private.lessonUuid,'same-uuid');assert.equal(p.summary,row().title);
 assert.equal(p.start.dateTime,'2026-07-02T02:00:00.000Z');assert.equal(p.recurrence,undefined);
});
test('a Google creation awaiting database relink is retried rather than duplicated',()=>{
 const g=group(), p=recoveryPayload(g,'schedule');
 assert.equal(classifyRecovery(g,[{...p}], 'schedule').reason,'created_awaiting_link');
});
test('relink keeps UUID/notes while updating the PK, Calendar IDs, reschedules, demo references and journal',async()=>{
 const calls=[];const client={query:async(sql,args)=>{calls.push({sql,args});return{rows:sql.startsWith('SELECT')?[row()]:[],rowCount:1}}};
 const newId=await relinkRecovery(client,group(),{id:'new123',iCalUID:'new123@google.com'},'schedule');
 assert.equal(newId,'new123@google.com_2026-07-02_02-00-00');
 const update=calls.find(c=>c.sql.startsWith('UPDATE monthly_schedule'));
 assert.ok(update);assert.equal(update.sql.includes('lesson_uuid='),false);
 assert.equal(calls.some(c=>c.sql.includes('lesson_notes')),false);
 assert.equal(calls.filter(c=>c.sql.startsWith('UPDATE reschedules')).length,2);
 assert.ok(calls.some(c=>c.sql.includes("state='linked'")));
});
test('a lesson changed since preview is rejected before any identifier update',async()=>{
 let writes=0;const client={query:async(sql)=>{if(sql.startsWith('UPDATE'))writes++;return{rows:[row({status:'cancelled'})]}}};
 await assert.rejects(()=>relinkRecovery(client,group(),{id:'new'},'schedule'),/changed during recovery/);assert.equal(writes,0);
});
test('all Calendar deletion gateways refuse before any network request',async()=>{
 const saved=globalThis.fetch;let called=0;globalThis.fetch=async()=>{called++;throw Error('Must never run')};
 try{for(const result of [await deleteBookedLessonEventInGas('old'),await deleteReservedCalendarSeriesInGas({seriesMasterId:'old'})]){assert.equal(result.ok,false);assert.equal(result.actionTaken,'deletion_disabled')}assert.equal(called,0)}finally{globalThis.fetch=saved}
});

test('polling quarantines pending new IDs and refuses retired old identities after linking',async()=>{
 const { recoveryPollGuards } = await import('../calendarRecovery.js');
 const guard = recoveryPollGuards([{old_event_id:'old-one',google_event_id:'new-one',state:'prepared'},{old_event_id:'old-two',google_event_id:'new-two',state:'linked'}]);
 assert.equal(guard.preparedRawIds.has('new-one@google.com'),true);
 assert.equal(guard.preparedRawIds.has('new-two@google.com'),false);
 assert.equal(guard.retiredMonthlyIds.has('old-two'),true);
 assert.equal(guard.retiredMonthlyIds.has('old-one'),false);
});
