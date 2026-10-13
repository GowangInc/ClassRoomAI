import {mountTools, renderArtifact, youtubeId} from './tools.js';
import {mountAlertPanel} from './alerts.js';

const main = document.querySelector('#main');
const navigation = document.querySelector('#navigation');
const modal = document.querySelector('#modal');
const errorRegion = document.querySelector('#errors');
const notices = document.querySelector('#notifications');
const TOOL_TYPES = ['document','doodle','mindmap','flashcards','presentation','graph','video','image'];
const LANGUAGE_OPTIONS = [
  ['en','English'],['es','Spanish'],['es-419','Spanish (Latin America)'],['af','Afrikaans'],['ar','Arabic'],['hy','Armenian'],['az','Azerbaijani'],['be','Belarusian'],['bg','Bulgarian'],['bs','Bosnian'],['ca','Catalan'],['yue','Cantonese'],
  ['zh-CN','Chinese (Simplified)'],['zh-TW','Chinese (Traditional)'],['hr','Croatian'],['cs','Czech'],['da','Danish'],['fa','Persian'],['nl','Dutch'],['et','Estonian'],['fi','Finnish'],['fr','French'],['gl','Galician'],['de','German'],['el','Greek'],['he','Hebrew'],
  ['hi','Hindi'],['hu','Hungarian'],['is','Icelandic'],['id','Indonesian'],['it','Italian'],['ja','Japanese'],['kn','Kannada'],['kk','Kazakh'],['ko','Korean'],['lv','Latvian'],['lt','Lithuanian'],['mk','Macedonian'],['ms','Malay'],['mr','Marathi'],['mi','Māori'],
  ['ne','Nepali'],['no','Norwegian'],['pl','Polish'],['pt','Portuguese'],['pt-BR','Portuguese (Brazil)'],['pt-PT','Portuguese (Portugal)'],['ro','Romanian'],['ru','Russian'],['sr','Serbian'],['sk','Slovak'],['sl','Slovenian'],['sw','Swahili'],['sv','Swedish'],
  ['tl','Tagalog'],['ta','Tamil'],['th','Thai'],['tr','Turkish'],['uk','Ukrainian'],['ur','Urdu'],['vi','Vietnamese'],['cy','Welsh']
].map(([value,label])=>({value,label}));
const ACCEPT = '.txt,.md,.csv,.pdf,.docx,.png,.jpg,.jpeg,.gif';
const state = {teacher:null,student:null,setupRequired:false};
const interventionDrafts = new Map();
let cleanup = () => {}, revision = 0;
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const string = value => typeof value === 'string' ? value : '';
const pathId = id => encodeURIComponent(String(id));
const lines = value => value.split('\n').map(value=>value.trim()).filter(Boolean);
function el(tag, content, attrs = {}) {
  const element = document.createElement(tag);
  if (content !== undefined && content !== null) element.textContent = String(content);
  for (const [key,value] of Object.entries(attrs)) {
    if (key === 'class') element.className = value;
    else if (value !== undefined && value !== null) element.setAttribute(key,String(value));
  }
  return element;
}
function append(parent, ...children) {parent.append(...children.filter(Boolean));return parent;}
function button(label, handler, className = '') {
  const element=el('button',label,{type:'button',class:className});
  element.addEventListener('click',()=>guard(handler,element));return element;
}
function link(label, href, className = '') {return el('a',label,{href,class:className});}
function icon(name){
  const paths={menu:'M4 6h16M4 12h16M4 18h16',library:'M4 4h6v16H4zM14 4h6v16h-6z',sessions:'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',profile:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',join:'M14 4h6v16h-6M3 12h12M10 7l5 5-5 5',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',play:'m8 5 11 7-11 7z',send:'m3 3 18 9-18 9 3-9zM6 12h15',copy:'M9 9h11v11H9zM15 9V4H4v11h5',listen:'m4 9 5 0 5-5v16l-5-5H4zM18 8a6 6 0 0 1 0 8',thumb:'M8 10h-5v11h5M8 20h10l3-9h-8l1-6a2 2 0 0 0-4-1l-2 6z',attach:'m9 16 7-7a3 3 0 0 0-4-4L4 13a5 5 0 0 0 7 7l8-8',mic:'M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM6 10v1a6 6 0 0 0 12 0v-1M12 17v4M8 21h8',access:'M14 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0M4 9l8 2 8-2M12 11v5M8 22l4-6 4 6',tools:'M3 4h8v7H3zM14 4h7v7h-7zM3 14h8v7H3zM14 14h7v7h-7z',plan:'M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1',close:'m6 6 12 12M18 6 6 18',language:'M3 5h12M9 3v2M6 5c0 6 5 10 9 11M13 5c0 6-5 10-9 11M14 21l4-10 4 10M16 17h4'};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const[key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:'button-icon'}))svg.setAttribute(key,value);
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.tools);svg.append(path);return svg;
}
function iconButton(label,name,handler,className='icon-button'){const control=button('',handler,className);control.setAttribute('aria-label',label);control.title=label;control.append(icon(name));return control;}
function field(label,value = '',type = 'text',hint = '') {
  const wrapper=el('label',undefined,{class:'field'});wrapper.append(el('span',label));
  const input=el(type==='textarea'?'textarea':type==='select'?'select':'input');
  if(!['textarea','select'].includes(type))input.type=type;
  input.value=String(value??'');wrapper.append(input);if(hint)wrapper.append(el('small',hint));
  return {wrapper,input};
}
function selectField(label,values,value = '') {
  const control=field(label,'','select');
  values.forEach(item=>{const option=typeof item==='string'?{value:item,label:item}:item;control.input.append(el('option',option.label,{value:option.value}));});control.input.value=value;return control;
}
function required(control,attrs = {}) {control.input.required=true;for(const [key,value]of Object.entries(attrs))control.input.setAttribute(key,String(value));return control;}
function submit(form,label,handler) {
  const element=el('button',label,{type:'submit',class:'primary'});form.append(element);
  form.addEventListener('submit',event=>{event.preventDefault();guard(()=>handler(new FormData(form)),element);});return element;
}
async function guard(handler,control) {
  if(control?.disabled)return;
  clearError();
  if(control){control.disabled=true;control.setAttribute('aria-busy','true');}
  try{await handler();}catch(error){showError(error);}
  finally{if(control?.isConnected){control.disabled=control.dataset.locked==='true';control.removeAttribute('aria-busy');}}
}
function clearError(){errorRegion.hidden=true;errorRegion.textContent='';}
function showError(error){errorRegion.textContent=error instanceof Error?error.message:String(error);errorRegion.hidden=false;}
function notify(message){notices.textContent=message;}
function preference(key,value){
  try{if(value!==undefined){sessionStorage.setItem(key,value);return value;}return sessionStorage.getItem(key)||'';}catch{return '';}
}
function validEnvelope(data){
  const isText=value=>typeof value==='string';
  const isList=(value,check)=>Array.isArray(value)&&value.every(check);
  const material=value=>{const item=record(value);return isText(item.id)&&isText(item.name)&&isText(item.mime)&&isText(item.text);};
  const message=value=>{const item=record(value);return isText(item.id)&&isText(item.content)&&['user','assistant','teacher'].includes(item.role)&&(!item.attachments||isList(item.attachments,material));};
  const artifact=value=>{const item=record(value);return isText(item.id)&&isText(item.type)&&isText(item.title)&&Object.hasOwn(item,'data');};
  const agendaStep=value=>{const item=record(value);return isText(item.title)&&isText(item.instructions)&&(item.tool===null||TOOL_TYPES.includes(item.tool));};
  const space=value=>{const item=record(value);return isText(item.id)&&isText(item.title)&&isList(item.outcomes,isText)&&isList(item.agenda,agendaStep)&&typeof item.showAgenda==='boolean'&&typeof item.allowLanguageChoice==='boolean'&&isText(item.audienceDetails)&&isText(item.interactionStyle)&&['student-learning','teacher-productivity','staff-operations'].includes(item.spaceType)&&['private','shared'].includes(item.visibility)&&isList(item.tools,isText)&&isList(item.materials,material);};
  const run=value=>{const item=record(value);return isText(item.id)&&isText(item.title)&&['active','paused','ended'].includes(item.status)&&space(item.space);};
  const participant=value=>{const item=record(value);return isText(item.id)&&isText(item.name)&&isText(item.runId)&&(!Object.hasOwn(item,'progress')||item.progress===null||(typeof item.progress==='number'&&Number.isFinite(item.progress)&&item.progress>=0&&item.progress<=100))&&(!Object.hasOwn(item,'progressStatus')||['not-assessed','current','pending','unavailable'].includes(item.progressStatus))&&(!Object.hasOwn(item,'progressEvidence')||isList(item.progressEvidence,isText))&&(!Object.hasOwn(item,'messages')||(isList(item.messages,message)&&isList(item.artifacts,artifact)));};
  const teacher=value=>{const item=record(value);return isText(item.id)&&isText(item.name)&&isText(item.email)&&typeof item.admin==='boolean';};
  const provider=value=>{const item=record(value);return isText(item.id)&&isText(item.name)&&isText(item.model)&&isText(item.baseUrl)&&['openai','anthropic','gemini'].includes(item.kind)&&typeof item.hasKey==='boolean'&&(!Object.hasOwn(item,'oauthProvider')||['openrouter','gemini'].includes(item.oauthProvider))&&!Object.hasOwn(item,'apiKey');};
  for(const [key,check] of Object.entries({space,run,participant,teacher,provider,material,artifact,message})){
    if(Object.hasOwn(data,key)&&data[key]!==null&&!check(data[key]))return false;
  }
  for(const [key,check]of Object.entries({spaces:space,runs:run,participants:participant,teachers:teacher,providers:provider,messages:message})){
    if(Object.hasOwn(data,key)&&!isList(data[key],check))return false;
  }
  return !Object.hasOwn(data,'reply')||isText(data.reply);
}
export async function api(path,body,method) {
  const options={method:method || (body===undefined?'GET':'POST'),credentials:'same-origin',headers:{Accept:'application/json'}};
  if(body!==undefined){if(body instanceof FormData)options.body=body;else{options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}}
  let response;try{response=await fetch(path,options);}catch{throw new Error('Cannot reach ClassRoomAI. Check your connection, then retry.');}
  let data;try{data=await response.json();}catch{throw new Error(`The server returned an unreadable response (${response.status}).`);}
  if(!response.ok)throw new Error(string(record(data).error)||`Request failed (${response.status}).`);
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('The server returned an invalid response envelope.');
  if(!validEnvelope(data))throw new Error('The server returned data that does not match the classroom API. Reload or ask your teacher to check the installation.');
  return data;
}
function safeImage(source){return typeof source==='string'&&/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(source)?source:'';}
function dataImage(material){return safeImage(`data:${material.mime};base64,${material.data}`);}
function heading(kicker,title,description,actions) {
  const row=el('div',undefined,{class:'page-head'}),copy=el('div');append(copy,el('p',kicker,{class:'eyebrow'}),el('h1',title),description?el('p',description,{class:'muted'}):null);row.append(copy);if(actions)row.append(actions);main.append(row);
}
function empty(message){return el('p',message,{class:'empty'});}
function badge(value){return el('span',value,{class:`badge ${['active','paused','ended'].includes(value)?value:''}`});}
function navigate(route){if(location.hash===`#${route}`)routePage();else location.hash=route;}
function download(name,data,type='application/json'){
  const blob=new Blob([type==='application/json'?JSON.stringify(data,null,2):data],{type}),url=URL.createObjectURL(blob),anchor=el('a',undefined,{href:url,download:name});document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadFrom(path,name) {
  const response=await fetch(path,{credentials:'same-origin'});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(string(record(data).error)||`Download failed (${response.status}).`);}
  const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=el('a',undefined,{href:url,download:name});document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function openModal(title,build,className='') {
  if(modal.open)modal.close();modal.className=className;modal.replaceChildren();const head=el('div',undefined,{class:'modal-head'});head.append(el('h2',title,{id:'modal-title'}),iconButton('Close','close',()=>modal.close()));modal.append(head);const body=el('div',undefined,{class:'stack'});modal.append(body);build(body);modal.showModal();
}
function updateNavigation(route) {
  navigation.replaceChildren();const items=state.teacher?[['My Spaces','/teacher/library','library'],['Student insights','/teacher/runs','sessions'],['Create a Space','/teacher/new','spark'],['Providers','/teacher/settings','settings'],['Profile','/teacher/profile','profile'],['Join as student','/join','join']]:[['Join a Space','/join','join'],['Teacher sign in','/login','profile']];
  for(const [label,href,image]of items){const item=link('',`#${href}`);item.append(icon(image),el('span',label));if(route===href||(href==='/teacher/library'&&route.startsWith('/teacher/edit')))item.setAttribute('aria-current','page');navigation.append(item);}
  if(state.student&&!state.teacher)navigation.append(link('My classroom','#/student'));
  if(state.teacher)navigation.append(button('Sign out',async()=>{await api('/api/logout',{});state.teacher=null;notify('Signed out.');navigate('/login');},'quiet small'));
  document.querySelector('.header-create').hidden=!state.teacher;
  document.querySelector('#page-label').textContent=route.startsWith('/teacher/edit')?'Space editor':items.find(item=>item[1]===route)?.[0]||'Spaces';
  document.body.classList.remove('sidebar-open');
}
function materialView(material,remover) {
  const wrapper=el('div',undefined,{class:'material stack'});wrapper.append(el('strong',string(material.name)||'Uploaded material'));
  const src=dataImage(material);if(src)wrapper.append(el('img',undefined,{src,alt:string(material.name)}));
  if(material.text){const detail=el('details');detail.append(el('summary','Read extracted text'),el('pre',material.text));wrapper.append(detail);}
  if(remover)wrapper.append(button('Remove',remover,'small danger'));return wrapper;
}
async function upload(file){if(!file)throw new Error('Choose a file first.');if(file.size>10*1024*1024)throw new Error('Files must be 10 MB or smaller.');const body=new FormData();body.append('file',file);return (await api('/api/files',body)).material;}
function uploadControl(label,onMaterial){const control=field(label,'','file');control.input.accept=ACCEPT;control.input.addEventListener('change',()=>guard(async()=>{const file=control.input.files[0];if(!file)return;const material=await upload(file);await onMaterial(material);control.input.value='';notify(`Uploaded ${material.name}.`);},control.input));return control.wrapper;}
function landing(){
  heading('Teacher-guided AI','A Space for every learning journey.','Create focused learning experiences, invite students with a code, and follow their progress.');
  const grid=el('div',undefined,{class:'grid welcome-grid'});
  for(const [title,description,href,label]of [['For teachers','Set the instructions, choose your model and create a Space for close reading, discussion or your own classroom goals.',state.teacher?'#/teacher/library':'#/login',state.teacher?'Open My Spaces':'Teacher sign in'],['For students','Join the Space your teacher shared. Your conversation and saved work remain separate from other learners.','#/join','Join a Space']]){const card=el('section',undefined,{class:'panel stack'});card.append(el('h2',title),el('p',description,{class:'muted'}),link(label,href,'button primary'));grid.append(card);}
  main.append(grid,el('p','Independent self-hosted software. Your teacher selects the AI provider. Review school and provider policies before sharing student data.',{class:'hint'}));
}
function authPage(setup = false){
  heading(setup?'First run · Local administrator':'Teacher access',setup?'Open your workspace.':'Welcome back.',setup?'Create the first teacher account from this computer. Additional accounts can be added by an administrator.':'Student access uses a classroom code, not a teacher account.');
  const form=el('form',undefined,{class:'panel stack auth-card'});let name;if(setup){name=required(field('Your name'));name.input.autocomplete='name';form.append(name.wrapper);}
  const email=required(field('Email address','','email')),password=required(field('Password','','password'));email.input.autocomplete='username';password.input.autocomplete=setup?'new-password':'current-password';if(setup)password.input.minLength=4;form.append(email.wrapper,password.wrapper);
  if(setup)form.append(el('p','Before using AI with students, review your school’s policies and chosen provider’s terms. Prompts, uploaded materials and student conversations may be processed by that provider. No external LMS or certification is implied. Keep the private master encryption key when migrating a database.',{class:'notice warning'}));
  submit(form,setup?'Create administrator account':'Sign in',async()=>{const result=await api(setup?'/api/setup':'/api/login',{...(setup?{name:name.input.value}:{}),email:email.input.value,password:password.input.value});password.input.value='';state.teacher=result.teacher;state.setupRequired=false;notify('Your teacher workspace is ready.');navigate('/teacher/library');});main.append(form);
}
async function libraryPage(token){
  const result=await api('/api/spaces');if(token!==revision)return;const spaces=array(result.spaces);heading('Spaces','My Spaces','Create, preview and launch teacher-guided learning experiences.',append(el('div',undefined,{class:'actions'}),link('Create a Space','#/teacher/new','button primary')));
  const filters=el('div',undefined,{class:'grid'}),search=field('Search spaces'),folder=selectField('Folder',[{value:'',label:'All folders'},...Array.from(new Set(spaces.map(space=>string(space.folder)).filter(Boolean))).sort().map(value=>({value,label:value}))]);
  const shelf=selectField('Library collection',[{value:'all',label:'All local templates'},{value:'mine',label:'My spaces'},{value:'shared',label:'Shared by other teachers'}],'all');
  search.input.type='search';filters.append(search.wrapper,folder.wrapper,shelf.wrapper);main.append(filters);
  const importRow=el('div',undefined,{class:'actions'}),file=field('Import a shared template','','file');file.input.accept='.json,application/json';file.input.addEventListener('change',()=>guard(async()=>{const selected=file.input.files[0];if(!selected)return;if(selected.size>15*1024*1024)throw new Error('Template file is too large.');let parsed;try{parsed=JSON.parse(await selected.text());}catch{throw new Error('Choose a valid JSON space export.');}const space=record(parsed).space||parsed;if(!space||typeof space!=='object'||Array.isArray(space))throw new Error('The export must contain a space object.');const imported=await api('/api/spaces/import',{space});notify('Template imported. Review its provider before launching.');navigate(`/teacher/edit/${imported.space.id}`);},file.input));importRow.append(file.wrapper);main.append(importRow);
  const grid=el('section',undefined,{class:'grid','aria-label':'Learning spaces'});main.append(grid);
  function render(){
    grid.replaceChildren();const query=search.input.value.trim().toLocaleLowerCase();
    const shown=spaces.filter(space=>(!folder.input.value||space.folder===folder.input.value)&&(shelf.input.value!=='mine'||space.ownerId===state.teacher.id)&&(shelf.input.value!=='shared'||space.ownerId!==state.teacher.id)&&[space.title,space.subtitle,space.subject,space.gradeLevel,space.standard,space.teacherDescription,space.audienceDetails,space.spaceType].join(' ').toLocaleLowerCase().includes(query));
    if(!shown.length){grid.append(empty(spaces.length?'No spaces match this search or collection.':'Start with a question worth exploring. Create your first space.'));return;}
    shown.forEach((space,index)=>{
      const card=el('article',undefined,{class:'card'}),cover=safeImage(space.cover),owned=space.ownerId===state.teacher.id,editable=owned||state.teacher.admin;
      card.append(cover?el('img',undefined,{src:cover,alt:'',class:'cover'}):el('div',undefined,{class:'card-pattern','aria-hidden':'true'}),el('span',`SPACE ${String(index+1).padStart(2,'0')} · ${space.folder||'Unfiled'}`,{class:'card-number'}),badge(owned?space.visibility:'Shared locally'),el('h2',space.title),el('p',space.subtitle||space.teacherDescription||'A teacher-guided learning space.'),el('p',[space.subject,space.gradeLevel,space.spaceType.replaceAll('-',' ')].filter(Boolean).join(' · '),{class:'muted'}));
      const actions=el('div',undefined,{class:'actions'});
      actions.append(link(editable?'Edit':'View template',`#/teacher/edit/${space.id}`,'button'),button('Preview',()=>preview(space),'small'));
      if(editable)actions.append(button('Launch',()=>launch(space),'primary'));
      actions.append(button(owned?'Duplicate':'Remix to my library',async()=>{const duplicate=await api(`/api/spaces/${pathId(space.id)}/duplicate`,{});notify(owned?'Template duplicated.':'Private remix created. Choose your provider before launching.');navigate(`/teacher/edit/${duplicate.space.id}`);},owned?'small':'primary'),button('Export',async()=>download(`${space.title.replace(/[^\w-]+/g,'-')||'space'}.json`,await api(`/api/spaces/${pathId(space.id)}/export`)),'small'));
      card.append(actions);grid.append(card);
    });
  }
  for(const input of [search.input,folder.input,shelf.input])input.addEventListener(input===search.input?'input':'change',render);render();
}
async function spaceEditor(id,token){
  const [providerResult,spaceResult]=await Promise.all([api('/api/providers'),id?api(`/api/spaces/${pathId(id)}`):Promise.resolve({space:{}})]);if(token!==revision)return;
  let space=record(spaceResult.space),materials=[...array(space.materials)],cover=string(space.cover),questionRows=[];
  if(id&&space.ownerId!==state.teacher.id&&!state.teacher.admin){
    heading('Shared local template',space.title,space.subtitle,button('Remix to my library',async()=>{const result=await api(`/api/spaces/${pathId(id)}/duplicate`,{});notify('Private remix created. Choose your provider before launching.');navigate(`/teacher/edit/${result.space.id}`);},'primary'));
    const view=el('div',undefined,{class:'wide-form stack'});
    view.append(el('p','A reusable template shared by an authenticated teacher on this installation. Remix it before editing or launching. No student conversations or saved classroom work are part of this template.',{class:'notice'}));
    if(safeImage(space.cover))view.append(el('img',undefined,{src:space.cover,alt:'Template cover',class:'cover'}));
    for(const [label,value]of [['Teacher description',space.teacherDescription],['Student welcome',space.studentDescription],['Audience context',space.audienceDetails],['Interaction style',space.interactionStyle],['AI instructions',space.instructions],['Standards',space.standard]]){
      const section=el('section',undefined,{class:'panel'});section.append(el('h2',label),el('p',value,{class:'artifact-text'}));view.append(section);
    }
    const learning=el('section',undefined,{class:'panel stack'}),outcomes=el('ul');learning.append(el('h2','Learning design'));array(space.outcomes).forEach(value=>outcomes.append(el('li',value)));learning.append(outcomes,el('p',`Agenda ${space.showAgenda?'shown':'hidden'} to students`));
    learning.append(el('p',space.allowLanguageChoice===true?'Response language: students may choose; teacher instructions apply when no language is selected.':'Response language: follows teacher instructions; student language choice is off.'));
    array(space.agenda).forEach((step,index)=>learning.append(append(el('section',undefined,{class:'panel'}),el('h3',`${index+1}. ${step.title}`),el('p',step.instructions),step.tool?el('p',`Step tool: ${step.tool}`):null)));
    learning.append(el('p',`Anytime tools: ${array(space.tools).join(', ')||'None'}`));view.append(learning);
    array(space.materials).forEach(material=>view.append(materialView(material)));
    view.append(append(el('div',undefined,{class:'actions'}),button('Preview this template',()=>preview(space)),button('Export template',async()=>download('shared-template.json',await api(`/api/spaces/${pathId(id)}/export`))),link('Back to library','#/teacher/library','button')));main.append(view);return;
  }
  heading(id?'My Spaces':'Create a Space',id?space.title:'Create your Space','Configure the experience, review a real preview, then launch when you are ready.');
  const form=el('form',undefined,{class:'wide-form stack'}),overview=el('section',undefined,{class:'panel stack'});form.noValidate=true;overview.append(el('h2','Space details'));
  const title=required(field('Space title',space.title)),subtitle=field('Subtitle',space.subtitle),teacherDescription=field('Teacher description (private)',space.teacherDescription,'textarea'),studentDescription=field('Student welcome description',space.studentDescription,'textarea'),folder=field('Folder',space.folder),subject=field('Subject',space.subject),gradeLevel=field('Grade level',space.gradeLevel),standard=field('Standards / curriculum reference',space.standard,'textarea','Enter the standard text or identifier your school uses. No external standards database is implied.');
  const metadata=el('div',undefined,{class:'grid'});metadata.append(subject.wrapper,gradeLevel.wrapper,folder.wrapper);overview.append(title.wrapper,subtitle.wrapper,teacherDescription.wrapper,studentDescription.wrapper,metadata,standard.wrapper);form.append(overview);
  const spaceType=selectField('Space type',[{value:'student-learning',label:'Student learning'},{value:'teacher-productivity',label:'Teacher productivity'},{value:'staff-operations',label:'Staff operations'}],space.spaceType||'student-learning');
  const visibility=selectField('Template visibility',[{value:'private',label:'Private — only you'},{value:'shared',label:'Shared — authenticated local teachers'}],space.visibility||'private');
  const classification=el('div',undefined,{class:'grid two'});classification.append(spaceType.wrapper,visibility.wrapper);overview.append(classification,el('p','Shared templates appear in the local teacher library and can be remixed. This does not publish conversations, student records, or content to an external Discover service.',{class:'hint'}));
  const teaching=el('section',undefined,{class:'panel stack'});teaching.append(el('h2','The learning design'));
  const instructions=required(field('Instructions for the AI',space.instructions,'textarea','Describe goals, boundaries, teaching language, tone, scaffolding, and use of materials. For example, MYP / DP English A: guide literary or textual analysis of authorial choices, ask for evidence, and develop comparisons without writing the student’s response.'));instructions.input.rows=10;
  const outcomes=field('Learning outcomes (one per line, maximum 6)',array(space.outcomes).join('\n'),'textarea','For example, explain how an authorial choice shapes meaning, support an interpretation with textual evidence, or compare how two texts develop an idea. Adapt these to your subject.');
  const provider=required(selectField('Model provider',[{value:'',label:'Choose a configured provider'},...array(providerResult.providers).map(item=>({value:item.id,label:`${item.name} · ${item.model}`}))],space.providerId));
  const audienceDetails=field('Audience context',space.audienceDetails,'textarea','Describe learners, prior knowledge, scaffolding, accessibility supports, or the intended staff audience. For MYP / DP English A, this might include support for close reading and building evidence-based interpretations.');
  const interactionStyle=field('Interaction style / persona',space.interactionStyle,'textarea','Describe how the companion should interact: for example Socratic questioning, concise coaching, or encouraging reflection.');
  const audienceStyle=el('div',undefined,{class:'grid two'});audienceStyle.append(audienceDetails.wrapper,interactionStyle.wrapper);
  const allowLanguageChoice=el('input',undefined,{type:'checkbox','aria-describedby':'language-choice-hint'});allowLanguageChoice.checked=space.allowLanguageChoice===true;
  const languageChoiceLabel=el('label',undefined,{class:'check-label'});languageChoiceLabel.append(allowLanguageChoice,el('span','Allow students to choose response language'));
  const languageChoiceHint=el('p','Teaching language normally comes from your instructions. Student language choice is optional and off by default, including for English A. Enable it only when it suits this space. Changes apply to future launches; existing sessions keep their saved settings.',{class:'hint',id:'language-choice-hint'});
  teaching.append(instructions.wrapper,audienceStyle,outcomes.wrapper,languageChoiceLabel,languageChoiceHint,provider.wrapper,link('Configure a provider','#/teacher/settings'));form.append(teaching);
  const agendaPanel=el('section',undefined,{class:'panel stack'}),agendaRows=el('div',undefined,{class:'stack'});
  let agendaSteps=array(space.agenda).map(step=>({title:step.title,instructions:step.instructions,tool:step.tool}));
  const showAgenda=el('input',undefined,{type:'checkbox'});showAgenda.checked=space.showAgenda!==false;
  const showLabel=el('label',undefined,{class:'check-label'});showLabel.append(showAgenda,el('span','Show the agenda to students'));
  agendaPanel.append(el('h2','Learning agenda'),el('p','Up to eight ordered steps, each with its own instructions and optional tool. Hidden agendas still guide the AI.',{class:'muted'}),showLabel,agendaRows);
  function renderAgenda(){
    agendaRows.replaceChildren();
    agendaSteps.forEach((step,index)=>{
      const row=el('section',undefined,{class:'panel stack'}),title=required(field(`Step ${index+1} title`,step.title)),instructions=field('Step instructions',step.instructions,'textarea');
      const tool=selectField('Tool for this step',[{value:'',label:'Conversation only'},...TOOL_TYPES.map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))],step.tool||'');
      title.input.addEventListener('input',()=>step.title=title.input.value);instructions.input.addEventListener('input',()=>step.instructions=instructions.input.value);tool.input.addEventListener('change',()=>step.tool=tool.input.value||null);
      const actions=el('div',undefined,{class:'actions'});
      const up=button('Move step up',()=>{[agendaSteps[index-1],agendaSteps[index]]=[agendaSteps[index],agendaSteps[index-1]];renderAgenda();}),down=button('Move step down',()=>{[agendaSteps[index+1],agendaSteps[index]]=[agendaSteps[index],agendaSteps[index+1]];renderAgenda();});
      up.disabled=index===0;down.disabled=index===agendaSteps.length-1;
      actions.append(up,down,button('Delete step',()=>{agendaSteps.splice(index,1);renderAgenda();},'danger'));
      row.append(title.wrapper,instructions.wrapper,tool.wrapper,actions);agendaRows.append(row);
    });
    if(!agendaSteps.length)agendaRows.append(empty('No agenda steps yet. Add a step or guide the learning entirely through conversation.'));
  }
  renderAgenda();agendaPanel.append(button('Add agenda step',()=>{if(agendaSteps.length>=8)throw new Error('A space can contain at most eight agenda steps.');agendaSteps.push({title:'',instructions:'',tool:null});renderAgenda();agendaRows.querySelector('section:last-child input')?.focus();}));form.append(agendaPanel);
  const designPanel=el('details',undefined,{class:'panel design-panel'});designPanel.open=!id;
  const designBrief=field('AI design brief','','textarea','Describe the learning goal, audience and constraints. Uses the model selected above. Suggestions remain unsaved until you review, apply and save them.');
  designBrief.input.maxLength=12000;designBrief.input.placeholder='What would you like your students to explore?';
  const designStatus=el('p','AI drafts need teacher review. Nothing is saved, shared or launched automatically.',{class:'design-status',role:'status','aria-live':'polite'});
  const designActions=el('div',undefined,{class:'actions'});let designing=false;
  const draftControls={title,subtitle,instructions,audienceDetails,interactionStyle,teacherDescription,studentDescription,gradeLevel,spaceType};
  async function generateDesign(target){
    if(designing)return;
    designing=true;Array.from(designActions.children).forEach(control=>control.disabled=true);designStatus.className='design-status busy';designStatus.setAttribute('role','status');designStatus.textContent='Generating your design with the selected model… Your form remains unchanged.';
    try{
      if(!provider.input.value)throw new Error('Choose a model provider above. If none are listed, add one in Providers first.');
      if(!designBrief.input.value.trim()&&!title.input.value.trim()&&!instructions.input.value.trim())throw new Error('Add a design brief, title or teaching instructions first.');
      const current={title:title.input.value,subtitle:subtitle.input.value,instructions:instructions.input.value,audienceDetails:audienceDetails.input.value,interactionStyle:interactionStyle.input.value,outcomes:lines(outcomes.input.value),agenda:agendaSteps,teacherDescription:teacherDescription.input.value,studentDescription:studentDescription.input.value,subject:subject.input.value,standard:standard.input.value};
      const brief=[designBrief.input.value.trim(),`Current teacher draft for context:\n${JSON.stringify(current)}`].filter(Boolean).join('\n\n');
      if(brief.length>12000)throw new Error('The brief plus current teaching context exceeds 12,000 characters. Shorten the brief or draft; instructions are never silently removed.');
      const result=await api('/api/spaces/design',{providerId:provider.input.value,brief,target,...(id?{spaceId:id}:{}),spaceType:spaceType.input.value,gradeLevel:gradeLevel.input.value,materials});
      if(token!==revision)return;
      const draft=record(result.draft),keys=target==='outcomes'?['outcomes']:target==='descriptions'?['title','subtitle','teacherDescription','studentDescription']:['title','subtitle','instructions','audienceDetails','interactionStyle','outcomes','agenda','teacherDescription','studentDescription','gradeLevel','spaceType'];
      const picked={};
      for(const key of keys){
        if(!Object.hasOwn(draft,key))continue;
        const value=draft[key];
        if(key==='outcomes'){
          if(!Array.isArray(value)||value.length>6||value.some(item=>typeof item!=='string'||item.length>300))throw new Error('The model returned invalid learning outcomes.');
          picked[key]=value;
        }else if(key==='agenda'){
          if(!Array.isArray(value)||value.length>8||value.some(item=>!item||typeof item!=='object'||Array.isArray(item)||typeof item.title!=='string'||typeof item.instructions!=='string'||!(item.tool===null||TOOL_TYPES.includes(item.tool))))throw new Error('The model returned an invalid structured agenda.');
          picked[key]=value.map(step=>({title:step.title,instructions:step.instructions,tool:step.tool}));
        }else if(key==='spaceType'){
          if(!['student-learning','teacher-productivity','staff-operations'].includes(value))throw new Error('The model returned an invalid space type.');
          picked[key]=value;
        }else{
          if(typeof value!=='string')throw new Error('The model returned an invalid text field.');
          picked[key]=value;
        }
      }
      if(!Object.keys(picked).length)throw new Error('The model did not return any applicable design fields.');
      designStatus.className='design-status';designStatus.textContent='AI draft received. Review the suggestions before applying them to your unsaved form.';
      openModal('Review the AI design draft',body=>{
        body.append(el('p','AI-generated suggestions may be incomplete or inaccurate. Applying replaces only the fields shown below in your unsaved form; you must still review and save the space.',{class:'notice warning'}));
        for(const [key,value]of Object.entries(picked)){
          const section=el('section',undefined,{class:'panel stack'});section.append(el('h3',key.replace(/([A-Z])/g,' $1').replace(/^./,letter=>letter.toUpperCase())));
          if(key==='outcomes'){const list=el('ul');value.forEach(item=>list.append(el('li',item)));section.append(list);}
          else if(key==='agenda'){value.forEach((step,index)=>section.append(append(el('section'),el('strong',`${index+1}. ${step.title}`),el('p',step.instructions,{class:'artifact-text'}),step.tool?el('small',`Tool: ${step.tool}`):null)));}
          else section.append(el('p',value,{class:'artifact-text'}));body.append(section);
        }
        body.append(button('Apply to unsaved form',()=>{
          if(token!==revision){modal.close();throw new Error('The template editor has changed. Generate a new draft on the current page.');}
          for(const [key,value]of Object.entries(picked)){if(draftControls[key])draftControls[key].input.value=value;else if(key==='outcomes')outcomes.input.value=value.join('\n');else if(key==='agenda'){agendaSteps=value;renderAgenda();}}
          modal.close();designStatus.textContent='AI draft applied to your form. Review every changed field, then explicitly save when ready.';notify('AI suggestions applied. Your template is not saved or shared yet.');
        },'primary'));
      });
    }catch(error){designStatus.className='design-status error';designStatus.setAttribute('role','alert');designStatus.textContent=`${error instanceof Error?error.message:String(error)} Your current form has not been changed.`;}
    finally{designing=false;Array.from(designActions.children).forEach(control=>control.disabled=false);}
  }
  designActions.append(button('Draft a full space with AI',()=>generateDesign('draft'),'primary'),button('Generate outcomes',()=>generateDesign('outcomes')),button('Generate descriptions',()=>generateDesign('descriptions')));
  designPanel.append(append(el('summary'),icon('spark'),el('span','A thinking partner for your design')),append(el('div',undefined,{class:'stack'}),designBrief.wrapper,designActions,designStatus));form.insertBefore(designPanel,teaching);
  const support=el('section',undefined,{class:'panel stack'}),materialList=el('div',undefined,{class:'stack'});support.append(el('h2','Source materials'),el('p','Text and image uploads become teacher-controlled support context when you save the template. Files are sent to the selected model when used.',{class:'muted'}),uploadControl('Upload supporting material',material=>{materials.push(material);renderMaterials();}),materialList);function renderMaterials(){materialList.replaceChildren();materials.forEach(item=>materialList.append(materialView(item,()=>{materials=materials.filter(material=>material!==item);renderMaterials();})));}renderMaterials();form.append(support);
  const tools=el('fieldset',undefined,{class:'panel'});tools.append(el('legend','Anytime student tools'),el('p','These tools are always available in the tools panel. Tools assigned only to agenda steps are opened from those steps.',{class:'hint'}));const toolGrid=el('div',undefined,{class:'grid'}),toolInputs=new Map();TOOL_TYPES.forEach(type=>{const label=el('label',undefined,{class:'check-label'}),input=el('input',undefined,{type:'checkbox'});input.checked=array(space.tools).includes(type);toolInputs.set(type,input);label.append(input,el('span',type[0].toUpperCase()+type.slice(1)));toolGrid.append(label);});tools.append(toolGrid);form.append(tools);
  const media=el('section',undefined,{class:'panel stack'});media.append(el('h2','Video & cover'));const video=field('YouTube video URL',space.videoUrl,'url','Only a validated YouTube URL can be embedded. The student controls playback.'),questions=el('div',undefined,{class:'stack'});media.append(video.wrapper,el('h3','Timestamp questions'),questions);
  function questionRow(item={time:0,question:''}){const row=el('div',undefined,{class:'panel stack'}),time=field('Timestamp in seconds',item.time,'number'),question=field('Question',item.question,'textarea');time.input.min=0;const values={row,time,question};questionRows.push(values);row.append(time.wrapper,question.wrapper,button('Remove question',()=>{questionRows=questionRows.filter(value=>value!==values);row.remove();},'small danger'));questions.append(row);}
  array(space.videoQuestions).forEach(questionRow);media.append(button('Add timestamp question',()=>questionRow()));
  const coverView=el('div');function renderCover(){coverView.replaceChildren();if(safeImage(cover))coverView.append(el('img',undefined,{src:cover,alt:'Space cover',class:'cover'}));}renderCover();media.append(uploadControl('Upload cover image',material=>{if(!dataImage(material))throw new Error('Choose a PNG, JPEG, or GIF image for the cover.');cover=dataImage(material);renderCover();}),coverView,button('Remove cover',()=>{cover='';renderCover();},'small danger'));
  const coverPrompt=field('AI cover prompt','','textarea');media.append(coverPrompt.wrapper,button('Generate cover with saved provider',async()=>{if(!id)throw new Error('Save the space first, then generate its cover.');if(!coverPrompt.input.value.trim())throw new Error('Describe the cover you want.');cover=(await api(`/api/spaces/${pathId(id)}/cover`,{prompt:coverPrompt.input.value})).cover;if(!safeImage(cover))throw new Error('The image provider returned an unsupported cover.');renderCover();notify('Cover generated. Save this form to retain other changes.');}));form.append(media);
  const actions=el('div',undefined,{class:'actions'});form.append(actions);
  const saveButton=el('button','Save space',{type:'submit',class:'primary'});actions.append(saveButton);
  form.addEventListener('submit',event=>{event.preventDefault();guard(async()=>{
    const invalid=Array.from(form.elements).find(control=>control.willValidate&&!control.checkValidity());if(invalid){const panel=invalid.closest('[role=tabpanel]');if(panel)selectTab(panel.id);invalid.reportValidity();return;}
    const parsedOutcomes=lines(outcomes.input.value);if(parsedOutcomes.length>6||agendaSteps.length>8)throw new Error('Use at most 6 outcomes and 8 agenda steps.');
    if(agendaSteps.some(step=>!step.title.trim()))throw new Error('Give every agenda step a title.');
    if(video.input.value&&!youtubeId(video.input.value))throw new Error('Enter a valid HTTPS YouTube video URL.');
    const payload={title:title.input.value,subtitle:subtitle.input.value,teacherDescription:teacherDescription.input.value,studentDescription:studentDescription.input.value,instructions:instructions.input.value,standard:standard.input.value,gradeLevel:gradeLevel.input.value,subject:subject.input.value,outcomes:parsedOutcomes,agenda:agendaSteps.map(step=>({title:step.title,instructions:step.instructions,tool:step.tool})),showAgenda:showAgenda.checked,allowLanguageChoice:allowLanguageChoice.checked,audienceDetails:audienceDetails.input.value,interactionStyle:interactionStyle.input.value,spaceType:spaceType.input.value,visibility:visibility.input.value,materials,providerId:provider.input.value,tools:TOOL_TYPES.filter(type=>toolInputs.get(type).checked),videoUrl:video.input.value,videoQuestions:questionRows.map(item=>({time:Number(item.time.input.value),question:item.question.input.value})),cover,folder:folder.input.value};
    const result=await api(id?`/api/spaces/${pathId(id)}`:'/api/spaces',payload,id?'PATCH':'POST');space=result.space;notify('Space saved.');navigate(`/teacher/edit/${space.id}`);
  },saveButton);});
  if(id)actions.append(button('Launch saved space',()=>launch(space),'primary'),button('Export saved template',async()=>download('space.json',await api(`/api/spaces/${pathId(id)}/export`))));actions.append(link('Back to My Spaces','#/teacher/library','button small'));
  const modelBar=el('section',undefined,{class:'panel editor-model-bar'});modelBar.append(provider.wrapper,link('Configure providers','#/teacher/settings'));
  const outcomePanel=append(el('section',undefined,{class:'panel stack'}),el('h2','Learning outcomes'),outcomes.wrapper);
  const audiencePanel=append(el('section',undefined,{class:'panel stack'}),el('h2','Audience & interaction'),audienceStyle,languageChoiceLabel,languageChoiceHint);
  const publishingPanel=append(el('section',undefined,{class:'panel stack'}),el('h2','Descriptions & sharing'),teacherDescription.wrapper,studentDescription.wrapper,classification,el('p','Sharing a template makes it visible only to authenticated teachers on this installation. Student conversations are never included.',{class:'hint'}));
  teaching.replaceChildren(el('h2','Prompt'),instructions.wrapper);
  support.append(standard.wrapper);
  const tabs=el('div',undefined,{class:'editor-tabs',role:'tablist','aria-label':'Space configuration'}),panels=el('div'),tabItems=[];
  const sections=[['Details',[overview]],['Prompt',[teaching]],['Context',[support]],['Outcomes',[outcomePanel]],['Agenda',[agendaPanel]],['Audience',[audiencePanel]],['Tools & media',[tools,media]],['Publishing',[publishingPanel]]];
  function selectTab(panelId){for(const item of tabItems){const selected=item.panel.id===panelId;item.panel.hidden=!selected;item.control.setAttribute('aria-selected',String(selected));item.control.tabIndex=selected?0:-1;}preference('classroom-editor-tab',panelId);}
  sections.forEach(([label,contents],index)=>{const panel=el('div',undefined,{class:'editor-panel stack',role:'tabpanel',id:`editor-panel-${index}`,'aria-labelledby':`editor-tab-${index}`}),control=button(label,()=>selectTab(panel.id));control.id=`editor-tab-${index}`;control.setAttribute('role','tab');control.setAttribute('aria-controls',panel.id);panel.append(...contents);panels.append(panel);tabs.append(control);tabItems.push({panel,control});});
  tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const current=tabItems.findIndex(item=>item.control===document.activeElement),index=event.key==='Home'?0:event.key==='End'?tabItems.length-1:(Math.max(0,current)+(event.key==='ArrowRight'?1:-1)+tabItems.length)%tabItems.length;selectTab(tabItems[index].panel.id);tabItems[index].control.focus();});
  const saveBar=append(el('div',undefined,{class:'editor-save-bar'}),actions);form.replaceChildren(modelBar,designPanel,tabs,panels,saveBar);
  selectTab(tabItems.some(item=>item.panel.id===preference('classroom-editor-tab'))?preference('classroom-editor-tab'):tabItems[0].panel.id);
  const previewPanel=el('aside',undefined,{class:'editor-preview','aria-label':'Student preview'});mountPreview(previewPanel,id?space:null);
  main.append(append(el('div',undefined,{class:'editor-layout'}),form,previewPanel));
}
function mountPreview(host,space){
  let history=[];const top=append(el('div',undefined,{class:'preview-top'}),el('strong','Student preview'),el('span','Saved template')),intro=el('div',undefined,{class:'preview-empty'}),messages=el('div',undefined,{class:'preview-chat',role:'log','aria-label':'Preview conversation','aria-live':'polite'}),form=el('form',undefined,{class:'preview-composer'}),input=required(field('Preview message','','textarea')),status=el('p','No classroom session or student record is created.',{class:'preview-note',role:'status'});
  messages.hidden=true;form.hidden=true;input.input.maxLength=8000;input.input.placeholder='Write a message…';form.append(input.wrapper);
  async function request(content,opening=false){status.textContent='The selected model is thinking…';try{const result=await api(`/api/spaces/${pathId(space.id)}/preview`,{message:content,history});history.push({role:'user',content},{role:'assistant',content:result.reply});if(!opening)messages.append(messageView({role:'user',content}));messages.append(messageView({role:'assistant',content:result.reply}));intro.hidden=true;messages.hidden=false;form.hidden=false;status.textContent='Real model response · Preview only';input.input.value='';messages.scrollTop=messages.scrollHeight;input.input.focus();}catch(error){status.textContent=error instanceof Error?error.message:String(error);throw error;}}
  const start=button('Preview',()=>request('Begin this learning experience, following the teacher instructions. Welcome the learner briefly and ask your first question.',true));start.prepend(icon('play'));start.disabled=!space;intro.append(el('span',space?.title||'Preview your Space',{class:'preview-title'}),start,el('p',space?'Try the saved instructions before launching.':'Save your Space first to preview it with your model.'));
  submit(form,'Send',async()=>request(input.input.value.trim()));host.append(top,intro,messages,form,status);
}
function preview(space){openModal('Preview your Space',body=>{const host=el('section',undefined,{class:'editor-preview'});mountPreview(host,space);body.append(host);});}
function launch(space){
  openModal('Launch a classroom',body=>{
    const form=el('form',undefined,{class:'stack'}),title=field('Session title',space.title),prompt=field('Session-specific instructions','','textarea','Appended to the teacher-controlled context. This does not change the reusable template.');
    const outcomes=field('Outcomes for this session (one per line, maximum 6)',array(space.outcomes).join('\n'),'textarea','These changes apply only to this launch snapshot. The reusable template keeps its original outcomes.');
    const expiry=field('Expiry (optional, your local time)','','datetime-local'),maxTurns=field('Maximum student turns',30,'number');maxTurns.input.min=1;maxTurns.input.max=1000;
    form.append(title.wrapper,outcomes.wrapper,prompt.wrapper,expiry.wrapper,maxTurns.wrapper);body.append(form,el('p','Students need the share code or link. Their messages and work are processed by your configured model provider.',{class:'notice warning'}));
    submit(form,'Launch session',async()=>{
      const sessionOutcomes=lines(outcomes.input.value);if(sessionOutcomes.length>6||sessionOutcomes.some(value=>value.length>300))throw new Error('Use at most six outcomes for this session, each at most 300 characters.');
      const expiresAt=expiry.input.value?new Date(expiry.input.value).toISOString():null;
      const result=await api(`/api/spaces/${pathId(space.id)}/launch`,{title:title.input.value,sessionPrompt:prompt.input.value,outcomes:sessionOutcomes,expiresAt,maxTurns:Number(maxTurns.input.value)});
      modal.close();navigate(`/teacher/run/${result.run.id}`);shareRun(result.run);
    });
  });
}
function shareRun(run){openModal('Invite your learners',body=>{const url=new URL('/',location.origin);url.searchParams.set('code',run.code);body.append(el('p',run.title),el('p',run.code,{class:'join-code'}),el('p','Students enter this code and their name. The code does not grant teacher or transcript access.',{class:'muted'}));const share=field('Student join link',url.href);share.input.readOnly=true;body.append(share.wrapper,el('img',undefined,{src:`/api/runs/${pathId(run.id)}/qr.svg`,alt:'QR code for this student join link',class:'qr'}),button('Copy link',async()=>{if(!navigator.clipboard)throw new Error('Clipboard access is unavailable. Select and copy the link above.');await navigator.clipboard.writeText(url.href);notify('Join link copied.');}),badge(run.status));});}
async function settingsPage(token){
  const result=await api('/api/providers');if(token!==revision)return;let providers=array(result.providers);const presets=array(result.presets),oauthProviders=array(result.oauthProviders),admin=state.teacher.admin;
  heading('Configuration','Providers & models','Choose a provider preset, connect it, then pick the model your Spaces will use.');
  const split=el('div',undefined,{class:'split provider-layout'}),list=el('section',undefined,{class:'stack'}),editor=el('section',undefined,{class:'panel stack'});split.append(list);if(admin)split.append(editor);main.append(split);
  let keychain={supported:false,entries:[]},keychainError='';
  if(admin){try{keychain=await api('/api/keychain');}catch(error){keychainError=error instanceof Error?error.message:String(error);}if(token!==revision)return;}
  const oauthLabel=id=>string(oauthProviders.find(item=>item.id===id)?.name)||string(presets.find(item=>item.id===id)?.name)||string(id)||'Provider';
  function oauthSignInLabel(id){if(id==='openrouter')return 'Sign in with OpenRouter';if(id==='gemini')return 'Sign in with Google for Gemini';const item=oauthProviders.find(value=>value.id===id);return `Sign in with ${item?item.name:'provider'}`;}
  function confirmDisconnect(provider){
    openModal('Disconnect OAuth locally',body=>{
      const status=el('p',undefined,{class:'model-status',role:'status'});
      body.append(el('p',`Remove the stored ${oauthLabel(provider.oauthProvider)} sign-in credential for “${provider.name}” from this computer? Only this local credential is deleted; the connection itself stays.`,{class:'muted'}),el('p','Provider-side access is not revoked here. To end that grant as well, remove this app in your provider account settings.',{class:'notice warning'}),append(el('div',undefined,{class:'actions'}),button('Remove local credential',()=>guard(async()=>{status.className='model-status';status.textContent='Removing the local OAuth credential…';try{const result=await api(`/api/providers/${pathId(provider.id)}/oauth/disconnect`,{},'POST');if(token!==revision)return;providers=[...providers.filter(item=>item.id!==result.provider.id),result.provider];renderList();renderEditor(result.provider);modal.close();notify('Local OAuth credential removed. Sign in again to link this connection to a provider account.');}catch(error){status.className='model-status error';status.textContent=error instanceof Error?error.message:String(error);}}),'primary'),button('Cancel',()=>modal.close(),'quiet')),status);
    });
  }
  function renderList(){
    list.replaceChildren(el('h2','Your connections'));
    if(!admin)list.append(el('p','Read-only settings. An administrator can add connections; you can select configured providers in your Spaces.',{class:'notice'}));
    if(!providers.length)list.append(empty('No providers configured. Add a connection before generating or launching a Space.'));
    for(const provider of providers){
      const card=el('article',undefined,{class:'panel stack provider-card'});card.append(append(el('div',undefined,{class:'row between'}),el('h3',provider.name),badge(provider.kind)),el('p',provider.model,{class:'muted'}),el('p',provider.baseUrl,{class:'provider-url'}),el('p',provider.keychainId?'Existing Keychain key linked · Never copied into this app':provider.oauthProvider?provider.hasKey?`${oauthLabel(provider.oauthProvider)} sign-in linked · Credential stored encrypted on this computer`:`${oauthLabel(provider.oauthProvider)} login disconnected · Sign in again to reconnect`:provider.hasKey?'Encrypted key saved on this computer':'No key configured',{class:'hint'}));if(provider.imageModel)card.append(el('p',`Image model: ${provider.imageModel}`,{class:'hint'}));
      if(admin)card.append(append(el('div',undefined,{class:'actions'}),button('Edit',()=>renderEditor(provider),'small'),button('Test connection',async()=>{const response=await api(`/api/providers/${pathId(provider.id)}/test`,{});openModal('Connection test',body=>body.append(el('p',response.reply),el('p','Response from a real model request.',{class:'hint'})));},'small'),...(provider.oauthProvider?[button('Disconnect OAuth locally',()=>confirmDisconnect(provider),'small quiet')]:[])));
      list.append(card);
    }
    list.append(el('p','Prompts, uploaded materials and student conversations may be sent to the selected provider. A local endpoint requires an independently running model server.',{class:'hint'}));
  }
  function renderEditor(provider={}){
    editor.replaceChildren(el('h2',provider.id?'Edit connection':'Add a connection'));
    const form=el('form',undefined,{class:'stack'}),preset=selectField('Provider preset',[{value:'',label:'Choose a provider'},...presets.map(item=>({value:item.id,label:item.id==='custom'?'Custom endpoint…':item.name}))],provider.id?(presets.some(item=>item.baseUrl===provider.baseUrl)?presets.find(item=>item.baseUrl===provider.baseUrl).id:'custom'):''),name=required(field('Display name',provider.name)),kind=selectField('API format',['openai','anthropic','gemini'],provider.kind||'openai'),url=required(field('Base URL',provider.baseUrl,'url','HTTPS for remote providers; HTTP only for approved local/private endpoints.')),model=required(field('Chat model identifier',provider.model)),key=field('API key','','password'),source=selectField('Credential source',[{value:'manual',label:'API key (enter or keep the saved one)'},{value:'keychain',label:'Existing macOS Keychain key'},{value:'oauth',label:'Sign in to provider (OAuth)'}],provider.oauthProvider?'oauth':provider.keychainId?'keychain':'manual'),entry=selectField('Existing Keychain entry',[{value:'',label:'Choose a provider key'},...array(keychain.entries).map(item=>({value:item.id,label:`${item.name} — ${item.id}${item.available?'':' (not found)'}`}))],provider.keychainId||''),image=field('Image model (optional)',provider.imageModel),tokens=field('Maximum output tokens',provider.maxOutputTokens??2048,'number'),context=field('Maximum context characters',provider.contextChars??60000,'number');
    const oauthSupported=oauthProviders.length>0,oauthConfigured=oauthProviders.filter(item=>item.configured),defaultOauth=provider.oauthProvider||(oauthConfigured.length===1?oauthConfigured[0].id:'');
    const oauthPick=selectField('Provider sign-in',[{value:'',label:'Choose a provider sign-in'},...oauthProviders.map(item=>({value:item.id,label:item.configured?item.name:`${item.name} — ${item.reason||'Not configured'}`}))],defaultOauth);
    oauthProviders.forEach((item,index)=>{const option=oauthPick.input.options[index+1];if(option&&!item.configured)option.disabled=true;});
    key.input.autocomplete='new-password';key.input.spellcheck=false;tokens.input.min=1;tokens.input.max=128000;context.input.min=1000;context.input.max=2000000;
    const credentialHint=el('p',undefined,{class:'hint'});
    const oauthStatus=el('p','Sign-in opens the provider’s own website in this tab.',{class:'model-status',role:'status','aria-live':'polite'}),signIn=button(oauthSignInLabel(defaultOauth),startOAuth);
    const oauthBlock=append(el('div',undefined,{class:'stack'}),oauthSupported?oauthPick.wrapper:el('p','This installation does not expose provider sign-in. Enter an API key or use an existing Keychain key instead.',{class:'hint'}),signIn,oauthStatus);
    if(!oauthSupported){signIn.hidden=true;oauthStatus.hidden=true;}
    const credentialPanel=append(el('section',undefined,{class:'stack provider-source'}),source.wrapper,key.wrapper,entry.wrapper,oauthBlock,credentialHint);
    const advanced=el('details'),isCustom=()=>preset.input.value==='custom'||Boolean(preset.input.value&&!presets.some(item=>item.id===preset.input.value)),syncPreset=()=>{advanced.open=isCustom();};
    const catalogue=selectField('Available models',[{value:'',label:'Choose a returned model'}]),modelStatus=el('p','Fetch the authenticated catalogue, or enter a model identifier manually.',{class:'model-status',role:'status','aria-live':'polite'});catalogue.wrapper.hidden=true;
    let connectionVersion=0;
    function invalidateCatalogue(){connectionVersion++;catalogue.wrapper.hidden=true;catalogue.input.replaceChildren(el('option','Choose a returned model',{value:''}));modelStatus.className='model-status';modelStatus.textContent='Connection changed. Fetch its models again or enter an identifier manually.';}
    function credentialHintText(){
      if(source.input.value==='oauth')return 'The linked connection is shared across this installation: only an administrator links, changes or tests it, and teachers select it in their Spaces. Model use is billed to and metered against the signed-in account’s own provider plan and quota — a provider API sign-in, not a ChatGPT or Claude subscription login.';
      if(source.input.value==='keychain')return keychainError||(keychain.supported?'The selected Keychain entry is read server-side only when used; this app never creates, changes or copies Keychain entries.':'Existing Keychain access is available only on macOS. Enter an API key instead.');
      return provider.hasKey&&!provider.keychainId&&!provider.oauthProvider?'Leave blank to keep the saved encrypted key at the same endpoint; changing the endpoint requires a new key.':'Keys you type are encrypted in this app’s local database and are never added to Keychain.';
    }
    function updateSource(){
      const linked=source.input.value==='keychain',oauthLinked=source.input.value==='oauth';
      key.wrapper.hidden=linked||oauthLinked;entry.wrapper.hidden=!linked;entry.input.disabled=!linked;key.input.disabled=linked||oauthLinked;if(linked||oauthLinked)key.input.value='';
      oauthBlock.hidden=!oauthLinked;
      credentialHint.className=linked&&keychainError?'error':'hint';credentialHint.textContent=credentialHintText();
      if(oauthLinked)applyOauthPreset(oauthPick.input.value);
      updateOauth();invalidateCatalogue();
    }
    source.input.addEventListener('change',updateSource);
    entry.input.addEventListener('change',()=>{const selected=array(keychain.entries).find(item=>item.id===entry.input.value),item=presets.find(item=>item.id===selected?.presetId);if(item){kind.input.value=item.kind;url.input.value=item.baseUrl;if(!name.input.value)name.input.value=item.name;}invalidateCatalogue();});
    oauthPick.input.addEventListener('change',()=>{if(source.input.value==='oauth')applyOauthPreset(oauthPick.input.value);updateOauth();});
    function applyOauthPreset(id){const item=presets.find(value=>value.id===id);if(!item)return;kind.input.value=item.kind;url.input.value=item.baseUrl;if(!name.input.value.trim())name.input.value=item.name;invalidateCatalogue();}
    function updateOauth(){
      const item=oauthProviders.find(value=>value.id===oauthPick.input.value),enabled=oauthSupported&&item?.configured===true;
      signIn.textContent=item?oauthSignInLabel(item.id):'Sign in with provider';signIn.dataset.locked=String(!enabled);signIn.disabled=!enabled;oauthStatus.className='model-status';
      oauthStatus.textContent=!oauthSupported?'':item?(item.configured?(provider.oauthProvider===item.id?`${item.name} sign-in is already linked to this connection. Signing in again replaces the stored credential.`:'Completing sign-in creates and saves this connection with its linked credential.'):`${item.name} sign-in is unavailable here: ${item.reason||'Not configured on this installation.'}`):'Choose a provider sign-in.';
    }
    async function startOAuth(){
      const item=oauthProviders.find(value=>value.id===oauthPick.input.value);
      if(!item||!item.configured){oauthStatus.className='model-status error';oauthStatus.textContent=item?`${item.name} sign-in is unavailable here: ${item.reason||'Not configured on this installation.'}`:'Choose a provider sign-in first.';return;}
      if(!form.reportValidity()){oauthStatus.className='model-status error';oauthStatus.textContent='Complete the required connection fields first.';return;}
      oauthStatus.className='model-status';oauthStatus.textContent='Requesting a provider sign-in link…';
      try{const response=await api('/api/provider-oauth/start',oauthSnapshot(item));if(token!==revision)return;const address=string(response.authorizationUrl);if(!/^https?:\/\//.test(address))throw new Error('The server returned an unusable authorization address.');oauthStatus.textContent='Opening the provider’s own sign-in page…';location.assign(address);}catch(error){if(token===revision){oauthStatus.className='model-status error';oauthStatus.textContent=error instanceof Error?error.message:String(error);}}
    }
    function oauthSnapshot(item){return {oauthProvider:item.id,...(provider.id?{id:provider.id}:{}),name:name.input.value.trim(),kind:kind.input.value,baseUrl:url.input.value.trim(),model:model.input.value.trim(),...(image.input.value.trim()?{imageModel:image.input.value.trim()}:{}),maxOutputTokens:Number(tokens.input.value),contextChars:Number(context.input.value)};}
    function oauthModelQuery(){const item=oauthProviders.find(value=>value.id===oauthPick.input.value);if(!provider.id||!provider.oauthProvider)throw new Error(`Sign in with ${item?item.name:'the provider'} first: completing sign-in creates and saves this connection, then its models can be fetched.`);return {id:provider.id,name:name.input.value,kind:kind.input.value,baseUrl:url.input.value,credentialSource:'oauth'};}
    for(const control of [kind.input,url.input,key.input])control.addEventListener(control===kind.input?'change':'input',invalidateCatalogue);
    preset.input.addEventListener('change',()=>{const item=presets.find(value=>value.id===preset.input.value);if(item){name.input.value=item.name;kind.input.value=item.kind;url.input.value=item.baseUrl;model.input.value=item.model;image.input.value=item.imageModel||'';source.input.value='manual';entry.input.value='';}syncPreset();updateSource();});
    function connection(){if(source.input.value==='keychain'&&!entry.input.value)throw new Error('Choose an existing Keychain entry first.');return {...(provider.id?{id:provider.id}:{}),name:name.input.value,kind:kind.input.value,baseUrl:url.input.value,keychainId:source.input.value==='keychain'?entry.input.value:'',...(source.input.value==='manual'&&key.input.value?{apiKey:key.input.value}:{})};}
    const discover=button('Fetch available models',async()=>{let payload;const version=connectionVersion;modelStatus.className='model-status';modelStatus.textContent='Fetching the provider’s authenticated model catalogue…';try{payload=source.input.value==='oauth'?oauthModelQuery():connection();const response=await api('/api/providers/models',payload);if(token!==revision||version!==connectionVersion)return;const models=array(response.models);if(models.some(item=>!item||typeof item.id!=='string'||typeof item.name!=='string'))throw new Error('The provider returned an invalid model catalogue.');catalogue.input.replaceChildren(el('option','Choose a returned model',{value:''}),...models.map(item=>el('option',item.name===item.id?item.id:`${item.name} · ${item.id}`,{value:item.id})));catalogue.input.value=models.some(item=>item.id===model.input.value)?model.input.value:'';catalogue.wrapper.hidden=!models.length;modelStatus.textContent=models.length?`${models.length} models returned. Choose one below, or keep your manual identifier. Availability does not guarantee that your account can call every model.`:'This provider returned no models. Enter its documented identifier manually.';}catch(error){if(token===revision&&version===connectionVersion){modelStatus.className='model-status error';modelStatus.textContent=`${error instanceof Error?error.message:String(error)} You can still enter a model identifier manually.`;}}finally{if(payload)delete payload.apiKey;}});
    catalogue.input.addEventListener('change',()=>{if(catalogue.input.value)model.input.value=catalogue.input.value;});
    form.append(preset.wrapper,credentialPanel,discover,modelStatus,catalogue.wrapper,model.wrapper,advanced);
    advanced.append(el('summary','Advanced connection settings'),append(el('div',undefined,{class:'stack'}),name.wrapper,kind.wrapper,url.wrapper,image.wrapper,tokens.wrapper,context.wrapper,el('p','A full structured AI design may need a larger output limit than a short chat reply. Incomplete responses fail explicitly; the app does not invent a substitute.',{class:'hint'})));
    const help=el('details'),helpSteps=el('ul');for(const step of ['Choose a provider preset when the service is listed, or “Custom endpoint…” and open Advanced connection settings.','Paste the API key from your provider account, or on macOS use an existing Keychain key so it never enters this app.','Base URL is the API root the provider documents, for example https://api.example.com/v1. HTTP is only for a local or approved private endpoint.','API format must match the provider: OpenAI-compatible for most services, or Anthropic, or Google Gemini.','Fetch available models to see what your key can call, then choose an identifier or type one.','Keys stay on this computer and are never shown to students. Test the connection after saving.'])helpSteps.append(el('li',step));
    help.append(el('summary','How to add your own API'),append(el('div',undefined,{class:'stack'}),el('p','Any service that offers an OpenAI-compatible, Anthropic or Google Gemini API can be connected. You supply the endpoint and key; this app ships no provider credentials.'),helpSteps));
    form.addEventListener('invalid',()=>{advanced.open=true;},true);
    const saveStatus=el('p',undefined,{class:'model-status',role:'status'});form.append(saveStatus);
    submit(form,'Save connection',async()=>{let payload;try{const oauthLinked=source.input.value==='oauth',oauthItem=oauthProviders.find(value=>value.id===oauthPick.input.value);if(oauthLinked){if(!oauthItem||!oauthItem.configured)throw new Error('Choose a configured provider sign-in first.');if(!provider.id)throw new Error(`Sign in with ${oauthItem.name} first: completing sign-in creates and saves this connection along with its credential.`);if(provider.oauthProvider!==oauthItem.id)throw new Error(`This connection is linked to ${oauthLabel(provider.oauthProvider)} sign-in. Sign in again with ${oauthItem.name} to replace the stored credential, or choose another credential source.`);}payload=oauthLinked?{id:provider.id,name:name.input.value,kind:kind.input.value,baseUrl:url.input.value,credentialSource:'oauth',model:model.input.value,imageModel:image.input.value,maxOutputTokens:Number(tokens.input.value),contextChars:Number(context.input.value)}:{...connection(),model:model.input.value,imageModel:image.input.value,maxOutputTokens:Number(tokens.input.value),contextChars:Number(context.input.value)};saveStatus.className='model-status';saveStatus.textContent='Saving connection…';const saved=await api('/api/providers',payload,'PUT');if(token!==revision)return;providers=[...providers.filter(item=>item.id!==saved.provider.id),saved.provider];renderList();renderEditor(saved.provider);notify('Connection saved. Test it before classroom use.');}catch(error){saveStatus.className='model-status error';saveStatus.textContent=error instanceof Error?error.message:String(error);}finally{if(payload)delete payload.apiKey;key.input.value='';}});
    syncPreset();updateSource();editor.append(form,help,button('Add another connection',()=>renderEditor(),'quiet small'));
  }
  renderList();if(admin)renderEditor();
}
async function profilePage(token){
  const result=await api('/api/teacher');if(token!==revision)return;state.teacher=result.teacher;const teacher=result.teacher;heading('Account & guidance','Your teaching profile.','These instructions are included in your teacher-controlled model context.');const form=el('form',undefined,{class:'panel stack narrow'}),name=required(field('Display name',teacher.name)),custom=field('Your default teaching instructions',teacher.customInstructions,'textarea');form.append(name.wrapper,el('p',teacher.email,{class:'muted'}),custom.wrapper);submit(form,'Save profile',async()=>{state.teacher=(await api('/api/teacher',{name:name.input.value,customInstructions:custom.input.value},'PATCH')).teacher;notify('Profile saved.');});main.append(form);
  const passwordPanel=el('details',undefined,{class:'panel'});passwordPanel.append(el('summary','Change password'));
  const passwordForm=el('form',undefined,{class:'stack narrow'}),currentPassword=required(field('Current password','','password')),newPassword=required(field('New password','','password'));currentPassword.input.autocomplete='current-password';newPassword.input.autocomplete='new-password';newPassword.input.minLength=4;passwordForm.append(currentPassword.wrapper,newPassword.wrapper);
  submit(passwordForm,'Change password',async()=>{await api('/api/teacher/password',{currentPassword:currentPassword.input.value,newPassword:newPassword.input.value});currentPassword.input.value='';newPassword.input.value='';passwordPanel.open=false;notify('Password changed. Your other teacher sessions have been signed out.');});passwordPanel.append(passwordForm);main.append(passwordPanel);
  if(teacher.admin){
    const accounts=await api('/api/teachers');if(token!==revision)return;
    const section=el('section',undefined,{class:'panel stack'});section.append(el('h2','Teacher accounts'));
    const table=el('table'),head=el('tr');head.append(el('th','Name'),el('th','Email'),el('th','Role'),el('th',''));table.append(head);
    for(const item of array(accounts.teachers)){
      const row=el('tr'),action=el('td');row.append(el('td',item.name),el('td',item.email),el('td',item.admin?'Administrator':'Teacher'),action);
      if(item.id!==teacher.id)action.append(button('Reset password',()=>openModal(`Reset password · ${item.name}`,body=>{
        const reset=el('form',undefined,{class:'stack'}),password=required(field('New password','','password'));password.input.autocomplete='new-password';password.input.minLength=4;
        reset.append(el('p',item.email,{class:'muted'}),password.wrapper,el('p','This signs out their current teacher sessions. No email is sent.',{class:'hint'}));
        submit(reset,'Reset password',async()=>{await api(`/api/teachers/${pathId(item.id)}/password`,{password:password.input.value});password.input.value='';modal.close();notify('Teacher password reset. Share it through your approved channel.');});body.append(reset);
      }),'small'));table.append(row);
    }
    section.append(append(el('div',undefined,{class:'table-wrap'}),table));
    const create=el('form',undefined,{class:'stack'}),accountName=required(field('New teacher name')),email=required(field('New teacher email','','email')),password=field('Initial password (optional)','','password','Leave blank to use the username default. No email is sent.');password.input.minLength=4;password.input.autocomplete='new-password';create.append(accountName.wrapper,email.wrapper,password.wrapper);
    submit(create,'Create teacher account',async()=>{await api('/api/teachers',{name:accountName.input.value,email:email.input.value,...(password.input.value?{password:password.input.value}:{})});password.input.value='';notify('Teacher account created.');routePage();});section.append(create);main.append(section);
  }
}
async function runsPage(token){const result=await api('/api/runs');if(token!==revision)return;heading('Live & saved sessions','Conversations in motion.','Sessions survive closing the browser and restarting the server.',link('Open library','#/teacher/library','button'));const grid=el('div',undefined,{class:'grid'});if(!array(result.runs).length)grid.append(empty('No sessions yet. Launch a space from your library.'));array(result.runs).forEach(run=>{const card=el('article',undefined,{class:'card'});card.append(badge(run.status),el('h2',run.title),el('p',new Date(run.createdAt).toLocaleString(),{class:'muted'}),el('p',run.expiresAt?`Expires ${new Date(run.expiresAt).toLocaleString()}`:'No scheduled expiry'),append(el('div',undefined,{class:'actions'}),link('Open dashboard',`#/teacher/run/${run.id}`,'button primary'),button('Share code',()=>shareRun(run))));grid.append(card);});main.append(grid);}
function taskProgress(participant){
  const item=record(participant),status=['not-assessed','current','pending','unavailable'].includes(item.progressStatus)?item.progressStatus:'',value=typeof item.progress==='number'&&Number.isFinite(item.progress)&&item.progress>=0&&item.progress<=100?item.progress:null;
  if(value!==null&&status==='current')return {state:'current',assessed:true,text:`Task progress ${Math.round(value)}%`};
  if(status==='pending')return {state:'pending',assessed:false,text:'Task progress assessment pending'};
  if(status==='unavailable')return {state:'unavailable',assessed:false,text:'Task progress unavailable'};
  return {state:'not-assessed',assessed:false,text:'Task not yet assessed'};
}
function assessedMastery(participant){const values=array(record(participant.insights).outcomes).map(item=>record(item).mastery).filter(value=>typeof value==='number'&&Number.isFinite(value)&&value>=1&&value<=4);return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;}
function insightView(insights,participant){
  const root=el('div',undefined,{class:'stack'});
  function evidence(ids){const row=el('div',undefined,{class:'actions source-evidence'});array(ids).forEach(id=>{const message=array(participant.messages).find(item=>item.id===id),artifact=array(participant.artifacts).find(item=>item.id===id);if(message||artifact)row.append(button('Review evidence',()=>{const target=document.getElementById(`${message?'message':'artifact'}-${id}`);if(target){if(target.tagName==='DETAILS')target.open=true;target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}},'small'));});return row;}
  const criteria=array(record(participant.taskProgressMeta).criteria);
  if(criteria.length){const task=el('details');task.append(el('summary',`${taskProgress(participant).text} · completion evidence`));for(const item of criteria){const criterion=record(item),row=el('div',undefined,{class:'stack'});row.append(el('strong',`${string(criterion.label)} · ${string(criterion.status)}`));for(const quote of array(criterion.evidence))row.append(el('p',`“${string(record(quote).quote)}”`));row.append(evidence(array(criterion.evidence).map(item=>record(item).sourceId)));task.append(row);}root.append(task);}
  if(!insights){root.append(el('p','No mastery assessment generated. Task completion is not a mastery score.',{class:'hint'}));return root;}
  const value=record(insights);root.append(el('h3',string(value.headline)||'AI learning insight'),el('p',string(value.summary)),el('p','AI-generated advisory. Verify evidence yourself; not a grade, diagnosis, or safety guarantee.',{class:'notice warning'}));
  array(value.outcomes).forEach(item=>{const outcome=record(item);const section=el('section',undefined,{class:'panel'});section.append(el('h3',string(outcome.outcome)),el('p',typeof outcome.mastery==='number'?`Assessed mastery ${outcome.mastery} / 4`:'Not enough evidence to assess'),evidence(outcome.evidence));root.append(section);});array(value.flags).forEach(item=>{const flag=record(item),section=el('section',undefined,{class:'notice warning'});section.append(el('strong',`For human review · ${string(flag.severity)}`),el('p',string(flag.reason)),evidence(flag.evidence));root.append(section);});return root;
}
async function dashboardPage(id,token){
  let data=await api(`/api/runs/${pathId(id)}/dashboard`);if(token!==revision)return;let selected='',polling=false;
  heading('Teacher observation',data.run.title,'Listen first. Follow the evidence. Keep learners in view.');
  const lifecycle=el('div',undefined,{class:'panel stack'}),status=el('div',undefined,{class:'row between'}),controls=el('div',undefined,{class:'actions'}),runInfo=el('div'),stats=el('div',undefined,{class:'stats'});lifecycle.append(status,runInfo,controls,stats);main.append(lifecycle);
  const alertHost=el('div');main.append(alertHost);
  const alertPanel=mountAlertPanel(alertHost,{api,runId:id,onError:showError,onReview:(participantId,sourceId)=>{
    const participant=array(data.participants).find(item=>item.id===participantId);if(!participant)return;
    selected=participantId;renderParticipant(participant);renderLearners();
    const message=document.getElementById(`message-${sourceId}`);if(message){message.tabIndex=-1;message.focus({preventScroll:true});message.scrollIntoView({block:'center'});}else right.scrollIntoView({block:'start'});
  }});
  const statusDetails=el('div',undefined,{class:'row'}),shareControl=button('Share code & QR',()=>shareRun(data.run));status.append(statusDetails,shareControl);
  const draftPrefix=`classroom-intervention-${state.teacher.id}-${id}-`,draftKey=participantId=>draftPrefix+participantId;
  function getDraft(participantId){const key=draftKey(participantId);return interventionDrafts.has(key)?interventionDrafts.get(key):preference(key);}
  function setDraft(participantId,value){const key=draftKey(participantId);interventionDrafts.set(key,value);preference(key,value);}
  const split=el('div',undefined,{class:'split'}),left=el('section',undefined,{class:'stack'}),right=el('section',undefined,{class:'panel stack','aria-label':'Selected learner'});split.append(left,right);main.append(split);const filters=el('div',undefined,{class:'grid two'}),sort=selectField('Sort learners',[{value:'name',label:'Name'},{value:'mastery',label:'Assessed mastery (lowest first)'},{value:'recent',label:'Recently active'}],'name'),group=selectField('Assessment group',[{value:'all',label:'All learners'},{value:'unassessed',label:'Unassessed'},{value:'support',label:'AI suggests support'},{value:'ready',label:'AI suggests ready'}],'all');filters.append(sort.wrapper,group.wrapper);const learners=el('div',undefined,{class:'stack'}),summary=el('section',undefined,{class:'panel stack'});left.append(filters,learners,summary);
  const refresh=async()=>{data=await api(`/api/runs/${pathId(id)}/dashboard`);if(token===revision)render(false);};
  function render(force){
    alertPanel.update(data.alerts,data.monitoring);
    statusDetails.replaceChildren(badge(data.run.status),el('strong',data.run.title));
    runInfo.replaceChildren(el('p',`Code ${data.run.code} · ${data.run.maxTurns} turns maximum${data.run.expiresAt?' · Expires '+new Date(data.run.expiresAt).toLocaleString():''}`,{class:'muted'}));
    // Keep lifecycle controls stable while polling; labels and locks update below.
    if(!controls.children.length||force){
      controls.replaceChildren();
      if(data.run.status!=='ended'){
        const pause=button(data.run.status==='active'?'Pause classroom':'Resume classroom',async()=>{await api(`/api/runs/${pathId(id)}/${data.run.status==='active'?'pause':'resume'}`,{});await refresh();},'primary');
        pause.dataset.lifecycle='pause';
        const end=button('End classroom',async()=>{if(!confirm('End this session? It cannot be resumed. You can launch a new session from its template.'))return;await api(`/api/runs/${pathId(id)}/end`,{});await refresh();},'danger');end.dataset.lifecycle='end';
        controls.append(pause,end);
      }
      controls.append(button('Edit session instructions',()=>editSession()),button('Add collaborator',()=>collaborator()),button('Generate group insights',async()=>{await api(`/api/runs/${pathId(id)}/insights`,{});await refresh();}),button('Download JSON',()=>downloadFrom(`/api/runs/${pathId(id)}/export?format=json`,'classroom-run.json')),button('Download CSV',()=>downloadFrom(`/api/runs/${pathId(id)}/export?format=csv`,'classroom-run.csv')));
    }
    const pauseControl=controls.querySelector('[data-lifecycle="pause"]');if(pauseControl)pauseControl.textContent=data.run.status==='ended'?'Classroom ended':data.run.status==='active'?'Pause classroom':'Resume classroom';
    for(const control of controls.querySelectorAll('[data-lifecycle]')){control.dataset.locked=String(data.run.status==='ended');if(data.run.status==='ended')control.disabled=true;}
    stats.replaceChildren();[['Learners',array(data.participants).length],['Individually paused',array(data.participants).filter(item=>item.paused).length],['AI assessed',array(data.participants).filter(item=>assessedMastery(item)!==null).length]].forEach(([label,value])=>stats.append(append(el('div'),el('strong',value),el('span',label))));
    if(!learners.contains(document.activeElement)||force)renderLearners();renderSummary();
    const participant=array(data.participants).find(item=>item.id===selected);
    if(participant){if(force||right.dataset.participant!==participant.id)renderParticipant(participant);else updateParticipant(participant);}else if(!selected)right.replaceChildren(empty('Select a learner to review their conversation, uploads, work and assessment evidence.'));
  }
  function renderLearners(){
    learners.replaceChildren();let participants=[...array(data.participants)];const groupIds=array(record(data.summary)[group.input.value]);
    if(group.input.value==='unassessed')participants=participants.filter(item=>assessedMastery(item)===null);else if(['support','ready'].includes(group.input.value))participants=participants.filter(item=>groupIds.includes(item.id));
    participants.sort((a,b)=>sort.input.value==='mastery'?(assessedMastery(a)??99)-(assessedMastery(b)??99):sort.input.value==='recent'?Date.parse(b.updatedAt)-Date.parse(a.updatedAt):string(a.name).localeCompare(string(b.name)));
    if(!participants.length)learners.append(empty('No learners in this group. Share the code, or generate evidence-backed insights.'));
    participants.forEach(participant=>{
      const card=el('article',undefined,{class:'panel stack'}),mastery=assessedMastery(participant);
      const review=button(selected===participant.id?'Reviewing learner':'Review learner',()=>{
        if(selected===participant.id)return;
        selected=participant.id;renderParticipant(array(data.participants).find(item=>item.id===selected));
        for(const control of learners.querySelectorAll('[data-review]')){const current=control.dataset.review===selected;control.textContent=current?'Reviewing learner':'Review learner';control.className=current?'primary':'';}
      },selected===participant.id?'primary':'');review.dataset.review=participant.id;
      card.append(append(el('div',undefined,{class:'row between'}),el('h3',participant.name),participant.paused?badge('paused'):null),el('p',`${array(participant.messages).filter(message=>message.role==='user').length} student messages · ${taskProgress(participant).text}`,{class:'muted'}),el('p',mastery===null?'Not assessed':`AI-assessed mastery ${mastery.toFixed(1)} / 4`),review);learners.append(card);
    });
  }
  function renderSummary(){summary.replaceChildren(el('h2','The classroom picture'),el('p','AI-generated advisory. Groups are based on assessed mastery, never message count. Verify transcripts and context before acting.',{class:'notice warning'}));if(!data.summary){summary.append(empty('No group synthesis generated yet.'));return;}const value=record(data.summary);summary.append(el('p',string(value.summary)));const misunderstandings=el('ul');array(value.misconceptions).forEach(item=>misunderstandings.append(el('li',string(item))));if(misunderstandings.children.length)summary.append(el('h3','Possible misconceptions'),misunderstandings);for(const key of ['support','ready']){summary.append(el('h3',key==='support'?'Suggested support group':'Suggested ready group'));const names=array(value[key]).map(pid=>array(data.participants).find(item=>item.id===pid)?.name).filter(Boolean);summary.append(el('p',names.join(', ')||'No learners identified.'));}}
  function renderParticipant(participant){
    if(!participant)return;
    if(right.dataset.participant===participant.id){updateParticipant(participant);return;}
    right.replaceChildren();right.dataset.participant=participant.id;right.append(el('h2',participant.name));
    right.append(el('p',undefined,{class:'muted','data-participant-status':''}));
    const actions=el('div',undefined,{class:'actions'});
    const pause=button(participant.paused?'Resume learner':'Pause learner',async()=>{
      const current=array(data.participants).find(item=>item.id===participant.id);
      if(!current)throw new Error('This learner is no longer available.');
      await api(`/api/runs/${pathId(id)}/participants/${pathId(participant.id)}/${current.paused?'resume':'pause'}`,{});
      await refresh();
    });
    pause.dataset.pauseLearner='';
    actions.append(pause,button('Generate learning insight',async()=>{await api(`/api/runs/${pathId(id)}/participants/${pathId(participant.id)}/insights`,{});await refresh();}));
    right.append(actions);
    const form=el('form',undefined,{class:'stack'}),message=required(field('Teacher intervention',getDraft(participant.id),'textarea','This appears as a clearly labeled teacher message, separate from AI replies. Unsent drafts are kept per learner in this browser tab.'));
    message.input.dataset.intervention='';message.input.addEventListener('input',()=>setDraft(participant.id,message.input.value));
    form.append(message.wrapper);
    submit(form,'Send teacher message',async()=>{
      const sent=message.input.value;await api(`/api/runs/${pathId(id)}/participants/${pathId(participant.id)}/message`,{message:sent});
      if(getDraft(participant.id)===sent){setDraft(participant.id,'');const current=right.dataset.participant===participant.id?right.querySelector('[data-intervention]'):null;if(current?.value===sent)current.value='';}
      await refresh();
    });
    right.append(form,el('h3','Conversation'),el('div',undefined,{class:'transcript stack','data-transcript':''}),el('h3','Learning insight'),el('div',undefined,{'data-insight':''}),el('h3','Saved work'),el('div',undefined,{class:'artifacts','data-artifacts':''}));
    updateParticipant(participant);
  }
  function updateParticipant(participant){
    const status=right.querySelector('[data-participant-status]');status.textContent=`${participant.paused?'Individually paused':'Not individually paused'} · ${taskProgress(participant).text}`;
    const pause=right.querySelector('[data-pause-learner]');if(pause)pause.textContent=participant.paused?'Resume learner':'Pause learner';
    syncMessages(right.querySelector('[data-transcript]'),participant.messages,false);
    const insight=right.querySelector('[data-insight]'),signature=JSON.stringify([participant.insights,participant.taskProgressMeta]);
    if(insight.dataset.signature!==signature&&!insight.contains(document.activeElement)){insight.replaceChildren(insightView(participant.insights,participant));insight.dataset.signature=signature;}
    const artifacts=right.querySelector('[data-artifacts]'),artifactSignature=JSON.stringify(array(participant.artifacts).map(item=>[item.id,item.updatedAt]));
    if(artifacts.dataset.signature!==artifactSignature&&!artifacts.contains(document.activeElement)){
      artifacts.replaceChildren();if(!array(participant.artifacts).length)artifacts.append(empty('No saved work yet.'));
      array(participant.artifacts).forEach(artifact=>{const details=el('details',undefined,{id:`artifact-${artifact.id}`});details.append(el('summary',`${artifact.title} · ${artifact.type}`));const view=el('div',undefined,{class:'tool-workspace'});renderArtifact(view,artifact);details.append(view);artifacts.append(details);});
      artifacts.dataset.signature=artifactSignature;
    }
  }
  function editSession(){openModal('Edit this session',body=>{const form=el('form',undefined,{class:'stack'}),title=required(field('Session title',data.run.title)),prompt=field('Session instructions',data.run.sessionPrompt,'textarea');prompt.input.disabled=data.run.status!=='paused';form.append(title.wrapper,prompt.wrapper,el('p','Pause the classroom before editing session instructions. The reusable template is unchanged.',{class:'notice'}));submit(form,'Save session changes',async()=>{await api(`/api/runs/${pathId(id)}`,{title:title.input.value,...(data.run.status==='paused'?{sessionPrompt:prompt.input.value}:{})},'PATCH');modal.close();await refresh();});body.append(form);});}
  function collaborator(){openModal('Add a teaching collaborator',body=>{const form=el('form',undefined,{class:'stack'}),email=required(field('Existing teacher email','','email'));form.append(email.wrapper,el('p','Adds monitoring, pause/resume and intervention access for an existing teacher account. No email invitation is sent. Only the owner or administrator can grant access.',{class:'notice'}));submit(form,'Grant classroom access',async()=>{await api(`/api/runs/${pathId(id)}/collaborators`,{email:email.input.value});modal.close();notify('Collaborator granted access.');await refresh();});body.append(form);if(array(data.collaborators).length)body.append(el('p',array(data.collaborators).map(item=>typeof item==='string'?item:string(record(item).email)).join(', ')));});}
  sort.input.addEventListener('change',renderLearners);group.input.addEventListener('change',renderLearners);render(true);
  const timer=setInterval(async()=>{if(polling||document.hidden)return;polling=true;try{await refresh();}catch(error){if(token===revision)showError(error);}finally{polling=false;}},3000);
  const beforeUnload=event=>{if(array(data.participants).some(participant=>getDraft(participant.id))){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);cleanup=()=>{clearInterval(timer);alertPanel.destroy();window.removeEventListener('beforeunload',beforeUnload);};
}
function joinPage(){
  const form=el('form',undefined,{class:'panel stack join-card'}),intro=append(el('div',undefined,{class:'join-heading'}),el('h1','Join a Space'),el('p','Enter the code your teacher shared.')),codeGroup=el('fieldset',undefined,{class:'stack',style:'border:0;padding:0'}),boxes=el('div',undefined,{class:'code-grid'}),initial=(new URL(location.href).searchParams.get('code')||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8),inputs=[];
  codeGroup.append(el('legend','Space code',{class:'code-label'}),boxes);
  for(let index=0;index<8;index++){const input=el('input',undefined,{type:'text',maxlength:1,pattern:'[A-Z2-9]',required:'',autocomplete:'off',autocapitalize:'characters',spellcheck:'false','aria-label':`Space code character ${index+1} of 8`});input.value=initial[index]||'';inputs.push(input);boxes.append(input);
    input.addEventListener('input',()=>{input.value=input.value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(-1);if(input.value)inputs[index+1]?.focus();scheduleLookup();});
    input.addEventListener('keydown',event=>{if(event.key==='Backspace'&&!input.value)inputs[index-1]?.focus();if(event.key==='ArrowLeft')inputs[index-1]?.focus();if(event.key==='ArrowRight')inputs[index+1]?.focus();});
    input.addEventListener('paste',event=>{const pasted=event.clipboardData?.getData('text').toUpperCase().replace(/[^A-Z2-9]/g,'')||'';if(!pasted)return;event.preventDefault();for(let offset=0;offset<pasted.length&&index+offset<8;offset++)inputs[index+offset].value=pasted[offset];inputs[Math.min(7,index+pasted.length)]?.focus();scheduleLookup();});
  }
  let roster=[],rosterStatus='',selectedStudent='',lookupVersion=0,lookupTimer=0,joinButton=null;
  const codeValue=()=>inputs.map(input=>input.value).join('');
  function syncJoinButton(){const blocked=(rosterStatus==='ended'||rosterStatus==='paused')&&!selectedStudent;if(!joinButton)return;joinButton.disabled=blocked;joinButton.dataset.locked=String(blocked);}
  function renderRoster(){
    returning.input.replaceChildren(el('option','New student',{value:''}));
    for(const student of roster)returning.input.append(el('option',student.name,{value:student.id}));
    returning.input.value=roster.some(item=>item.id===selectedStudent)?selectedStudent:'';
    returningBlock.hidden=!roster.length;
    if(!roster.length){rosterNote.className='hint';rosterNote.textContent='';syncJoinButton();return;}
    rosterNote.className='hint';
    rosterNote.textContent=`${rosterStatus==='ended'?'This classroom has ended, so saved work opens read-only. ':rosterStatus==='paused'?'This classroom is paused; saved work opens read-only until your teacher resumes it. ':''}Choose your own username to continue where you left off. Anyone with this classroom code can select any listed username: this is a class list, not a password or verified sign-in.`;
    syncJoinButton();
  }
  async function lookupRoster(version){
    try{const result=await api('/api/join/students',{code:codeValue()});if(version!==lookupVersion)return;roster=array(result.students).filter(item=>record(item)&&string(item.id)&&string(item.name)).map(item=>({id:string(item.id),name:string(item.name)}));rosterStatus=['active','paused','ended'].includes(result.status)?result.status:'';}
    catch(error){if(version!==lookupVersion)return;roster=[];rosterStatus='';renderRoster();rosterNote.className='error';rosterNote.textContent=error instanceof Error?error.message:String(error);returningBlock.hidden=false;syncJoinButton();return;}
    renderRoster();
  }
  function scheduleLookup(){
    clearTimeout(lookupTimer);lookupVersion++;
    if(codeValue().length!==8){roster=[];rosterStatus='';selectedStudent='';returning.input.replaceChildren(el('option','New student',{value:''}));returningBlock.hidden=true;rosterNote.textContent='';syncJoinButton();return;}
    roster=[];rosterStatus='';returning.input.replaceChildren(el('option','New student',{value:''}));returningBlock.hidden=true;syncJoinButton();
    const version=lookupVersion;lookupTimer=setTimeout(()=>{void lookupRoster(version);},450);
  }
  const name=required(field('Username','','text','Use the same username to return later; your teacher and classmates see this name.')),returning=selectField('Returning student',[{value:'',label:'New student'}]),rosterNote=el('p',undefined,{class:'hint'}),returningBlock=append(el('div',undefined,{class:'stack'}),returning.wrapper,rosterNote);
  returning.input.addEventListener('change',()=>{selectedStudent=returning.input.value;const student=roster.find(item=>item.id===selectedStudent);name.input.value=student?student.name:'';syncJoinButton();});
  name.input.autocomplete='username';name.input.maxLength=120;name.input.placeholder='Your username';form.append(intro,codeGroup,returningBlock,name.wrapper);
  joinButton=submit(form,'Join Space',async()=>{const result=await api('/api/join',{code:codeValue(),name:name.input.value.trim(),...(selectedStudent?{participantId:selectedStudent}:{})});state.student=result.participant;notify(`Welcome, ${result.participant.name}. You can return with the same code and username.`);navigate('/student');});
  form.append(el('p','Your teacher can review your conversation and saved work. AI requests go to the provider selected by your teacher. Do not share passwords or sensitive personal information.',{class:'hint'}));if(state.student)form.append(link('Resume your Space','#/student','button'));
  if(codeValue().length===8)scheduleLookup();else syncJoinButton();
  main.append(form);
}
function readAloud(content,language){if(!('speechSynthesis'in window))throw new Error('Read-aloud is unavailable in this browser.');speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(content);if(language)utterance.lang=language;utterance.onerror=()=>showError(new Error('The browser could not read this text aloud. Check its installed voices.'));speechSynthesis.speak(utterance);}
function messageText(content){
  const root=el('div',undefined,{class:'message-content'});
  function inline(parent,text){for(const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)){const tag=part.startsWith('**')&&part.endsWith('**')?'strong':part.startsWith('`')&&part.endsWith('`')?'code':part.startsWith('*')&&part.endsWith('*')?'em':null;parent.append(tag?el(tag,part.slice(tag==='strong'?2:1,tag==='strong'?-2:-1)):document.createTextNode(part));}}
  for(const paragraph of string(content).split(/\n\s*\n/)){const rows=paragraph.split('\n'),unordered=rows.every(row=>/^\s*[-*] /.test(row)),ordered=rows.every(row=>/^\s*\d+[.)] /.test(row));if(unordered||ordered){const list=el(unordered?'ul':'ol');for(const row of rows){const item=el('li');inline(item,row.replace(/^\s*(?:[-*]|\d+[.)]) /,''));list.append(item);}root.append(list);}else{const p=el('p');inline(p,paragraph);root.append(p);}}
  return root;
}
function messageView(message,language,onFeedback){
  const role=['user','assistant','teacher'].includes(message.role)?message.role:'assistant',root=el('article',undefined,{class:`message ${role}`});if(message.id)root.id=`message-${message.id}`;
  root.append(el('p',role==='user'?'Student':role==='teacher'?'Your teacher':'AI learning companion',{class:'message-label'}),messageText(message.content));array(message.attachments).forEach(item=>root.append(materialView(item)));
  const actions=el('div',undefined,{class:'actions'});
  if(role!=='user'){if(role==='assistant')actions.append(el('span','C',{class:'message-avatar','aria-hidden':'true'}));const listen=button('Listen',()=>readAloud(message.content,typeof language==='function'?language():language),'small quiet listen');listen.prepend(icon('listen'));actions.append(listen);}
  if(role==='assistant'&&message.id&&onFeedback){for(const [value,label]of [['positive','Give positive feedback'],['negative','Give negative feedback']]){const control=iconButton(label,'thumb',()=>onFeedback(message.id,value),'small quiet');control.dataset.feedback=value;if(value==='negative')control.querySelector('svg').style.transform='rotate(180deg)';actions.append(control);}actions.append(el('span',undefined,{class:'message-feedback','aria-live':'polite'}));}
  actions.append(iconButton('Copy message','copy',async()=>{if(!navigator.clipboard)throw new Error('Clipboard access is unavailable. Select the message text to copy it.');await navigator.clipboard.writeText(message.content);notify('Message copied.');},'small quiet'));root.append(actions);if(message.createdAt)root.append(el('time',new Date(message.createdAt).toLocaleTimeString(),{datetime:message.createdAt}));return root;
}
function syncMessages(container,messages,scroll,language,onFeedback){
  if(!container)return;const existing=new Map(Array.from(container.children).map(item=>[item.id,item])),scroller=container.closest('.student-feed')||container,nearBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<90;
  for(const message of array(messages)){let root=existing.get(`message-${message.id}`);if(!root){root=messageView(message,language,onFeedback);container.append(root);}if(root.dataset.feedback!==string(message.feedback)){root.dataset.feedback=string(message.feedback);for(const control of root.querySelectorAll('[data-feedback]')){const selected=control.dataset.feedback===message.feedback;control.setAttribute('aria-pressed',String(selected));control.classList.toggle('feedback-active',selected);}const status=root.querySelector('.message-feedback');if(status)status.textContent=message.feedback?'Feedback saved':'';}}
  if(!array(messages).length&&!container.children.length)container.append(el('p','Your teacher’s instructions guide this conversation.',{class:'chat-empty muted'}));if(array(messages).length)container.querySelector('.chat-empty')?.remove();if(scroll&&nearBottom)scroller.scrollTop=scroller.scrollHeight;
}
async function studentPage(token){
  let data=await api('/api/student');if(token!==revision)return;state.student={id:data.participant.id,name:data.participant.name,runId:data.run.id};let attachments=[],pending=null,busy=false,polling=false,recognition=null,tools;
  document.body.dataset.surface='student';
  const header=el('header',undefined,{class:'student-header'}),brand=link('ClassRoomAI','#/student','brand'),headerActions=el('div',undefined,{class:'actions'});header.append(brand,el('h1',data.run.title),headerActions);main.append(header);
  const shell=el('section',undefined,{class:'student-chat-shell student-reading'}),feed=el('div',undefined,{class:'student-feed'}),chat=el('div',undefined,{class:'chat',role:'log','aria-label':'Your classroom conversation','aria-live':'polite','aria-relevant':'additions'}),runStatus=el('p',undefined,{class:'student-status',role:'status','aria-live':'polite'}),composerShell=el('div',undefined,{class:'student-composer-shell'}),form=el('form',undefined,{class:'student-composer'}),draft=field('Write a message','','textarea'),composerActions=el('div',undefined,{class:'student-composer-actions'}),attachmentList=el('div',undefined,{class:'student-attachments stack'}),pendingStatus=el('p',undefined,{class:'student-pending',role:'status','aria-live':'polite'});draft.input.placeholder='Write a message…';draft.input.maxLength=8000;draft.input.rows=1;
  const draftKey=`classroom-draft-${data.participant.id}`;draft.input.value=preference(draftKey);
  draft.input.addEventListener('input',()=>{preference(draftKey,draft.input.value);draft.input.style.height='42px';draft.input.style.height=`${Math.min(160,draft.input.scrollHeight)}px`;if(pending&&pending.message!==draft.input.value){pending=null;retry.hidden=true;}});
  draft.input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!busy&&active())form.requestSubmit();}});
  const fileInput=el('input',undefined,{type:'file',accept:ACCEPT,'aria-label':'Attach a file or image'}),attach=iconButton('Attach a file or image','attach',()=>fileInput.click(),'icon-button attach-button');fileInput.addEventListener('change',()=>guard(async()=>{const file=fileInput.files[0];if(!file)return;if(attachments.length>=5)throw new Error('Attach at most five files per message.');attachments.push(await upload(file));pending=null;retry.hidden=true;renderAttachments();fileInput.value='';},attach));
  const speech=iconButton('Speak a message','mic',startSpeech),stopSpeech=iconButton('Stop dictation','close',()=>recognition?.stop());stopSpeech.hidden=true;const send=el('button',undefined,{type:'submit',class:'primary','aria-label':'Send message',title:'Send message'});send.append(icon('send'));
  const retry=button('Retry the same message',sendMessage,'small retry-control');retry.hidden=true;const openingRetry=button('Retry opening message',startConversation,'small retry-control');openingRetry.hidden=true;
  composerActions.append(attach,fileInput,retry,openingRetry,speech,stopSpeech,send);form.append(attachmentList,draft.wrapper,composerActions,pendingStatus);form.addEventListener('submit',event=>{event.preventDefault();guard(sendMessage,send);});
  composerShell.append(form,el('p','This is AI, not a person. It can make mistakes. Your teacher can review your messages and saved work. Do not share sensitive personal information.',{class:'student-disclaimer'}));feed.append(chat);shell.append(runStatus,feed,composerShell);main.append(shell);
  const plan=el('div',undefined,{class:'stack student-plan'});plan.append(el('p',data.run.space.studentDescription||data.run.space.subtitle||'Your teacher will guide this learning experience.'),el('p',[data.run.space.subject,data.run.space.gradeLevel].filter(Boolean).join(' · '),{class:'hint'}));if(data.run.space.standard){const standard=el('details');standard.append(el('summary','Curriculum reference'),el('p',data.run.space.standard));plan.append(standard);}
  const outcomeList=el('ul');for(const outcome of array(data.run.space.outcomes))outcomeList.append(el('li',outcome));if(outcomeList.children.length)plan.append(el('h3','Learning outcomes'),outcomeList);
  if(data.run.space.showAgenda){const steps=el('ol',undefined,{class:'stack'});for(const step of array(data.run.space.agenda)){const item=append(el('li'),el('strong',step.title),el('p',step.instructions));if(step.tool&&TOOL_TYPES.includes(step.tool))item.append(button(`Open ${step.tool}`,()=>openTools(step.tool),'small'));steps.append(item);}if(steps.children.length)plan.append(el('h3','Your agenda'),steps);}
  const taskStatus=el('p',taskProgress(data.participant).text),taskPanel=append(el('div',undefined,{class:'stack'}),el('h3','Task progress'),taskStatus);plan.append(taskPanel);
  plan.append(button('Leave Space',async()=>{if((draft.input.value||tools?.hasUnsavedChanges())&&!confirm('Leave this Space? Save tool work before leaving. Your conversation stays on the server and you can return with the same classroom code and username.'))return;await api('/api/student/leave',{});state.student=null;modal.close();navigate('/join');notify('You have left this Space. Your work stays on the server: enter the same classroom code and username to continue later.');},'quiet'));
  let language=null;
  if(data.run.space.allowLanguageChoice===true){const saved=preference('classroom-language'),value=LANGUAGE_OPTIONS.find(item=>item.value===saved||item.label===saved)?.value||(saved==='Chinese'?'zh-CN':'');language=selectField('Response language',[{value:'',label:'Teacher default'},...LANGUAGE_OPTIONS],value);language.input.addEventListener('change',()=>preference('classroom-language',language.input.value));headerActions.append(iconButton('Language settings','language',()=>openModal('Language settings',body=>body.append(language.wrapper))));}
  const languageCode=()=>language?.input.value||'',difficulty=selectField('Support level',[{value:'',label:'Teacher default'},{value:'more-support',label:'More scaffolding'},{value:'standard',label:'Balanced support'},{value:'challenge',label:'More challenge'}],preference('classroom-difficulty'));difficulty.input.addEventListener('change',()=>preference('classroom-difficulty',difficulty.input.value));
  const readingControls=el('div',undefined,{class:'stack'}),sizeKey='classroom-chat-text-size',textSize=selectField('Chat text size',[{value:'standard',label:'Standard'},{value:'large',label:'Large'},{value:'larger',label:'Larger'}],['standard','large','larger'].includes(preference(sizeKey))?preference(sizeKey):'standard');
  function readingCheckbox(label,key){const wrapper=el('label',undefined,{class:'check-label'}),input=el('input',undefined,{type:'checkbox'});input.checked=preference(key)==='true';wrapper.append(input,el('span',label));return {wrapper,input,key};}
  const readingFont=readingCheckbox('Reading-friendly font','classroom-reading-font'),easyRead=readingCheckbox('Easy-read presentation','classroom-easy-read');readingControls.append(textSize.wrapper,readingFont.wrapper,easyRead.wrapper,difficulty.wrapper,el('p','Display settings do not change teacher instructions. The reading-friendly font uses installed Verdana, Tahoma or system sans-serif. Easy-read adds spacing and left-aligns messages.',{class:'hint'}));
  headerActions.append(iconButton('Accessibility','access',()=>openModal('Accessibility & reading',body=>body.append(readingControls))),iconButton('Learning plan','plan',()=>openModal('Your learning plan',body=>body.append(plan))));
  const toolHost=el('div',undefined,{class:'student-reading'});tools=mountTools(toolHost,{api,participant:data.participant,run:data.run,onError:showError,onSaved:artifact=>{data.participant.artifacts=[...array(data.participant.artifacts).filter(item=>item.id!==artifact.id),artifact];notify('Classroom work saved.');}});
  function openTools(type){openModal('Classroom tools',body=>body.append(toolHost),'student-tools-dialog');if(type)tools.open(type);}
  if(array(data.run.space.tools).length||array(data.run.space.agenda).some(step=>step.tool))headerActions.append(iconButton('Classroom tools','tools',()=>openTools()));
  function applyReading(){for(const target of [shell,toolHost]){target.style.setProperty('--chat-text-size',({standard:'14px',large:'16px',larger:'18px'})[textSize.input.value]||'14px');target.classList.toggle('reading-font',readingFont.input.checked);target.classList.toggle('easy-read',easyRead.input.checked);}}
  textSize.input.addEventListener('change',()=>{preference(sizeKey,textSize.input.value);applyReading();});for(const control of [readingFont,easyRead])control.input.addEventListener('change',()=>{preference(control.key,String(control.input.checked));applyReading();});applyReading();
  function active(){return data.run.status==='active'&&!data.participant.paused&&(!data.run.expiresAt||Date.parse(data.run.expiresAt)>Date.now());}
  async function changeFeedback(messageId,value){const current=array(data.participant.messages).find(message=>message.id===messageId),feedback=current?.feedback===value?null:value,result=await api('/api/student/feedback',{messageId,feedback});if(token!==revision)return;data.participant.messages=array(data.participant.messages).map(message=>message.id===messageId?result.message:message);update();}
  function update(){const ended=data.run.status==='ended'||(data.run.expiresAt&&Date.parse(data.run.expiresAt)<=Date.now());runStatus.textContent=ended?'This Space is closed. Your conversation and saved work remain available.':data.participant.paused?'Your teacher has paused your conversation. Your draft stays here.':data.run.status==='paused'?'This Space is paused. Keep your draft; your teacher can resume it.':'';runStatus.hidden=!runStatus.textContent;for(const control of [send,retry,openingRetry,speech,attach,fileInput]){control.disabled=busy||!active();control.dataset.locked=String(control.disabled);}draft.input.disabled=busy;taskStatus.textContent=taskProgress(data.participant).text;syncMessages(chat,data.participant.messages,true,languageCode,changeFeedback);tools.update(data.participant,data.run);}
  function renderAttachments(){attachmentList.replaceChildren();for(const material of attachments)attachmentList.append(materialView(material,()=>{attachments=attachments.filter(item=>item!==material);pending=null;retry.hidden=true;renderAttachments();}));}
  async function startConversation(){if(busy||!active()||array(data.participant.messages).length)return;busy=true;openingRetry.hidden=true;pendingStatus.textContent='Starting your Space with the selected model…';update();try{const result=await api('/api/student/start',{});if(token!==revision)return;data=result;pendingStatus.textContent='';}catch(error){openingRetry.hidden=false;pendingStatus.textContent=`${error instanceof Error?error.message:String(error)} Retry the opening, or send your own message.`;}finally{busy=false;if(token===revision){update();draft.input.focus();}}}
  async function sendMessage(){
    if(busy)return;if(!active())throw new Error('This Space is paused or closed. Keep your draft and ask your teacher.');if(!draft.input.value.trim()&&!attachments.length)throw new Error('Write a message or attach a file first.');
    if(!pending)pending={message:draft.input.value,attachments:[...attachments],requestId:crypto.randomUUID(),...(language?{language:languageCode()}:{}),difficulty:difficulty.input.value};
    busy=true;pendingStatus.textContent='The learning companion is thinking…';retry.hidden=true;openingRetry.hidden=true;update();
    try{const result=await api('/api/student/chat',pending);if(token!==revision)return;data.participant.messages=array(result.messages);draft.input.value='';draft.input.style.height='42px';preference(draftKey,'');attachments=[];pending=null;renderAttachments();pendingStatus.textContent='';syncMessages(chat,data.participant.messages,true,languageCode,changeFeedback);feed.scrollTop=feed.scrollHeight;}
    catch(error){retry.hidden=false;pendingStatus.textContent=`${error instanceof Error?error.message:String(error)} Your draft is retained for retry.`;}
    finally{busy=false;if(token===revision){update();draft.input.focus();}}
  }
  function startSpeech(){const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition)throw new Error('Speech recognition is unavailable in this browser. Type your message instead.');if(recognition)return;if(!confirm('Use browser dictation? Your browser may send voice audio to its speech provider. Nothing is sent to this Space until you press Send.'))return;recognition=new Recognition();recognition.lang=languageCode()||navigator.language||document.documentElement.lang;recognition.interimResults=false;recognition.continuous=false;stopSpeech.hidden=false;pendingStatus.textContent='Listening. Review the dictated text before sending.';recognition.onresult=event=>{const transcript=Array.from(event.results).map(result=>result[0].transcript).join(' ');draft.input.value=[draft.input.value,transcript].filter(Boolean).join(' ');draft.input.dispatchEvent(new Event('input'));};recognition.onerror=event=>{pendingStatus.textContent=`Dictation failed (${event.error}). You can still type your message.`;};recognition.onend=()=>{recognition=null;stopSpeech.hidden=true;};recognition.start();}
  update();if(active()&&!array(data.participant.messages).length)void startConversation();
  const timer=setInterval(async()=>{if(polling||document.hidden||busy)return;polling=true;try{const fresh=await api('/api/student');if(token===revision){data=fresh;update();}}catch(error){if(token===revision)showError(error);}finally{polling=false;}},3000);
  const beforeUnload=event=>{if(tools.hasUnsavedChanges()){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);cleanup=()=>{clearInterval(timer);recognition?.abort();if('speechSynthesis'in window)speechSynthesis.cancel();tools.destroy();window.removeEventListener('beforeunload',beforeUnload);if(modal.open)modal.close();};
}
async function routePage(){
  cleanup();cleanup=()=>{};revision++;const token=revision;clearError();main.replaceChildren();const route=location.hash.slice(1)|| (new URL(location.href).searchParams.has('code')?'/join':'/');updateNavigation(route);
  document.body.dataset.surface=route==='/student'&&state.student&&!state.setupRequired?'student':'teacher';
  window.scrollTo({top:0,left:0});
  if(state.setupRequired){authPage(true);return;}
  if(route.startsWith('/teacher')&&!state.teacher){authPage(false);return;}
  if(route==='/student'&&!state.student){joinPage();return;}
  try{if(route==='/')landing();else if(route==='/join')joinPage();else if(route==='/login')authPage();else if(route==='/teacher/library')await libraryPage(token);else if(route==='/teacher/new')await spaceEditor('',token);else if(route.startsWith('/teacher/edit/'))await spaceEditor(decodeURIComponent(route.slice('/teacher/edit/'.length)),token);else if(route==='/teacher/settings')await settingsPage(token);else if(route==='/teacher/profile')await profilePage(token);else if(route==='/teacher/runs')await runsPage(token);else if(route.startsWith('/teacher/run/'))await dashboardPage(decodeURIComponent(route.slice('/teacher/run/'.length)),token);else if(route==='/student')await studentPage(token);else{heading('Page not found','Find your way back.');main.append(link('Go to the entrance','#/','button'));}if(token===revision)main.focus({preventScroll:true});}catch(error){if(token===revision){showError(error);main.append(button('Retry loading this page',routePage,'primary'));}}
}
window.addEventListener('hashchange',()=>routePage());
document.querySelector('#sidebar-toggle').replaceChildren(icon('menu'));
document.querySelector('#sidebar-toggle').addEventListener('click',()=>{const mobile=matchMedia('(max-width:800px)').matches;document.body.classList.toggle(mobile?'sidebar-open':'sidebar-collapsed');document.querySelector('#sidebar-toggle').setAttribute('aria-expanded',String(mobile?document.body.classList.contains('sidebar-open'):!document.body.classList.contains('sidebar-collapsed')));});
function consumeProviderLoginMarker(){
  const url=new URL(location.href),marker=url.searchParams.get('provider_login');
  if(marker!=='connected'&&marker!=='failed')return;
  url.searchParams.delete('provider_login');
  try{history.replaceState(history.state,'',`${url.pathname}${url.search}${url.hash}`);}catch{}
  notify(marker==='connected'?'Provider sign-in complete. The connection is saved on this computer; fetch its models, then test it before classroom use.':'Provider sign-in was not completed, so no credential was stored and existing connections are unchanged. You can try again or choose another credential source.');
}
async function start(){try{const status=await api('/api/status');state.setupRequired=status.setupRequired===true;state.teacher=status.teacher||null;state.student=status.student||null;await routePage();consumeProviderLoginMarker();}catch(error){showError(error);main.replaceChildren(empty('Your workspace could not be opened.'),button('Try again',start,'primary'));}}
start();
