import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const built = await build({entryPoints:[fileURLToPath(new URL('../../context/training-workspace.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'}});
const {createTrainingWorkspace}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(request,mode='trainer') {
 const handlers={};globalThis.document={addEventListener:(name,cb)=>handlers[name]=cb};
 let active;const workspace=createTrainingWorkspace({client:{request,me:async()=>({id:active})},mode,onChange(){},onAuthError(){}});
 const ensure=workspace.ensure;workspace.ensure=id=>{active=id;ensure(id);};
 return {workspace,handlers};
}
const group={competencyId:'skill-one',competency:{code:'PLC',name:'PLC <safety>'},assignments:[{learningItem:{id:'item',status:'PENDING',objective:'Practice & improve',plan:{attempt:{target:{applicant:{id:'applicant',legalName:'Learner <script>'}}}}}}],sessions:[]};
test('trainer dashboard groups actual trainees, escapes labels and has honest empty states',async()=>{
 const {workspace}=setup(async()=>[group]);workspace.ensure('trainer-one');await flush();
 const html=workspace.view();assert.ok(html.includes('PLC &lt;safety&gt;'));assert.ok(html.includes('Learner &lt;script&gt;'));assert.ok(html.includes('Practice &amp; improve'));assert.ok(html.includes('Schedule training'));assert.ok(html.includes('Your calendar is clear'));assert.ok(!html.includes('Learner <script>'));
 workspace.reset();assert.ok(!workspace.view().includes('Learner'));
});
test('a late response cannot expose the previous trainers trainees',async()=>{
 let resolve;const {workspace}=setup(()=>new Promise(r=>resolve=r));workspace.ensure('first');await flush();workspace.reset();resolve([group]);await flush();assert.ok(!workspace.view().includes('Learner'));assert.ok(!workspace.view().includes('PLC'));
});
test('schedule form sends East Africa Time as UTC and retains values on failure',async()=>{
 const calls=[];const {workspace,handlers}=setup(async(path,options)=>{calls.push({path,options});if(options)throw new Error('These dates overlap another training session');return [group];});
 workspace.ensure('trainer');await flush();workspace.view();
 const original=globalThis.FormData;
 globalThis.FormData=class{constructor(){return Object.entries({title:'PLC session',startsAt:'2030-01-01T09:00',endsAt:'2030-01-01T11:00',location:'Engineering lab',capacity:'20'});}};
 try{const form={dataset:{trainingForm:'session'}};handlers.submit({target:{closest:()=>form},preventDefault(){}});await flush();const body=calls.find(c=>c.options)?.options.body;assert.equal(body.startsAt,'2030-01-01T06:00:00.000Z');assert.equal(body.endsAt,'2030-01-01T08:00:00.000Z');assert.equal(body.competencyId,'skill-one');assert.equal(body.capacity,20);assert.ok(workspace.view().includes('These dates overlap'));assert.ok(workspace.view().includes('value="PLC session"'));}finally{globalThis.FormData=original;}
});
test('admin page exposes teaching skill assignment and real learning item matching',async()=>{
 const {workspace}=setup(async()=>({trainers:[],competencies:[],items:[],total:0,page:1}),'admin');workspace.ensure('admin');await flush();const html=workspace.view();assert.ok(html.includes('Assign teaching skill'));assert.ok(html.includes('No approved trainers yet'));assert.ok(html.includes('No open skill gaps found'));
});
