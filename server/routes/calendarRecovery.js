import { Router } from 'express';
import { google } from 'googleapis';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool, query } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { logChange } from '../lib/changeLog.js';
import { groupRecoveryRows, classifyRecovery, recoveryPayload, relinkRecovery, assertRecoveryRowsUnchanged } from '../lib/calendarRecovery.js';

function setup() {
  const calendars = JSON.parse(process.env.CALENDAR_RECOVERY_CALENDARS_JSON || '[]');
  if (!Array.isArray(calendars) || !calendars.length || calendars.some(c => !c.id || !c.label)) throw new Error('Calendar recovery calendars are not configured.');
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
    ? JSON.parse(readFileSync(resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH), 'utf8'))
    : JSON.parse(raw?.startsWith('{') ? raw : Buffer.from(raw || '', 'base64').toString());
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.readonly'] });
  return { calendars, email: credentials.client_email, api: google.calendar({ version: 'v3', auth }) };
}
function range(body) {
  const { from, to, studentId } = body;
  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
  if (!validDate(from) || !validDate(to) || to < from || Date.parse(to)-Date.parse(from) > 366*86400000 || !Number.isInteger(Number(studentId)) || Number(studentId)<1) throw new Error('Choose a student ID and valid date range of at most one year.');
  return { from,to,studentId:Number(studentId) };
}
async function readEvents(api, calendars, from, to) {
  const timeMin=from+'T00:00:00+09:00';
  const timeMax=new Date(Date.parse(to+'T00:00:00+09:00')+86400000).toISOString();
  const events=[];
  for(const calendar of calendars) {
    // A missing/inaccessible calendar is an error, never evidence that its lessons vanished.
    try {
      await api.calendars.get({ calendarId:calendar.id },{timeout:30000});
      let pageToken;
      do {
        const response=await api.events.list({ calendarId:calendar.id,timeMin,timeMax,singleEvents:true,showDeleted:false,maxResults:2500,pageToken },{timeout:30000});
        events.push(...(response.data.items || []).map(e=>({...e,calendarId:calendar.id})));
        pageToken=response.data.nextPageToken;
      } while(pageToken);
    } catch(error) { throw new Error(`Cannot verify ${calendar.label}. Check Calendar sharing and access before recovery. No lessons have been classified as missing. (${error.code || 'network error'})`); }
  }
  return events;
}
async function loadRows(selection, dbQuery) {
  // Load every member of matching group lessons, not only the filtered student.
  const r=await dbQuery(`SELECT m.* FROM monthly_schedule m WHERE m.event_id IN (SELECT event_id FROM monthly_schedule WHERE student_id=$1 AND date BETWEEN $2::date AND $3::date) ORDER BY m.start,m.event_id,m.student_name`,[selection.studentId,selection.from,selection.to]);
  return r.rows;
}
export function createCalendarRecoveryRouter({ getConfig = setup, db = { query, pool }, audit = logChange } = {}) {
const router = Router();
router.use(requireAdmin);
router.get('/settings', (_req,res)=>{
  try {const config=getConfig();res.json({calendars:config.calendars,serviceAccountEmail:config.email});}
  catch(error){res.status(503).json({error:error.message});}
});
router.post('/preview',async(req,res)=>{
  try {
    const selection=range(req.body || {}), config=getConfig();
    if(!config.calendars.some(c=>c.id===req.body.calendarId))return res.status(400).json({error:'Select a configured recovery calendar.'});
    const rows=await loadRows(selection, db.query);
    const events=await readEvents(config.api,config.calendars,selection.from,selection.to);
    const items=groupRecoveryRows(rows).map(g=>classifyRecovery(g,events,req.body.calendarId));
    res.set('Cache-Control','no-store').json({items,counts:items.reduce((a,i)=>({...a,[i.status]:(a[i.status]||0)+1}),{}),checkedAt:new Date().toISOString()});
  }catch(error){res.status(400).json({error:error.message});}
});
router.post('/rebuild',async(req,res)=>{
  let client, prepared=false;
  const oldId=String(req.body?.eventId || '');
  try {
    const selection=range(req.body || {}), config=getConfig(), calendarId=req.body.calendarId;
    if(!oldId || !config.calendars.some(c=>c.id===calendarId))return res.status(400).json({error:'Select a lesson and configured calendar.'});
    const previous=await db.query('SELECT * FROM calendar_event_recoveries WHERE old_event_id=$1',[oldId]);
    if(previous.rows[0]?.state==='linked')return res.json({ok:true,alreadyLinked:true,newEventId:previous.rows[0].new_event_id});
    if(previous.rows[0] && previous.rows[0].calendar_id!==calendarId)throw new Error('A recovery is already prepared for another calendar. Do not create another copy.');
    const rows=await loadRows(selection, db.query), group=groupRecoveryRows(rows).find(g=>g.eventId===oldId);
    if(!group)throw new Error('Lesson no longer exists in this selection. Refresh preview.');
    const events=await readEvents(config.api,config.calendars,selection.from,selection.to);
    const check=classifyRecovery(group,events,calendarId);
    if(check.status!=='missing')return res.status(409).json({error:'Rebuild blocked: '+check.status,check});
    const payload=recoveryPayload(group,calendarId);
    await db.query(`INSERT INTO calendar_event_recoveries(old_event_id,calendar_id,google_event_id,snapshot) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(old_event_id) DO NOTHING`,[oldId,calendarId,payload.id,JSON.stringify(group.members)]);
    prepared=true;
    client=await db.pool.connect();await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[oldId]);
    const journal=await client.query('SELECT * FROM calendar_event_recoveries WHERE old_event_id=$1 FOR UPDATE',[oldId]);
    if(journal.rows[0].calendar_id!==calendarId || journal.rows[0].google_event_id!==payload.id)throw new Error('Recovery target changed. Manual review required.');
    if(journal.rows[0].state==='linked'){await client.query('COMMIT');return res.json({ok:true,alreadyLinked:true,newEventId:journal.rows[0].new_event_id});}
    const lockedRows=await client.query('SELECT * FROM monthly_schedule WHERE event_id=$1 FOR UPDATE',[oldId]);
    assertRecoveryRowsUnchanged(lockedRows.rows, group);
    let event;
    try{event=(await config.api.events.get({calendarId,eventId:payload.id},{timeout:30000})).data;}
    catch(error){
      if(Number(error.code)!==404)throw error;
      try{event=(await config.api.events.insert({calendarId,requestBody:payload,sendUpdates:'none'},{timeout:30000})).data;}
      catch(insertError){
        // Timeout/409 may mean Google already accepted it. Never create a second random ID.
        try{event=(await config.api.events.get({calendarId,eventId:payload.id},{timeout:30000})).data;}catch{throw insertError;}
      }
    }
    if(event.summary!==group.title||event.status==='cancelled'||event.extendedProperties?.private?.adminRecoveryOldEventId!==oldId||event.extendedProperties?.private?.lessonUuid!==String(group.members[0].lesson_uuid)||new Date(event.start.dateTime).toISOString()!==group.start||new Date(event.end.dateTime).toISOString()!==group.end)throw new Error('Recovery event identity or times do not match. Manual review required.');
    const newId=await relinkRecovery(client,group,event,calendarId);
    await client.query('COMMIT');
    await audit({entityType:'monthly_schedule',entityKey:newId,action:'calendar_rebuild',oldData:{event_id:oldId,lesson_uuid:group.members[0].lesson_uuid},newData:{event_id:newId,calendar_google_event_id:event.id,calendar_id:calendarId,lesson_uuid:group.members[0].lesson_uuid}},req).catch(e=>console.error('[calendar-recovery] audit failed',e.message));
    res.json({ok:true,newEventId:newId,googleEventId:event.id});
  }catch(error){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    if(prepared)await db.query('UPDATE calendar_event_recoveries SET last_error=$2 WHERE old_event_id=$1',[oldId,error.message]).catch(()=>{});
    console.error('[calendar-recovery]',error.message);
    res.status(409).json({error:error.message,retrySafe:true});
  }finally{client?.release();}
});
return router;
}
export default createCalendarRecoveryRouter();
