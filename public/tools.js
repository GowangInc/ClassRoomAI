const TYPES = ['document', 'doodle', 'mindmap', 'flashcards', 'presentation', 'graph', 'video', 'image'];
const GRAPH_EXPRESSION_LIMIT = 256;
const MINDMAP_NODE_LIMIT = 40;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value : '';
const list = value => Array.isArray(value) ? value : [];
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const uid = () => crypto.randomUUID();
function node(tag, content, attrs = {}) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = String(content);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') element.className = value;
    else element.setAttribute(key, String(value));
  }
  return element;
}
function button(label, action, className = '') {
  const element = node('button', label, {type:'button', class:className});
  element.addEventListener('click', action);
  return element;
}
function field(label, value = '', type = 'text') {
  const wrapper = node('label', undefined, {class:'field'});
  wrapper.append(node('span', label));
  const input = node(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.value = String(value ?? '');
  wrapper.append(input);
  return {wrapper, input};
}
function imageSource(mime, data) {
  return /^image\/(png|jpeg|gif|webp)$/.test(text(mime)) && /^[A-Za-z0-9+/=\s]+$/.test(text(data)) ? `data:${mime};base64,${data}` : '';
}
export function youtubeId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    let id;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)$/)?.[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}
function checkMindmapSize(nodes) {
  if (nodes.length > MINDMAP_NODE_LIMIT) throw new Error(`Mind maps support at most ${MINDMAP_NODE_LIMIT} nodes. Reduce the node count before opening or saving this work.`);
}
function checkGraphExpression(expression) {
  if (expression.length > GRAPH_EXPRESSION_LIMIT) throw new Error(`Use a graph expression of at most ${GRAPH_EXPRESSION_LIMIT} characters.`);
}
function normalize(type, value) {
  const data = object(value);
  switch (type) {
    case 'document': return {text: text(data.text)};
    case 'doodle': return {strokes:list(data.strokes).filter(Array.isArray).map(stroke => stroke.slice(0,2000).map(point => ({x:number(object(point).x),y:number(object(point).y)}))),shapes:list(data.shapes).map(value => {const shape=object(value);return {type:['rectangle','circle','text'].includes(shape.type) ? shape.type : 'rectangle',x:number(shape.x,50),y:number(shape.y,50),size:number(shape.size,80),text:text(shape.text)};})};
    case 'mindmap': {
      let nodes = list(data.nodes || (Array.isArray(value) ? value : []));
      if (!nodes.length && typeof data.topic === 'string') {
        const branches = list(data.branches);
        if (branches.length >= MINDMAP_NODE_LIMIT) throw new Error(`Mind maps support at most ${MINDMAP_NODE_LIMIT} nodes. Reduce the node count before opening or saving this work.`);
        nodes = [{label:data.topic},...branches.map(branch => ({label:typeof branch === 'string' ? branch : text(object(branch).label)}))];
      }
      checkMindmapSize(nodes);
      return {nodes:nodes.map((item,index) => ({id:text(object(item).id) || String(index+1),label:typeof item === 'string' ? item : text(object(item).label || object(item).text),parentId:object(item).parentId === null ? '' : text(object(item).parentId) || (index ? text(object(nodes[0]).id) || '1' : '')}))};
    }
    case 'flashcards': return {cards:list(data.cards || data.flashcards || (Array.isArray(value) ? value : [])).map(item => ({front:text(object(item).front || object(item).question || object(item).term),back:text(object(item).back || object(item).answer || object(item).definition)}))};
    case 'presentation': return {slides:list(data.slides || (Array.isArray(value) ? value : [])).map(item => ({title:text(object(item).title),body:text(object(item).body || object(item).content) || list(object(item).bullets).map(text).join('\n')}))};
    case 'graph': return {expression:text(data.expression) || 'sin(x)',min:number(data.min,-10),max:number(data.max,10)};
    case 'video': return {answers:object(data.answers),completed:list(data.completed).map(value => number(value))};
    case 'image': return {mime:text(data.mime),data:text(data.data),prompt:text(data.prompt)};
    default: return {};
  }
}
function drawDoodle(canvas, data) {
  const context = canvas.getContext('2d');
  context.clearRect(0,0,canvas.width,canvas.height);
  context.strokeStyle = '#17665d';context.fillStyle = '#192f33';context.lineWidth = 3;context.lineCap = 'round';
  for (const stroke of data.strokes) {
    context.beginPath();stroke.forEach((point,index) => index ? context.lineTo(point.x,point.y) : context.moveTo(point.x,point.y));context.stroke();
  }
  for (const shape of data.shapes) {
    context.beginPath();
    if (shape.type === 'circle') context.arc(shape.x,shape.y,Math.abs(shape.size)/2,0,Math.PI*2);
    else if (shape.type === 'rectangle') context.rect(shape.x,shape.y,shape.size,shape.size);
    else {context.font='20px system-ui';context.fillText(shape.text,shape.x,shape.y);}
    context.stroke();
  }
}
function mindmapView(data) {
  checkMindmapSize(data.nodes);
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 800 450');svg.setAttribute('role','img');svg.setAttribute('aria-label','Mind map. An accessible node list follows.');
  const positions = new Map();
  data.nodes.forEach((item,index) => positions.set(item.id,{x:index ? 400+270*Math.cos((index-1)*Math.PI*2/Math.max(1,data.nodes.length-1)) : 400,y:index ? 225+170*Math.sin((index-1)*Math.PI*2/Math.max(1,data.nodes.length-1)) : 225}));
  function part(tag, attrs, content) {const el=document.createElementNS(svg.namespaceURI,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));if(content!==undefined)el.textContent=content;svg.append(el);return el;}
  data.nodes.forEach(item => {const start=positions.get(item.parentId),end=positions.get(item.id);if(start&&end)part('line',{x1:start.x,y1:start.y,x2:end.x,y2:end.y,stroke:'#17665d','stroke-width':1});});
  data.nodes.forEach(item => {const point=positions.get(item.id);part('rect',{x:point.x-70,y:point.y-25,width:140,height:50,rx:3,fill:'#e6eef1',stroke:'#192f33'});const label=part('text',{x:point.x,y:point.y+4,'text-anchor':'middle','font-size':13,fill:'#192f33'},item.label.length>21?`${item.label.slice(0,20)}…`:item.label);const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=item.label;label.append(title);});
  return svg;
}
function graphView(container, data) {
  checkGraphExpression(data.expression);
  if (!window.math) {container.append(node('p','The locally served math library is unavailable. Ask your teacher to check the installation.',{class:'error'}));return;}
  if (!Number.isFinite(data.min) || !Number.isFinite(data.max) || data.max <= data.min || data.max-data.min>100000) throw new Error('Choose finite x bounds with maximum greater than minimum (range at most 100,000).');
  const expression = window.math.parse(data.expression);
  let count = 0;
  expression.traverse(item => {
    if (++count>100) throw new Error('Expression is too complex.');
    if (!['OperatorNode','FunctionNode','SymbolNode','ConstantNode','ParenthesisNode'].includes(item.type)) throw new Error('Use a mathematical expression only, not assignments or program statements.');
    if (item.isSymbolNode && !['x','pi','e','sin','cos','tan','asin','acos','atan','sqrt','abs','log','log10','exp','floor','ceil','round','min','max','pow'].includes(item.name)) throw new Error(`Unsupported symbol: ${item.name}`);
    if (item.isFunctionNode && !['sin','cos','tan','asin','acos','atan','sqrt','abs','log','log10','exp','floor','ceil','round','min','max','pow'].includes(item.fn.name)) throw new Error('Unsupported graph function.');
  });
  const compiled=expression.compile(),points=[];
  for(let i=0;i<=240;i++){const x=data.min+(data.max-data.min)*i/240;let y;try{y=compiled.evaluate({x});}catch{y=NaN;}points.push({x,y:typeof y==='number'&&Number.isFinite(y)?y:NaN});}
  const values=points.filter(p=>Number.isFinite(p.y)).map(p=>p.y);if(!values.length)throw new Error('No real finite values in this range.');
  let ymin=Math.min(...values),ymax=Math.max(...values);if(ymin===ymax){ymin--;ymax++;}const pad=(ymax-ymin)*.08;ymin-=pad;ymax+=pad;
  const canvas=node('canvas',undefined,{width:800,height:420,role:'img','aria-label':`Graph of ${data.expression}; sampled values follow.`});container.append(canvas);
  const ctx=canvas.getContext('2d'),px=x=>40+(x-data.min)/(data.max-data.min)*730,py=y=>380-(y-ymin)/(ymax-ymin)*340;
  ctx.strokeStyle='#a4b6b3';ctx.lineWidth=1;for(let i=0;i<=10;i++){ctx.beginPath();ctx.moveTo(40+i*73,40);ctx.lineTo(40+i*73,380);ctx.stroke();ctx.beginPath();ctx.moveTo(40,40+i*34);ctx.lineTo(770,40+i*34);ctx.stroke();}
  ctx.strokeStyle='#192f33';if(data.min<=0&&data.max>=0){ctx.beginPath();ctx.moveTo(px(0),40);ctx.lineTo(px(0),380);ctx.stroke();}if(ymin<=0&&ymax>=0){ctx.beginPath();ctx.moveTo(40,py(0));ctx.lineTo(770,py(0));ctx.stroke();}
  ctx.strokeStyle='#17665d';ctx.lineWidth=2;ctx.beginPath();let previous=null;for(const point of points){if(!Number.isFinite(point.y)){previous=null;continue;}if(!previous||Math.abs(point.y-previous.y)>(ymax-ymin)*.6)ctx.moveTo(px(point.x),py(point.y));else ctx.lineTo(px(point.x),py(point.y));previous=point;}ctx.stroke();
  ctx.fillStyle='#192f33';ctx.font='13px system-ui';ctx.fillText(`x ${data.min} → ${data.max}`,45,407);ctx.fillText(`y ${ymin.toPrecision(4)} → ${ymax.toPrecision(4)}`,45,22);
  const details=node('details');details.append(node('summary','Sampled values (numerical approximation)'));const table=node('table');table.append(node('caption',`y = ${data.expression}`));const head=node('tr');head.append(node('th','x'),node('th','y'));table.append(head);for(let i=0;i<points.length;i+=20){const row=node('tr');row.append(node('td',points[i].x.toPrecision(5)),node('td',Number.isFinite(points[i].y)?points[i].y.toPrecision(5):'undefined'));table.append(row);}details.append(table);container.append(details);
}
export function renderArtifact(container, artifact) {
  const type=text(artifact.type);container.append(node('h3',artifact.title || type));
  let data;try{data=normalize(type,artifact.data);}catch(error){container.append(node('p',error.message,{class:'error',role:'alert'}));return;}
  if(type==='document')container.append(node('p',data.text,{class:'artifact-text'}));
  else if(type==='doodle'){const canvas=node('canvas',undefined,{width:800,height:450,role:'img','aria-label':'Saved drawing; structured shapes listed below.'});container.append(canvas);drawDoodle(canvas,data);container.append(node('p',`${data.strokes.length} freehand strokes. ${data.shapes.map(s=>`${s.type} ${s.text} at (${s.x}, ${s.y})`).join('; ')}`));}
  else if(type==='mindmap'){container.append(mindmapView(data));const labels=new Map(data.nodes.map(item=>[item.id,item.label])),ul=node('ul');data.nodes.forEach(item=>ul.append(node('li',`${item.label}${item.parentId?' — connected to '+(labels.get(item.parentId)||item.parentId):''}`)));container.append(ul);}
  else if(type==='flashcards'){data.cards.forEach(card=>{const detail=node('details');detail.append(node('summary',card.front),node('p',card.back));container.append(detail);});}
  else if(type==='presentation')data.slides.forEach(slide=>{const section=node('section',undefined,{class:'slide'});section.append(node('h2',slide.title),node('p',slide.body));container.append(section);});
  else if(type==='graph'){try{graphView(container,data);}catch(error){container.append(node('p',error.message,{class:'error'}));}}
  else if(type==='image'){const src=imageSource(data.mime,data.data);if(src)container.append(node('img',undefined,{src,alt:data.prompt || artifact.title}));}
  else if(type==='video'){const ul=node('ul');Object.entries(data.answers).forEach(([key,value])=>ul.append(node('li',`Question ${Number(key)+1}: ${text(value)}`)));container.append(ul,node('p',`${data.completed.length} checkpoints marked complete.`));}
  else container.append(node('pre',JSON.stringify(artifact.data,null,2)));
}
export function mountTools(container, options) {
  let participant=options.participant,run=options.run,active='',artifactId='',data={},dirty=false,destroyed=false,busy=false;
  const root=node('section',undefined,{class:'tool-panel','aria-label':'Classroom tools'});container.append(root);
  let workspace,status,titleInput,fieldset,savedChooser;
  const anytime=()=>list(run.space.tools).filter(type=>TYPES.includes(type));
  const enabled=()=>Array.from(new Set([...anytime(),...list(run.space.agenda).map(step=>object(step).tool).filter(type=>TYPES.includes(type))]));
  const tabs=node('div',undefined,{class:'tool-tabs'}),content=node('div');
  root.append(node('h2','Room to make'),node('p','Your teacher’s enabled tools. Save your work to keep it after reloading.',{class:'muted'}),tabs,content);
  for(const type of anytime()){const tab=button(type[0].toUpperCase()+type.slice(1),()=>switchArtifact(type,list(participant.artifacts).find(item=>item.type===type)));tab.dataset.tool=type;tabs.append(tab);}
  const canEdit=()=>run.status==='active'&&!participant.paused&&(!run.expiresAt||Date.parse(run.expiresAt)>Date.now());
  function fail(error){options.onError?.(error);if(status)status.textContent=error.message || String(error);}
  function changed(){dirty=true;if(status)status.textContent='Unsaved changes — save to keep this work.';}
  async function action(callback){if(busy)return;busy=true;if(fieldset)fieldset.disabled=true;try{await callback();}catch(error){fail(error);}finally{busy=false;if(fieldset&&!destroyed)fieldset.disabled=!canEdit();}}
  async function save(){await action(async()=>{
    if(!canEdit())throw new Error('This session is paused or closed. Your unsaved work remains in this tab.');
    if(active==='mindmap')checkMindmapSize(data.nodes);
    if(active==='graph')checkGraphExpression(data.expression);
    const result=await options.api('/api/student/artifacts',{...(artifactId?{id:artifactId}:{}),type:active,title:titleInput.value.trim() || active,data},'PUT');
    if(destroyed)return;
    artifactId=result.artifact.id;participant.artifacts=[...list(participant.artifacts).filter(item=>item.id!==artifactId),result.artifact];
    if(savedChooser){let option=Array.from(savedChooser.options).find(item=>item.value===artifactId);if(!option){option=node('option',result.artifact.title,{value:artifactId});savedChooser.append(option);}else option.textContent=result.artifact.title;savedChooser.value=artifactId;}
    dirty=false;status.textContent='Saved to your classroom.';options.onSaved?.(result.artifact);
  });}
  function switchArtifact(type,item){
    if(busy){if(savedChooser)savedChooser.value=artifactId;fail(new Error('Wait for the current tool request to finish before switching work.'));return false;}
    let next;try{next=normalize(type,item?.data);}catch(error){if(savedChooser)savedChooser.value=artifactId;fail(error);return false;}
    if(dirty&&!confirm('Leave this tool without saving your changes?')){if(savedChooser)savedChooser.value=artifactId;return false;}
    active=type;artifactId=item?.id||'';data=next;dirty=false;render();return true;
  }
  function render(){
    if(destroyed)return;content.replaceChildren();workspace=null;
    for(const tab of tabs.children)tab.setAttribute('aria-pressed',String(tab.dataset.tool===active));
    if(!enabled().length){content.append(node('p','Your teacher has not enabled any classroom tools.',{class:'empty'}));return;}
    if(!active||!enabled().includes(active)){content.append(node('p',anytime().length?'Choose an anytime tool above, or open the tool attached to an agenda step.':'Open a tool from your learning agenda.',{class:'hint'}));return;}
    workspace=node('div',undefined,{class:'tool-workspace stack'});content.append(workspace);
    const existing=list(participant.artifacts).filter(item=>item.type===active);const chooser=field('Saved work');const select=node('select');savedChooser=select;select.append(node('option','New '+active,{value:''}));existing.forEach(item=>select.append(node('option',item.title,{value:item.id})));select.value=artifactId;select.addEventListener('change',()=>switchArtifact(active,list(participant.artifacts).find(item=>item.id===select.value)));chooser.input.replaceWith(select);workspace.append(chooser.wrapper);
    const title=field('Work title',existing.find(item=>item.id===artifactId)?.title||`${active[0].toUpperCase()+active.slice(1)} notes`);titleInput=title.input;titleInput.addEventListener('input',changed);
    fieldset=node('fieldset',undefined,{class:'stack'});fieldset.append(node('legend',`Edit ${active}`),title.wrapper);workspace.append(fieldset);fieldset.disabled=!canEdit();
    status=node('p',canEdit()?'Save when you are ready.':'Read-only: this session is paused or closed.',{role:'status','aria-live':'polite'});
    if(['mindmap','flashcards','presentation'].includes(active)){
      const prompt=field('Ask AI to help create this work','','textarea');prompt.input.placeholder='Describe the idea or topic you want to explore.';fieldset.append(prompt.wrapper,button('Generate with AI',()=>action(async()=>{if(!prompt.input.value.trim())throw new Error('Describe what you want to generate.');status.textContent='Generating with the classroom model…';const result=await options.api('/api/student/tool',{type:active,prompt:prompt.input.value});data=normalize(active,result.data);changed();buildEditor();}), 'primary'));fieldset.append(node('p','AI output needs your review. Generation does not save until you choose Save work.',{class:'hint'}));
    }
    const editor=node('div',undefined,{class:'stack'});fieldset.append(editor);
    function buildEditor(){editor.replaceChildren();if(active==='document')documentEditor(editor);if(active==='doodle')doodleEditor(editor);if(active==='mindmap')mindmapEditor(editor);if(active==='flashcards')flashcardsEditor(editor);if(active==='presentation')presentationEditor(editor);if(active==='graph')graphEditor(editor);if(active==='video')videoEditor(editor);if(active==='image')imageEditor(editor);}
    buildEditor();fieldset.append(button('Save work',save,'primary'));workspace.append(status);
  }
  function documentEditor(editor){const body=field('Document',data.text,'textarea');body.input.rows=16;body.input.addEventListener('input',()=>{data.text=body.input.value;changed();});editor.append(body.wrapper);}
  function doodleEditor(editor){
    const canvas=node('canvas',undefined,{width:800,height:450,role:'img','aria-label':'Freehand drawing canvas. Use the shape and text controls below as a keyboard alternative.'});editor.append(canvas);drawDoodle(canvas,data);let stroke=null;
    function position(event){const rect=canvas.getBoundingClientRect();return {x:Math.round((event.clientX-rect.left)*800/rect.width),y:Math.round((event.clientY-rect.top)*450/rect.height)};}
    canvas.addEventListener('pointerdown',event=>{if(!canEdit())return;event.preventDefault();canvas.setPointerCapture(event.pointerId);stroke=[position(event)];data.strokes.push(stroke);changed();});canvas.addEventListener('pointermove',event=>{if(!stroke||!canEdit())return;stroke.push(position(event));drawDoodle(canvas,data);});for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>{stroke=null;});
    const controls=node('div',undefined,{class:'grid'});const kind=field('Shape type');const select=node('select');['rectangle','circle','text'].forEach(value=>select.append(node('option',value,{value})));kind.input.replaceWith(select);const x=field('X (0–800)',100,'number'),y=field('Y (0–450)',100,'number'),size=field('Size',80,'number'),label=field('Text label');controls.append(kind.wrapper,x.wrapper,y.wrapper,size.wrapper,label.wrapper);editor.append(controls);
    editor.append(button('Add shape or text',()=>{data.shapes.push({type:select.value,x:Math.max(0,Math.min(800,number(x.input.value))),y:Math.max(0,Math.min(450,number(y.input.value))),size:Math.max(1,Math.min(800,number(size.input.value,80))),text:label.input.value});drawDoodle(canvas,data);changed();}));
    const actions=node('div',undefined,{class:'actions'});actions.append(button('Undo last shape',()=>{data.shapes.pop();drawDoodle(canvas,data);changed();}),button('Undo last stroke',()=>{data.strokes.pop();drawDoodle(canvas,data);changed();}),button('Clear drawing',()=>{if(confirm('Clear this drawing? Save to persist the change.')){data={strokes:[],shapes:[]};drawDoodle(canvas,data);changed();}},'danger'));editor.append(actions);
  }
  function mindmapEditor(editor){
    checkMindmapSize(data.nodes);
    const view=node('div');editor.append(view);const rows=node('div',undefined,{class:'stack'});editor.append(rows);
    function redraw(){view.replaceChildren(mindmapView(data));}
    function rebuild(){rows.replaceChildren();data.nodes.forEach((item,index)=>{const row=node('div',undefined,{class:'panel stack'});const label=field(`Node ${index+1} label`,item.label);const parent=field(`Node ${index+1} connected to`);const select=node('select');select.append(node('option','Root / no parent',{value:''}));data.nodes.filter(other=>other.id!==item.id).forEach(other=>select.append(node('option',other.label||other.id,{value:other.id})));select.value=item.parentId;parent.input.replaceWith(select);label.input.addEventListener('input',()=>{item.label=label.input.value;redraw();changed();});select.addEventListener('change',()=>{item.parentId=select.value;redraw();changed();});row.append(label.wrapper,parent.wrapper,button('Remove node',()=>{data.nodes=data.nodes.filter(other=>other!==item);data.nodes.forEach(other=>{if(other.parentId===item.id)other.parentId='';});rebuild();redraw();changed();},'small danger'));rows.append(row);});}
    redraw();rebuild();editor.append(button('Add node',()=>{if(data.nodes.length>=MINDMAP_NODE_LIMIT){fail(new Error(`Mind maps support at most ${MINDMAP_NODE_LIMIT} nodes. Remove a node before adding another.`));return;}data.nodes.push({id:uid(),label:'New idea',parentId:data.nodes[0]?.id||''});rebuild();redraw();changed();}));
  }
  function flashcardsEditor(editor){
    const rows=node('div',undefined,{class:'stack'}),study=node('div',undefined,{class:'stack'});editor.append(rows,button('Add card',()=>{data.cards.push({front:'',back:''});rebuild();changed();}),node('h3','Study your cards'),study);let index=0,flipped=false;
    function rebuild(){rows.replaceChildren();data.cards.forEach((item,i)=>{const card=node('div',undefined,{class:'panel stack'}),front=field(`Card ${i+1}: front`,item.front,'textarea'),back=field(`Card ${i+1}: back`,item.back,'textarea');front.input.addEventListener('input',()=>{item.front=front.input.value;changed();show();});back.input.addEventListener('input',()=>{item.back=back.input.value;changed();show();});card.append(front.wrapper,back.wrapper,button('Remove card',()=>{data.cards.splice(i,1);index=0;rebuild();show();changed();},'small danger'));rows.append(card);});}
    function show(){study.replaceChildren();if(!data.cards.length){study.append(node('p','Add or generate cards to study.',{class:'empty'}));return;}index=Math.min(index,data.cards.length-1);study.append(node('p',`Card ${index+1} / ${data.cards.length}`),node('div',flipped?data.cards[index].back:data.cards[index].front,{class:'flashcard'}));const actions=node('div',undefined,{class:'actions'});actions.append(button('Flip card',()=>{flipped=!flipped;show();}),button('Previous',()=>{index=(index-1+data.cards.length)%data.cards.length;flipped=false;show();}),button('Next',()=>{index=(index+1)%data.cards.length;flipped=false;show();}),button('Matching practice',match));study.append(actions);}
    function match(){study.replaceChildren(node('h3','Match each front to its answer'));const indices=data.cards.map((_,i)=>i);for(let i=indices.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[indices[i],indices[j]]=[indices[j],indices[i]];}const selects=[];data.cards.forEach((card,i)=>{const wrapper=node('label',undefined,{class:'field'});wrapper.append(node('span',card.front));const select=node('select');select.append(node('option','Choose answer',{value:''}));indices.forEach(j=>select.append(node('option',data.cards[j].back,{value:j})));selects.push(select);wrapper.append(select);study.append(wrapper);});const result=node('p',undefined,{role:'status'});study.append(button('Check matches',()=>{const correct=selects.filter((select,i)=>select.value!==''&&Number(select.value)===i).length;result.textContent=`${correct} of ${data.cards.length} matched. Review your answers and try again.`;}),result,button('Return to cards',show));}
    rebuild();show();
  }
  function presentationEditor(editor){
    const rows=node('div',undefined,{class:'stack'}),preview=node('div',undefined,{class:'presentation-preview'});editor.append(rows);
    function redraw(){preview.replaceChildren();data.slides.forEach(slide=>{const section=node('section',undefined,{class:'slide'});section.append(node('h2',slide.title),node('p',slide.body));preview.append(section);});}
    function rebuild(){rows.replaceChildren();data.slides.forEach((slide,i)=>{const card=node('div',undefined,{class:'panel stack'}),title=field(`Slide ${i+1} title`,slide.title),body=field('Slide content',slide.body,'textarea');title.input.addEventListener('input',()=>{slide.title=title.input.value;changed();redraw();});body.input.addEventListener('input',()=>{slide.body=body.input.value;changed();redraw();});const actions=node('div',undefined,{class:'actions'});actions.append(button('Move up',()=>{if(i>0){[data.slides[i-1],data.slides[i]]=[data.slides[i],data.slides[i-1]];rebuild();redraw();changed();}}),button('Remove slide',()=>{data.slides.splice(i,1);rebuild();redraw();changed();},'danger'));card.append(title.wrapper,body.wrapper,actions);rows.append(card);});}
    editor.append(button('Add slide',()=>{data.slides.push({title:'New slide',body:''});rebuild();redraw();changed();}),button('Print presentation',()=>{const dialog=document.createElement('dialog');dialog.className='presentation-print';dialog.setAttribute('aria-label','Presentation print preview');dialog.append(button('Close preview',()=>{dialog.close();dialog.remove();},'no-print'),button('Print',()=>window.print(),'no-print'));data.slides.forEach(slide=>{const page=node('section',undefined,{class:'slide'});page.append(node('h2',slide.title),node('p',slide.body));dialog.append(page);});document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();}),preview);rebuild();redraw();
  }
  function graphEditor(editor){
    const expression=field('y = expression in x',data.expression),min=field('Minimum x',data.min,'number'),max=field('Maximum x',data.max,'number');expression.input.maxLength=GRAPH_EXPRESSION_LIMIT;editor.append(expression.wrapper,node('p',`Use at most ${GRAPH_EXPRESSION_LIMIT} characters: x, pi, e, arithmetic, powers, sin, cos, tan, sqrt, abs, log, exp, min or max. No executable code.`,{class:'hint'}));const bounds=node('div',undefined,{class:'grid two'});bounds.append(min.wrapper,max.wrapper);editor.append(bounds);const view=node('div');function plot(){data={expression:expression.input.value,min:number(min.input.value),max:number(max.input.value)};view.replaceChildren();try{graphView(view,data);}catch(error){view.append(node('p',error.message,{class:'error'}));}changed();}editor.append(button('Plot expression',plot),view);for(const input of [expression.input,min.input,max.input])input.addEventListener('input',()=>{data={expression:expression.input.value,min:number(min.input.value),max:number(max.input.value)};changed();});try{graphView(view,data);}catch(error){view.append(node('p',error.message,{class:'error'}));}
  }
  function videoEditor(editor){
    const id=youtubeId(run.space.videoUrl);if(!id){editor.append(node('p','No valid YouTube video has been configured by your teacher.',{class:'empty'}));return;}
    const frame=node('iframe',undefined,{title:'Teacher-selected classroom video',src:`https://www.youtube-nocookie.com/embed/${id}`,allow:'fullscreen',referrerpolicy:'strict-origin-when-cross-origin',allowfullscreen:''});editor.append(frame,node('p','YouTube is an external service. Use its caption controls when available. Checkpoints are student-reported, not AI-assessed.',{class:'hint'}));
    list(run.space.videoQuestions).forEach((item,index)=>{const section=node('section',undefined,{class:'panel stack'}),seconds=Math.max(0,Math.floor(number(item.time))),answer=field(item.question,text(data.answers[index]),'textarea'),check=node('label',undefined,{class:'check-label'}),input=node('input',undefined,{type:'checkbox'});input.checked=data.completed.includes(index);input.addEventListener('change',()=>{data.completed=data.completed.filter(value=>value!==index);if(input.checked)data.completed.push(index);changed();});check.append(input,node('span','I completed this checkpoint'));answer.input.addEventListener('input',()=>{data.answers[index]=answer.input.value;changed();});section.append(button(`Watch at ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,()=>{frame.src=`https://www.youtube-nocookie.com/embed/${id}?start=${seconds}`;}),answer.wrapper,check);editor.append(section);});
  }
  function imageEditor(editor){const prompt=field('Image prompt',data.prompt,'textarea'),view=node('div');editor.append(prompt.wrapper,button('Generate image',()=>action(async()=>{if(!prompt.input.value.trim())throw new Error('Describe an image to generate.');status.textContent='Requesting an image from the configured provider…';const result=await options.api('/api/student/image',{prompt:prompt.input.value});if(!imageSource(result.mime,result.data))throw new Error('The provider returned an unsupported image.');data={mime:result.mime,data:result.data,prompt:prompt.input.value};view.replaceChildren(node('img',undefined,{src:imageSource(data.mime,data.data),alt:data.prompt}));changed();}),'primary'),node('p','Generation uses the classroom’s image model. Unsupported providers or missing image models return an error, not a substitute image.',{class:'hint'}),view);prompt.input.addEventListener('input',()=>{data.prompt=prompt.input.value;changed();});if(imageSource(data.mime,data.data))view.append(node('img',undefined,{src:imageSource(data.mime,data.data),alt:data.prompt}));}
  render();
  return {
    open(type){if(!enabled().includes(type)){fail(new Error('Your teacher has not enabled this tool.'));return;}if(switchArtifact(type,list(participant.artifacts).find(item=>item.type===type)))workspace?.querySelector('input')?.focus({preventScroll:true});},
    update(nextParticipant,nextRun){participant=nextParticipant;run=nextRun;if(fieldset)fieldset.disabled=busy||!canEdit();if(!enabled().includes(active)&&active){active='';dirty=false;render();}if(status&&!dirty&&!busy)status.textContent=canEdit()?'Save when you are ready.':'Read-only: this session is paused or closed.';},
    destroy(){destroyed=true;root.remove();},
    hasUnsavedChanges(){return dirty;}
  };
}
