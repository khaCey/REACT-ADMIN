import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryGasConfig } from '../calendarRecoveryGas.js';

test('recovery uses existing booking API and preserves exact Google metadata through GAS', async()=>{
 const saved=globalThis.fetch;const old={url:process.env.BOOKING_GAS_URL,key:process.env.BOOKING_API_KEY};
 process.env.BOOKING_GAS_URL='https://script.google.com/macros/s/test/exec';process.env.BOOKING_API_KEY='test-key';
 const calls=[];
 globalThis.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);calls.push(body);assert.equal(new URL(url).searchParams.get('key'),'test-key');assert.equal(body.key,undefined);return{ok:true,status:200,json:async()=>body.operation==='capabilities'?{ok:true,calendarRecoveryVersion:1,calendars:[{id:'actual-gas-calendar',label:'Schedule'}]}:{ok:true,data:{items:[{id:'exact',iCalUID:'uid',extendedProperties:{private:{lessonUuid:'uuid'}}}],nextPageToken:'next'}}}};
 try{const config=await createRecoveryGasConfig();assert.equal(config.calendars[0].id,'actual-gas-calendar');const result=await config.api.events.list({calendarId:'actual-gas-calendar',timeMin:'a',timeMax:'b',pageToken:'previous'});assert.equal(result.data.items[0].iCalUID,'uid');assert.equal(result.data.nextPageToken,'next');assert.equal(calls[1].pageToken,'previous');assert.equal(calls[0].action,'calendar_recovery_v1');assert.equal(config.email,undefined)}
 finally{globalThis.fetch=saved;if(old.url===undefined)delete process.env.BOOKING_GAS_URL;else process.env.BOOKING_GAS_URL=old.url;if(old.key===undefined)delete process.env.BOOKING_API_KEY;else process.env.BOOKING_API_KEY=old.key;}
});
test('old GAS response cannot masquerade as a verified empty Calendar snapshot',async()=>{
 const saved=globalThis.fetch;const old={url:process.env.BOOKING_GAS_URL,key:process.env.BOOKING_API_KEY};process.env.BOOKING_GAS_URL='https://script.google.com/test';process.env.BOOKING_API_KEY='test';
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({ok:true,message:'Webhook processed'})});
 try{await assert.rejects(createRecoveryGasConfig(),/extension is not deployed/)}finally{globalThis.fetch=saved;if(old.url===undefined)delete process.env.BOOKING_GAS_URL;else process.env.BOOKING_GAS_URL=old.url;if(old.key===undefined)delete process.env.BOOKING_API_KEY;else process.env.BOOKING_API_KEY=old.key;}
});
