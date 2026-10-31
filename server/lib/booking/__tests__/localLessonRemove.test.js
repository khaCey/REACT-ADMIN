import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalLessonRemoveHandler } from '../localLessonRemove.js';
const row=(extra={})=>({event_id:'calendar-id',student_id:1,student_name:'Student One',lesson_uuid:'unchanged',date:'2026-10-31',start:'2026-10-31T02:00:00Z',...extra});
function fixture(rows=[row(),row({student_id:2,student_name:'Student Two'})],failAudit=false){
 const state={rows:[...rows],dismissals:[],sql:[],audit:[],connections:0};let snapshot;
 const client={release(){},async query(sql,args=[]){state.sql.push({sql,args});
  if(sql==='BEGIN')snapshot={rows:[...state.rows],dismissals:[...state.dismissals]};
  if(sql==='ROLLBACK'){state.rows=snapshot.rows;state.dismissals=snapshot.dismissals;}
  if(sql.startsWith('SELECT *'))return{rows:state.rows.filter(r=>r.event_id===args[0]&&r.student_id===args[1])};
  if(sql.startsWith('INSERT INTO schedule_slot_dismissals'))state.dismissals.push(args);
  if(sql.startsWith('DELETE FROM monthly_schedule')){const before=state.rows.length;state.rows=state.rows.filter(r=>r.event_id!==args[0]||r.student_id!==args[1]);return{rowCount:before-state.rows.length};}
  return{rows:[],rowCount:1};
 }};
 const handler=createLocalLessonRemoveHandler({dbPool:{connect:async()=>{state.connections++;return client}},audit:async(entry,_req,transaction)=>{assert.equal(transaction,client);if(failAudit)throw Error('audit failed');state.audit.push(entry)}});
 async function call(body={eventId:'calendar-id',studentId:1},staff={id:3}){let status=200,data;const res={status(n){status=n;return this},json(v){data=v;return this}};await handler({body,staff},res);return{status,data};}
 return{state,call};
}
test('database-only removal keeps other group members and never contacts Calendar',async()=>{
 const f=fixture(),saved=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('Calendar must not be called')};
 try{const r=await f.call();assert.equal(r.status,200);assert.equal(r.data.calendarChanged,false);assert.equal(f.state.rows.length,1);assert.equal(f.state.rows[0].student_id,2);assert.equal(f.state.dismissals.length,1);assert.equal(f.state.audit[0].action,'delete_local');assert.equal(f.state.audit[0].oldData.lesson_uuid,'unchanged');assert.equal(f.state.sql.some(q=>/lesson_notes|reschedules|payments/.test(q.sql)),false);assert.equal(network,0)}finally{globalThis.fetch=saved}
});
test('authentication and exact student identity are mandatory',async()=>{const f=fixture();assert.equal((await f.call({},null)).status,401);assert.equal((await f.call({eventId:'calendar-id'})).status,400);assert.equal(f.state.connections,0);assert.equal((await f.call({eventId:'calendar-id',studentId:99})).status,404);assert.equal(f.state.rows.length,2)});
test('dismissal and deletion roll back together when audit fails',async()=>{const f=fixture(undefined,true);assert.equal((await f.call()).status,500);assert.equal(f.state.rows.length,2);assert.equal(f.state.dismissals.length,0);assert.equal(f.state.sql.at(-1).sql,'ROLLBACK')});
test('one event ID spanning multiple occurrences cannot be bulk-deleted',async()=>{const f=fixture([row(),row({date:'2026-11-07',start:'2026-11-07T02:00:00Z'})]);assert.equal((await f.call()).status,409);assert.equal(f.state.rows.length,2);assert.equal(f.state.dismissals.length,0)});
test('incomplete local-only bookings can be removed without inventing a Calendar dismissal',async()=>{const f=fixture([row({event_id:'local-booking-123',date:null,start:null})]);assert.equal((await f.call({eventId:'local-booking-123',studentId:1})).status,200);assert.equal(f.state.dismissals.length,0)});
