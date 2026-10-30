import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCalendarRecoveryRouter } from '../calendarRecovery.js';

function fixture({ denied=false, failLink=false }={}) {
 const row={event_id:'old@google.com_2026-07-02_02-00-00',calendar_source_event_id:'old@google.com',student_id:635,student_name:'Akihiro Noguchi',lesson_uuid:'uuid',start:'2026-07-02T02:00:00Z',end:'2026-07-02T02:50:00Z',title:'Akihiro Noguchi (Cafe) 1/5',status:'scheduled',calendar_sync_status:'synced'};
 const state={events:[],journal:null,creates:0,commits:0,rollbacks:0,failLink,links:[]};
 const api={calendars:{get:async()=>{if(denied)throw Object.assign(Error('denied'),{code:403});return{data:{id:'schedule'}}}},events:{
  list:async()=>({data:{items:state.events}}),get:async({eventId})=>{const event=state.events.find(e=>e.id===eventId);if(!event)throw Object.assign(Error('missing'),{code:404});return{data:event}},
  insert:async({requestBody,sendUpdates})=>{assert.equal(sendUpdates,'none');state.creates++;const event={...requestBody,iCalUID:requestBody.id+'@google.com'};state.events.push(event);return{data:event}}
 }};
 const db={query:async(sql,args)=>{
  if(sql.startsWith('SELECT m.*'))return{rows:[row]};
  if(sql.startsWith('SELECT * FROM calendar_event_recoveries'))return{rows:state.journal?[state.journal]:[]};
  if(sql.startsWith('INSERT INTO calendar_event_recoveries'))state.journal||={old_event_id:args[0],calendar_id:args[1],google_event_id:args[2],state:'prepared'};
  return{rows:[],rowCount:1};
 },pool:{connect:async()=>({release(){},query:async(sql,args)=>{
  if(sql==='COMMIT')state.commits++;
  if(sql==='ROLLBACK')state.rollbacks++;
  if(sql.startsWith('SELECT * FROM calendar_event_recoveries'))return{rows:[state.journal]};
  if(sql.startsWith('SELECT * FROM monthly_schedule'))return{rows:[row]};
  if(sql.startsWith('UPDATE monthly_schedule'))state.links.push(args);
  if(sql.startsWith('UPDATE reschedules')&&state.failLink){state.failLink=false;throw Error('simulated database failure')}
  if(sql.startsWith('UPDATE calendar_event_recoveries'))state.journal={...state.journal,state:'linked',new_event_id:args[1]};
  return{rows:[],rowCount:1};
 }})}};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.headers.authorization)req.staff={id:1,name:req.headers.authorization,is_admin:req.headers.authorization==='admin'};next()});
 app.use(createCalendarRecoveryRouter({getConfig:()=>({calendars:[{id:'schedule',label:'Schedule'}],email:'test@example.com',api}),db,audit:async()=>{}}));
 return {app,state};
}
async function serve(t, options) {
 const f=fixture(options);const server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const url='http://127.0.0.1:'+server.address().port;
 return {...f,post:async(path,body={},auth='admin')=>fetch(url+path,{method:'POST',headers:{...(auth?{Authorization:auth}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)})};
}
const selection={from:'2026-07-01',to:'2026-07-31',studentId:635,calendarId:'schedule',eventId:'old@google.com_2026-07-02_02-00-00'};
test('recovery requires admin access',async t=>{const f=await serve(t);assert.equal((await f.post('/preview',selection,null)).status,401);assert.equal((await f.post('/preview',selection,'staff')).status,403);assert.equal(f.state.creates,0)});
test('inaccessible Calendar is an error, never a missing-event result',async t=>{const f=await serve(t,{denied:true});const r=await f.post('/preview',selection);assert.equal(r.status,400);const j=await r.json();assert.match(j.error,/Cannot verify/);assert.equal(j.items,undefined);assert.equal(f.state.creates,0)});
test('rebuild rechecks, creates one deterministic event, relinks, and replay creates nothing',async t=>{const f=await serve(t);assert.equal((await f.post('/rebuild',selection)).status,200);assert.equal((await f.post('/rebuild',selection)).status,200);assert.equal(f.state.creates,1);assert.equal(f.state.journal.state,'linked');assert.equal(f.state.commits,1);assert.equal(f.state.links[0][0],selection.eventId);assert.equal(f.state.links[0][3],f.state.events[0].id)});
test('database failure after Google creation rolls back; retry relinks the same event',async t=>{const f=await serve(t,{failLink:true});assert.equal((await f.post('/rebuild',selection)).status,409);assert.equal(f.state.rollbacks,1);assert.equal(f.state.journal.state,'prepared');assert.equal(f.state.creates,1);assert.equal((await f.post('/rebuild',selection)).status,200);assert.equal(f.state.creates,1);assert.equal(f.state.journal.state,'linked')});
