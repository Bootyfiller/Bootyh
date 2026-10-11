import { supabase } from './supabase-client.js';

const STORAGE_KEY = 'polished-business-v1';
const SETUP_KEY = 'polished-setup-complete-v1';
const LEGACY_OWNER_KEY = 'polished-local-owner-v1';
const THEME_COLOR_KEY = 'polished-theme-color-v1';
const SAVED_COLOR_PALETTES_KEY = 'polished-saved-colors-v1';
const DEFAULT_THEME_COLOR = '#ad7185';
const DEFAULT_SECONDARY_COLOR = '#e8c8bd';
const COLOR_PALETTES = [
  {name:'Rose (default)',primary:'#ad7185',secondary:'#e8c8bd'},
  {name:'Berry',primary:'#8b4f6d',secondary:'#e7c5d2'},
  {name:'Coral',primary:'#b96c5a',secondary:'#f0d1bd'},
  {name:'Terracotta',primary:'#a85f4d',secondary:'#edd1bd'},
  {name:'Amber',primary:'#a47732',secondary:'#edddb4'},
  {name:'Olive',primary:'#75804e',secondary:'#e0e2bc'},
  {name:'Sage',primary:'#668773',secondary:'#d4e2d2'},
  {name:'Mint',primary:'#4f897d',secondary:'#cce5d8'},
  {name:'Teal',primary:'#3d817e',secondary:'#c5e3df'},
  {name:'Ocean',primary:'#517f95',secondary:'#d3e5e9'},
  {name:'Sky',primary:'#4d80b0',secondary:'#d2e1f2'},
  {name:'Blue',primary:'#526caa',secondary:'#d4dcf4'},
  {name:'Periwinkle',primary:'#776caf',secondary:'#dfdaf4'},
  {name:'Lavender',primary:'#806b9b',secondary:'#ded6eb'},
  {name:'Plum',primary:'#795b83',secondary:'#e7d4eb'},
  {name:'Slate',primary:'#596d80',secondary:'#dbe3e7'}
];
const blankState = () => ({ services: [], extras: [], inventory: [], calculations: [], appointments: [], goal: { targetProfit: 0 } });
let activeUser = null;
let cloudReady = false;
let cloudSyncUnavailable = false;
let cloudSyncTimer = null;
let cloudSyncChain = Promise.resolve();
let cloudSyncErrorShown = false;
let realtimeChannel = null;
let state = blankState();
let setupComplete = false;
let page = 'setup';
let setupStep = 0;
let setupIntrosSeen = { inventory: false, service: false, extra: false, consumable: false };
let themeColors={primary:DEFAULT_THEME_COLOR,secondary:DEFAULT_SECONDARY_COLOR};
try{const saved=JSON.parse(localStorage.getItem(THEME_COLOR_KEY));if(/^#[\da-f]{6}$/i.test(saved?.primary||''))themeColors.primary=saved.primary;if(/^#[\da-f]{6}$/i.test(saved?.secondary||''))themeColors.secondary=saved.secondary}catch{}
let savedColorPalettes=[];
try{const saved=JSON.parse(localStorage.getItem(SAVED_COLOR_PALETTES_KEY)||'[]');if(Array.isArray(saved))savedColorPalettes=saved.filter(item=>/^#[\da-f]{6}$/i.test(item?.primary||'')&&/^#[\da-f]{6}$/i.test(item?.secondary||'')).map((item,index)=>({...item,name:String(item.name||`Saved ${index+1}`).slice(0,32)}))}catch{}
let wheelTarget='primary';
let catalogTab = 'services';
let calc = { serviceId: '', additionalServiceIds: [], price: '', time: '', unit: 'Minutes', material: '', client: '', extras: [], consumableUsage: {}, adjustmentType: 'add', adjustmentAmount: '', adjustmentOpen: false, discountPercent: 0, discountReason: '', discountsOpen: false, gstPercent: 0, gstOpen: false, taxPercent: 0, taxOpen: false, feesOpen: false, customService: false, customName: '', customNotes: '', inputsOpen: true, breakdownOpen: false };
let calendar = { mode: 'week', date: new Date(), startDate: new Date() };
let modalReturnFocus = null;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function hslHex(hue,saturation,lightness){const s=saturation/100,l=lightness/100,c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((hue/60)%2-1)),m=l-c/2;const [r,g,b]=hue<60?[c,x,0]:hue<120?[x,c,0]:hue<180?[0,c,x]:hue<240?[0,x,c]:hue<300?[x,0,c]:[c,0,x];return '#'+[r,g,b].map(value=>Math.round((value+m)*255).toString(16).padStart(2,'0')).join('')}
function mixHex(color,base,ratio){const a=color.match(/[\da-f]{2}/gi).map(n=>parseInt(n,16)),b=base.match(/[\da-f]{2}/gi).map(n=>parseInt(n,16));return '#'+a.map((value,index)=>Math.round(value*(1-ratio)+b[index]*ratio).toString(16).padStart(2,'0')).join('')}
function contrastText(hex){const channels=hex.match(/[\da-f]{2}/gi).map(value=>parseInt(value,16)/255),luminance=channels.map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);return luminance>.179?'#111111':'#fffaf6'}
function hexToHsl(hex){const [r,g,b]=hex.match(/[\da-f]{2}/gi).map(value=>parseInt(value,16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,l=(max+min)/2;let h=0,s=0;if(delta){s=delta/(1-Math.abs(2*l-1));if(max===r)h=60*(((g-b)/delta)%6);else if(max===g)h=60*((b-r)/delta+2);else h=60*((r-g)/delta+4);if(h<0)h+=360}return {h,s:s*100,l:l*100}}
function applyThemeColors(primary,secondary){
  if(!/^#[\da-f]{6}$/i.test(primary||''))primary=DEFAULT_THEME_COLOR;
  if(!/^#[\da-f]{6}$/i.test(secondary||''))secondary=DEFAULT_SECONDARY_COLOR;
  const root=document.documentElement,accentDark=mixHex(primary,'#000000',.52),accentSoft=mixHex(primary,'#fffaf6',.82),secondaryDark=mixHex(secondary,'#292522',.52),secondarySoft=mixHex(secondary,'#fffefa',.78),secondaryLine=mixHex(secondary,'#e8e1da',.58),paper=mixHex(secondary,'#f7f0ed',.9),paperDeep=mixHex(secondary,'#eee2df',.84),line=mixHex(secondary,'#e8e1da',.75);
  const secondaryContrast=contrastText(secondary),secondaryControlBg=secondaryContrast==='#111111'?mixHex(secondary,'#fffaf6',.24):mixHex(secondary,'#171317',.64),secondaryControlContrast=contrastText(secondaryControlBg);
  const vars={'--accent':primary,'--accent-dark':accentDark,'--accent-soft':accentSoft,'--secondary-color':secondary,'--secondary-dark':secondaryDark,'--secondary-soft':secondarySoft,'--secondary-line':secondaryLine,'--paper':paper,'--paper-deep':paperDeep,'--line':line,'--accent-color':primary,'--accent-strong':accentDark,'--accent-contrast':contrastText(primary),'--secondary-strong':secondaryDark,'--secondary-contrast':secondaryContrast,'--theme-secondary-strong':secondaryDark,'--theme-secondary-color':secondary,'--theme-secondary-soft':secondarySoft,'--theme-secondary-contrast':secondaryContrast,'--secondary-control-bg':secondaryControlBg,'--secondary-control-contrast':secondaryControlContrast,'--app-bg':paper,'--surface-soft':paperDeep,'--border-color':line};
  for(const [name,value] of Object.entries(vars))root.style.setProperty(name,value);
}
function updateThemeControls(){
  const wheel=$('.colour-wheel');
  $$('[data-color-preset]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.primary===themeColors.primary&&button.dataset.secondary===themeColors.secondary)));
  const primary=$('#theme-primary-value'),secondary=$('#theme-secondary-value');if(primary)primary.textContent=themeColors.primary.toUpperCase();if(secondary)secondary.textContent=themeColors.secondary.toUpperCase();
  const pSwatch=$('#theme-primary-swatch'),sSwatch=$('#theme-secondary-swatch');if(pSwatch)pSwatch.style.setProperty('--swatch-color',themeColors.primary);if(sSwatch)sSwatch.style.setProperty('--swatch-color',themeColors.secondary);
  if(wheel){const color=themeColors[wheelTarget],{h,s}=hexToHsl(color),angle=(h-90)*Math.PI/180,radius=s*.5;wheel.style.setProperty('--marker-x',`${50+Math.cos(angle)*radius}%`);wheel.style.setProperty('--marker-y',`${50+Math.sin(angle)*radius}%`);wheel.style.setProperty('--wheel-marker-color',color);wheel.setAttribute('aria-label',`Colour wheel for ${wheelTarget} colour. Click or drag to change it; use arrow keys to change hue and Shift plus arrow keys to change saturation`);$('#wheel-target-label').textContent=wheelTarget==='primary'?'Primary colour':'Secondary colour'}
  $$('.theme-color-control').forEach(button=>{const active=button.dataset.wheelTarget===wheelTarget;button.classList.toggle('is-wheel-target',active);button.setAttribute('aria-pressed',String(active))});
}
function setThemeColors(primary,secondary){themeColors={primary,secondary};applyThemeColors(primary,secondary);updateThemeControls();try{localStorage.setItem(THEME_COLOR_KEY,JSON.stringify(themeColors))}catch(error){console.error('Could not save app colours.',error)}}
applyThemeColors(themeColors.primary,themeColors.secondary);
function userStorageKey(key){return activeUser?key+':'+activeUser.id:key}
function loadState(storageKey=STORAGE_KEY){try{const value=JSON.parse(localStorage.getItem(storageKey));if(!value||!Array.isArray(value.services))return blankState();const migrated={...blankState(),...value,goal:value.goal||{targetProfit:0},services:Array.isArray(value.services)?value.services:[],extras:Array.isArray(value.extras)?value.extras:[],inventory:Array.isArray(value.inventory)?value.inventory:[],calculations:Array.isArray(value.calculations)?value.calculations:[],appointments:Array.isArray(value.appointments)?value.appointments:[]};const known=new Set(migrated.extras.map(extra=>extra.id));for(const service of migrated.services){for(const extra of service.extras||[]){if(!known.has(extra.id)){migrated.extras.push({...extra,serviceId:undefined});known.add(extra.id)}}}return migrated}catch{return blankState()}}
function save(){
  try{localStorage.setItem(userStorageKey(STORAGE_KEY),JSON.stringify(state))}catch(error){console.error('Could not save Polished data.',error);toast('Your browser could not save this change. Free up storage and try again.');return false}
  if(cloudReady&&!cloudSyncUnavailable)queueCloudSync();
  return true;
}
function cacheLegacyStateForUser(userId){
  const scopedKey=STORAGE_KEY+':'+userId;
  if(localStorage.getItem(scopedKey)!==null)return;
  const legacyOwner=localStorage.getItem(LEGACY_OWNER_KEY);
  if(legacyOwner&&legacyOwner!==userId)return;
  const legacy=localStorage.getItem(STORAGE_KEY);
  if(legacy===null)return;
  localStorage.setItem(scopedKey,legacy);
  const legacySetup=localStorage.getItem(SETUP_KEY);
  if(legacySetup!==null)localStorage.setItem(SETUP_KEY+':'+userId,legacySetup);
  localStorage.setItem(LEGACY_OWNER_KEY,userId);
}
function appointmentToCloudRow(appointment){
  const date=String(appointment.date||localDate());
  return {id:appointment.id,user_id:activeUser.id,client_name:appointment.clientName||'',service_name:appointment.serviceNameSnapshot||'',appointment_date:/^\d{4}-\d{2}-\d{2}$/.test(date)?date:localDate(),price:Number(appointment.price)||0,status:appointment.status||'scheduled',notes:appointment.notes||'',details:appointment,updated_at:new Date().toISOString()};
}
function appointmentFromCloudRow(row){
  const details=row.details&&typeof row.details==='object'?row.details:{};
  const rawDate=String(row.appointment_date||''),dateValue=new Date(row.appointment_date),fallbackDate=/^\d{4}-\d{2}-\d{2}/.test(rawDate)?rawDate.slice(0,10):Number.isNaN(dateValue.getTime())?'':[dateValue.getFullYear(),String(dateValue.getMonth()+1).padStart(2,'0'),String(dateValue.getDate()).padStart(2,'0')].join('-');
  const fallbackTime=Number.isNaN(dateValue.getTime())?'09:00':[String(dateValue.getHours()).padStart(2,'0'),String(dateValue.getMinutes()).padStart(2,'0')].join(':');
  return {...details,id:String(row.id),clientName:row.client_name||'',serviceNameSnapshot:row.service_name||'',date:details.date||fallbackDate,time:details.time||fallbackTime,price:Number(row.price)||0,status:row.status||'scheduled',notes:row.notes||''};
}
function useableToCloudRow(item){return {id:item.id,user_id:activeUser.id,item_name:item.name,measurement_unit:item.unit,units_in_stock:Number(item.quantity)||0,cost_per_unit:Number(item.unitCost)||0,low_stock_threshold:Number(item.lowStockThreshold??2),purchase_link:item.purchaseUrl||null,notes:item.notes||'',updated_at:new Date().toISOString()}}
function useableFromCloudRow(row){return {id:String(row.id),name:row.item_name||'',unit:row.measurement_unit||'pcs',quantity:Number(row.units_in_stock)||0,unitCost:Number(row.cost_per_unit)||0,lowStockThreshold:Number(row.low_stock_threshold??2),purchaseUrl:row.purchase_link||'',notes:row.notes||'',category:'useable'}}
function mergeAppointmentUseables(rows){
  const byAppointment=new Map();
  for(const row of rows||[]){const list=byAppointment.get(String(row.appointment_id))||[];list.push({itemId:String(row.useable_id),quantity:Number(row.quantity_used)||0,costAtTime:Number(row.cost_at_time)||0});byAppointment.set(String(row.appointment_id),list)}
  for(const appointment of state.appointments){
    const uses=byAppointment.get(String(appointment.id));
    if(!uses?.length)continue;
    const supplyUses=(appointment.inventoryUsageSnapshot||[]).filter(use=>state.inventory.find(item=>item.id===use.itemId)?.category!=='useable');
    appointment.inventoryUsageSnapshot=[...supplyUses,...uses];
  }
}
function appointmentUseableRows(){
  const rows=[];
  for(const appointment of state.appointments){
    if(appointment.status!=='completed')continue;
    for(const usage of appointment.inventoryUsageSnapshot||[]){
      const item=state.inventory.find(entry=>entry.id===usage.itemId);
      if(!item||item.category!=='useable'||Number(usage.quantity)<=0)continue;
      rows.push({user_id:activeUser.id,appointment_id:appointment.id,useable_id:item.id,quantity_used:Number(usage.quantity),cost_at_time:Number(usage.costAtTime??item.unitCost)||0});
    }
  }
  return rows;
}
async function replaceCloudRows(table,rows){
  const userId=activeUser.id;
  const {data:existing,error:readError}=await supabase.from(table).select('id').eq('user_id',userId);
  if(readError)throw readError;
  if(rows.length){const {error}=await supabase.from(table).upsert(rows,{onConflict:'id'});if(error)throw error}
  const retained=new Set(rows.map(row=>String(row.id)));
  const stale=(existing||[]).map(row=>String(row.id)).filter(id=>!retained.has(id));
  if(stale.length){const {error}=await supabase.from(table).delete().eq('user_id',userId).in('id',stale);if(error)throw error}
}
async function syncCloudState(){
  if(!activeUser)throw new Error('No authenticated Supabase user is active.');
  const appointments=state.appointments.map(appointmentToCloudRow);
  const useables=state.inventory.filter(item=>item.category==='useable').map(useableToCloudRow);
  await replaceCloudRows('appointments',appointments);
  await replaceCloudRows('useables',useables);
  const links=appointmentUseableRows();
  if(links.length){const {error}=await supabase.from('appointment_useables').upsert(links,{onConflict:'appointment_id,useable_id'});if(error)throw error}
  const {data:oldLinks,error:linkReadError}=await supabase.from('appointment_useables').select('appointment_id,useable_id').eq('user_id',activeUser.id);
  if(linkReadError)throw linkReadError;
  const retainedLinks=new Set(links.map(row=>row.appointment_id+'|'+row.useable_id));
  for(const link of oldLinks||[]){if(!retainedLinks.has(link.appointment_id+'|'+link.useable_id)){const {error}=await supabase.from('appointment_useables').delete().eq('user_id',activeUser.id).eq('appointment_id',link.appointment_id).eq('useable_id',link.useable_id);if(error)throw error}}
  const settings={user_id:activeUser.id,profit_goal:Number(state.goal?.targetProfit)||0,setup_complete:Boolean(setupComplete),updated_at:new Date().toISOString()};
  const {error:settingsError}=await supabase.from('user_settings').upsert(settings,{onConflict:'user_id'});
  if(settingsError)throw settingsError;
}
function queueCloudSync(){
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(()=>{cloudSyncChain=cloudSyncChain.then(syncCloudState).catch(error=>{console.error('Supabase sync failed.',error);if(!cloudSyncErrorShown){cloudSyncUnavailable=true;cloudSyncErrorShown=true;toast('Cloud sync failed. Check the Supabase schema and row-level security setup.',6000,'error')}})},350);
}
async function refreshCloudSnapshot(){
  if(!activeUser||!cloudReady)return;
  const [appointmentResult,useableResult,usageResult,settingsResult]=await Promise.all([
    supabase.from('appointments').select('*').eq('user_id',activeUser.id),
    supabase.from('useables').select('*').eq('user_id',activeUser.id),
    supabase.from('appointment_useables').select('*').eq('user_id',activeUser.id),
    supabase.from('user_settings').select('profit_goal,setup_complete').eq('user_id',activeUser.id).maybeSingle(),
  ]);
  for(const result of [appointmentResult,useableResult,usageResult,settingsResult])if(result.error)throw result.error;
  const before=JSON.stringify({appointments:state.appointments,useables:state.inventory.filter(item=>item.category==='useable'),goal:state.goal,setupComplete});
  state.appointments=(appointmentResult.data||[]).map(appointmentFromCloudRow);
  state.inventory=[...state.inventory.filter(item=>item.category!=='useable'),...(useableResult.data||[]).map(useableFromCloudRow)];
  mergeAppointmentUseables(usageResult.data||[]);
  if(settingsResult.data){state.goal={targetProfit:Number(settingsResult.data.profit_goal)||0};setupComplete=Boolean(settingsResult.data.setup_complete)}
  const after=JSON.stringify({appointments:state.appointments,useables:state.inventory.filter(item=>item.category==='useable'),goal:state.goal,setupComplete});
  localStorage.setItem(userStorageKey(STORAGE_KEY),JSON.stringify(state));
  localStorage.setItem(userStorageKey(SETUP_KEY),String(setupComplete));
  if(before!==after)render();
}
function subscribeToCloudChanges(){
  if(!activeUser)return;
  const filter='user_id=eq.'+activeUser.id;
  realtimeChannel=supabase.channel('polished-user-'+activeUser.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'appointments',filter},scheduleCloudRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'useables',filter},scheduleCloudRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'appointment_useables',filter},scheduleCloudRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'user_settings',filter},scheduleCloudRefresh)
    .subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Supabase Realtime is unavailable. Check the project publication settings.')});
}
let cloudRefreshTimer=null;
function scheduleCloudRefresh(){
  clearTimeout(cloudRefreshTimer);
  cloudRefreshTimer=setTimeout(()=>{
    cloudSyncChain=cloudSyncChain.then(refreshCloudSnapshot).catch(error=>console.error('Could not refresh Supabase data.',error));
  },300);
}
async function initializeSupabaseApp(){
  const {data,error}=await supabase.auth.getSession();
  if(error)console.error('Could not restore Supabase session.',error);
  if(!data?.session?.user){location.replace('index.html#login');return}
  activeUser=data.session.user;
  localStorage.removeItem('polished-account-v1');localStorage.removeItem('app_unlocked');
  cacheLegacyStateForUser(activeUser.id);
  state=loadState(userStorageKey(STORAGE_KEY));
  const storedSetup=localStorage.getItem(userStorageKey(SETUP_KEY));setupComplete=storedSetup==='true'||(storedSetup===null&&localStorage.getItem(userStorageKey(STORAGE_KEY))!==null);
  page=setupComplete?'schedule':'setup';
  try{
    const [appointmentResult,useableResult,usageResult,settingsResult]=await Promise.all([
      supabase.from('appointments').select('*').eq('user_id',activeUser.id),
      supabase.from('useables').select('*').eq('user_id',activeUser.id),
      supabase.from('appointment_useables').select('*').eq('user_id',activeUser.id),
      supabase.from('user_settings').select('profit_goal,setup_complete').eq('user_id',activeUser.id).maybeSingle(),
    ]);
    for(const result of [appointmentResult,useableResult,usageResult,settingsResult])if(result.error)throw result.error;
    const remoteAppointments=appointmentResult.data||[],remoteUseables=useableResult.data||[],remoteUsage=usageResult.data||[],settings=settingsResult.data;
    if(settings||remoteAppointments.length||remoteUseables.length){
      state.appointments=remoteAppointments.map(appointmentFromCloudRow);
      state.inventory=[...state.inventory.filter(item=>item.category!=='useable'),...remoteUseables.map(useableFromCloudRow)];
      mergeAppointmentUseables(remoteUsage);
      if(settings){state.goal={targetProfit:Number(settings.profit_goal)||0};setupComplete=Boolean(settings.setup_complete);page=setupComplete?'schedule':'setup';}
    }
    cloudReady=true;
    await syncCloudState();
    localStorage.setItem(userStorageKey(STORAGE_KEY),JSON.stringify(state));
    localStorage.setItem(userStorageKey(SETUP_KEY),String(setupComplete));
  }catch(error){
    cloudSyncUnavailable=true;
    console.error('Supabase data setup failed.',error);
  }
  document.body.classList.add('app-unlocked');
  document.body.classList.remove('app-initializing');
  supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){if(realtimeChannel)supabase.removeChannel(realtimeChannel);location.replace('index.html#login')}});
  subscribeToCloudChanges();
  ensureCompletedAppointmentsLogged();
  render();
  if(cloudSyncUnavailable)toast('Cloud tables are not ready yet. Run supabase-schema.sql in your Supabase SQL Editor.',8000,'error');
  processIncomingBackup();
  if(new URLSearchParams(location.search).has('password-reset'))openPasswordRecovery();
}
function id(){ return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function money(v){ return Number.isFinite(Number(v)) ? '$'+Number(v).toFixed(2) : '$0.00'; }
function num(v){ if(v === '' || v === null || v === undefined) return null; const n=Number(v); return Number.isFinite(n) ? n : null; }
function localDate(d=new Date()){ const x=new Date(d.getTime()-d.getTimezoneOffset()*60000); return x.toISOString().slice(0,10); }
function dateFromISO(value){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(year,month-1,day,12);return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date:null}
function fmtDate(v, options={month:'short',day:'numeric',year:'numeric'}){ const d=new Date(`${v}T12:00:00`); return Number.isNaN(d.getTime())?'—':d.toLocaleDateString(undefined,options); }
function timeMins(value,unit){ const n=num(value); return n===null?null:n*(unit==='Hours'?60:1); }
function selectedService(){return state.services.find(s=>s.id===calc.serviceId)}
function durationInputParts(minutes){const value=Number(minutes)||0;return value>=60&&value%60===0?{value:value/60,unit:'Hours'}:{value,unit:'Minutes'}}
function inventoryUsageCost(usages=[]){return usages.reduce((sum,use)=>{const item=state.inventory.find(entry=>entry.id===use.itemId);return sum+(Number(item?.unitCost)||0)*(Number(use.quantity)||0)},0)}
function currentValues(){
  const s=selectedService()||null;
  const additionalServices=(calc.additionalServiceIds||[]).map(serviceId=>state.services.find(service=>service.id===serviceId)).filter(Boolean);
  const services=[s,...additionalServices].filter(Boolean);
  const extras=state.extras.filter(e=>calc.extras.includes(e.id));
  const p=num(calc.price), t=timeMins(calc.time,calc.unit);
  const manual=!s&&(calc.customService||p!==null||t!==null);
  const servicePrice=(s?(p===null?Number(s.defaultPrice)||0:p):(p||0))+additionalServices.reduce((sum,service)=>sum+(Number(service.defaultPrice)||0),0);
  const serviceTime=(s?(t===null?Number(s.defaultDurationMinutes)||0:t):(t||0))+additionalServices.reduce((sum,service)=>sum+(Number(service.defaultDurationMinutes)||0),0);
  const extrasPrice=extras.reduce((a,e)=>a+(Number(e.price)||0),0);
  const extrasTime=extras.reduce((a,e)=>a+(Number(e.durationMinutes)||0),0);
  const inventoryUsage=[...services.flatMap(service=>service.inventoryUsage||[]),...extras.flatMap(e=>e.inventoryUsage||[])].filter(use=>state.inventory.find(item=>item.id===use.itemId)?.category!=='consumable');
  const consumables=state.inventory.filter(item=>item.category==='consumable').map(item=>({item,itemId:item.id,quantity:Math.max(0,Number(calc.consumableUsage?.[item.id])||0)})).filter(use=>use.quantity>0);
  const inventoryMaterial=inventoryUsageCost([...inventoryUsage,...consumables]);
  const supplyMaterial=inventoryUsageCost(inventoryUsage);
  const customMaterialCost=calc.customService?(num(calc.material)||0):0;
  const materialCost=inventoryMaterial+customMaterialCost;
  const basePrice=servicePrice+extrasPrice;
  const amount=num(calc.adjustmentAmount);
  const adjustment=amount!==null&&amount>0?(calc.adjustmentType==='deduct'?-amount:amount):0;
  const preDiscountPrice=basePrice+adjustment;
  const discountPercent=Math.max(0,Math.min(100,Number(calc.discountPercent)||0));
  const discountAmount=preDiscountPrice>0?Math.round((preDiscountPrice*discountPercent/100+Number.EPSILON)*100)/100:0;
  const gstBase=Math.max(0,preDiscountPrice-discountAmount);
  const gstPercent=Math.max(0,Math.min(100,Number(calc.gstPercent)||0));
  const gstAmount=gstBase>0?Math.round((gstBase*gstPercent/100+Number.EPSILON)*100)/100:0;
  const afterGst=gstBase+gstAmount;
  const taxPercent=Math.max(0,Math.min(100,Number(calc.taxPercent)||0));
  const taxAmount=afterGst>0?Math.round((afterGst*taxPercent/100+Number.EPSILON)*100)/100:0;
  const price=afterGst+taxAmount, minutes=serviceTime+extrasTime;
  const profit=gstBase-materialCost, perHour=minutes>0?profit/(minutes/60):0, margin=gstBase>0?(profit/gstBase)*100:0;
  return s||additionalServices.length||extras.length||manual?{s,services,manual,extras,servicePrice,serviceTime,extrasPrice,extrasTime,inventoryUsage,consumables,supplyMaterial,inventoryMaterial,customMaterialCost,materialCost,basePrice,adjustment,adjustmentAmount:Math.abs(adjustment),preDiscountPrice,discountPercent,discountAmount,gstBase,gstPercent,gstAmount,taxPercent,taxAmount,price,minutes,profit,perHour,margin}:null;
}
function updateDiscountPreview(){
  const values=currentValues(),gstPreview=$('#gst-amount-preview'),taxPreview=$('#tax-amount-preview'),discountPreview=$('#discount-amount-preview');
  if(gstPreview)gstPreview.textContent=values?.gstPercent?`${money(values.gstAmount)} GST added`:'No GST applied.';
  if(taxPreview)taxPreview.textContent=values?.taxPercent?`${money(values.taxAmount)} tax added`:'No tax applied.';
  if(discountPreview)discountPreview.textContent=values?.discountPercent?`${money(values.discountAmount)} off the price`:'No discount applied.';
}
function render(){
  $$('.nav-item').forEach(b=>{const active=b.dataset.page===page;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  $('.app-shell').classList.toggle('setup-mode',page==='setup');
  const root=$('#main');
  if(page==='setup') root.innerHTML=renderSetup();
  if(page==='studio') root.innerHTML=renderCalculator();
  if(page==='schedule') root.innerHTML=renderSchedule();
  if(page==='catalog') root.innerHTML=renderCatalog();
  if(page==='settings') root.innerHTML=renderSettings();
  if(page==='studio') enhanceStudioResults(root);
  bindPage();
}
function enhanceStudioResults(root=$('#main')){
  const card=root?.querySelector('.results-card');if(!card)return;
  const label=card.querySelector('.profit-label'),hero=card.querySelector('.profit-hero');if(!label||!hero)return;
  let topline=card.querySelector('.result-topline');
  if(!topline){topline=document.createElement('div');topline.className='result-topline';const summary=label.closest('.profit-summary');if(summary){card.insertBefore(topline,summary.closest('.result-pair'))}else{const profit=document.createElement('div');label.parentNode.insertBefore(topline,label);topline.append(profit);profit.append(label,hero)}}
  let priceBox=card.querySelector('.result-pair .client-price');
  if(!priceBox){priceBox=document.createElement('div');priceBox.className='mini-result client-price';card.querySelector('.result-pair')?.prepend(priceBox)}
  const values=currentValues(),valid=hero.textContent.trim()!=='—';
  priceBox.innerHTML=`<span>CLIENT PRICE</span><strong>${values&&valid?money(values.price):'—'}</strong>${values&&valid&&values.discountPercent?`<small>−${money(values.discountAmount)} · ${values.discountPercent}% discount</small>`:''}${values&&valid&&values.gstPercent?`<small>+${money(values.gstAmount)} · ${values.gstPercent}% GST</small>`:''}${values&&valid&&values.taxPercent?`<small>+${money(values.taxAmount)} · ${values.taxPercent}% tax</small>`:''}`;
  const breakdown=card.querySelector('.result-breakdown'),firstRow=breakdown?.querySelector('.breakdown-row');
  if(breakdown&&firstRow&&values&&valid){
    const firstLabel=firstRow.querySelector('span'),firstValue=firstRow.querySelector('strong');
    if(values.discountPercent||values.gstPercent||values.taxPercent){
      firstLabel.textContent=`Price before ${values.discountPercent?'discount':values.gstPercent?'GST':'tax'}`;firstValue.textContent=money(values.preDiscountPrice);
      const adjustmentRows=[];
      if(values.discountPercent){const row=document.createElement('div');row.className='breakdown-row';const label=document.createElement('span');label.textContent=`Discount (${values.discountPercent}%)${calc.discountReason?` · ${calc.discountReason}`:''}`;const value=document.createElement('strong');value.textContent=`−${money(values.discountAmount)}`;row.append(label,value);adjustmentRows.push(row)}
      if(values.gstPercent){const row=document.createElement('div');row.className='breakdown-row';const label=document.createElement('span');label.textContent=`GST (${values.gstPercent}%)`;const value=document.createElement('strong');value.textContent=`+${money(values.gstAmount)}`;row.append(label,value);adjustmentRows.push(row)}
      if(values.taxPercent){const row=document.createElement('div');row.className='breakdown-row';const label=document.createElement('span');label.textContent=`Tax (${values.taxPercent}%)`;const value=document.createElement('strong');value.textContent=`+${money(values.taxAmount)}`;row.append(label,value);adjustmentRows.push(row)}
      const clientRow=document.createElement('div');clientRow.className='breakdown-row total';clientRow.innerHTML=`<span>Client price</span><strong>${money(values.price)}</strong>`;
      firstRow.after(...adjustmentRows,clientRow);
    }else{firstLabel.textContent='Client price';firstValue.textContent=money(values.price)}
  }
}
function renderThemeSettings(){
  const palettes=[...COLOR_PALETTES,...savedColorPalettes];
  return `<details class="theme-settings card" aria-label="App colours"><summary class="theme-settings-heading"><h2>App colours</h2><span class="theme-settings-arrow" aria-hidden="true">⌄</span></summary><div class="theme-settings-content"><p class="theme-settings-description">Choose a palette or customise both colours.</p>
    <div class="palette-swatches" aria-label="Colour palettes">${palettes.map((palette,index)=>`<div class="palette-item"><button class="palette-chip" type="button" data-color-preset data-primary="${palette.primary}" data-secondary="${palette.secondary}" aria-label="Use ${esc(palette.name)} palette" aria-pressed="${palette.primary===themeColors.primary&&palette.secondary===themeColors.secondary}"><span class="palette-dots"><i style="--swatch:${palette.primary}"></i><i style="--swatch:${palette.secondary}"></i></span><span>${esc(palette.name)}</span></button>${index>=COLOR_PALETTES.length?`<div class="palette-manage"><input class="input palette-rename-input" data-palette-name="${index-COLOR_PALETTES.length}" aria-label="Rename ${esc(palette.name)}" maxlength="32" value="${esc(palette.name)}"><button class="text-button" type="button" data-rename-palette="${index-COLOR_PALETTES.length}">Rename</button><button class="text-button palette-delete" type="button" data-delete-palette="${index-COLOR_PALETTES.length}">Delete</button></div>`:''}</div>`).join('')}</div>
    <div class="settings-color-controls"><button class="theme-color-control" type="button" data-wheel-target="primary" aria-pressed="${wheelTarget==='primary'}"><span>Primary colour</span><span id="theme-primary-swatch" class="theme-color-swatch" style="--swatch-color:${themeColors.primary}" aria-hidden="true"></span><span id="theme-primary-value">${themeColors.primary.toUpperCase()}</span></button><button class="theme-color-control" type="button" data-wheel-target="secondary" aria-pressed="${wheelTarget==='secondary'}"><span>Secondary colour</span><span id="theme-secondary-swatch" class="theme-color-swatch" style="--swatch-color:${themeColors.secondary}" aria-hidden="true"></span><span id="theme-secondary-value">${themeColors.secondary.toUpperCase()}</span></button></div>
    <div class="full-colour-section"><div class="full-colour-heading"><h3>Colour wheel</h3><span id="wheel-target-label">${wheelTarget==='primary'?'Primary colour':'Secondary colour'}</span></div><div class="colour-wheel" tabindex="0" role="group" aria-label="Colour wheel for ${wheelTarget} colour. Click or drag to change it; use arrow keys to change hue and Shift plus arrow keys to change saturation"><span class="colour-wheel-marker" aria-hidden="true"></span></div><div class="save-colours-row"><input class="input saved-colour-name" id="saved-colour-name" type="text" maxlength="32" placeholder="Name this colour set" aria-label="Name this colour set"><button class="btn btn-small" type="button" data-save-colours>Save colours</button></div></div>
  </div></details>`;
}
function renderSettings(){
  const security=`<details class="theme-settings settings-security-box card" aria-label="Security"><summary class="theme-settings-heading"><h2>Security</h2><span class="theme-settings-arrow" aria-hidden="true">⌄</span></summary><div class="theme-settings-content"><p class="theme-settings-description">Change your password or username for your account.</p><form id="security-form" class="settings-security-form" novalidate><div class="settings-security-divider"><span>Change password</span></div><label class="field"><span>Current password</span><input class="input" name="currentPassword" type="password" autocomplete="current-password" required></label><label class="field"><span>New password</span><input class="input" name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label><label class="field"><span>Confirm new password</span><input class="input" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label><p class="settings-security-status" id="security-status" role="status" aria-live="polite"></p><button class="btn btn-primary" type="submit">Update password</button></form><form id="username-form" class="settings-security-form settings-security-form-secondary" novalidate><div class="settings-security-divider"><span>Change username</span></div><label class="field"><span>Current password</span><input class="input" name="currentPassword" type="password" autocomplete="current-password" required></label><label class="field"><span>New username</span><input class="input" name="newUsername" type="text" autocomplete="username" maxlength="32" required></label><p class="settings-security-status" id="username-status" role="status" aria-live="polite"></p><button class="btn btn-primary" type="submit">Update username</button></form></div></details>`;
  return `${header('','Settings')}${renderThemeSettings()}${security}<section class="settings-card card" aria-label="Settings actions">
    <button class="settings-option" data-action="reset-app"><span><strong>Reset data</strong><small>Clear your business data and restart setup</small></span><span class="settings-arrow" aria-hidden="true">→</span></button>
    <button class="settings-option" data-action="dev-reset"><span><strong>Dev reset</strong><small>Clear this account's data and sign out</small></span><span class="settings-arrow" aria-hidden="true">→</span></button>
    <button class="settings-option" data-action="sign-out"><span><strong>Sign out</strong><small>${esc(activeUser?.email||'')}</small></span><span class="settings-arrow" aria-hidden="true">→</span></button>
  </section>`;
}
function setupProgress(step){return '<div class="setup-progress" role="group" aria-label="Setup progress: '+step+' of 4"><strong>'+step+' of 4</strong><div class="setup-progress-track" aria-hidden="true">'+[1,2,3,4].map(index=>'<span class="'+(index<=step?'active':'')+'"></span>').join('')+'</div></div>'}
function setupInventoryForm(kind){const consumable=kind==='consumable';return `<form class="setup-form" data-setup-form="${kind}"><div class="setup-form-title">Add a ${consumable?'useable':'supply'}</div><div class="setup-fields"><label class="field"><span>Item name</span><input class="input" name="name" required maxlength="80" placeholder="e.g. Builder Gel"></label><label class="field"><span>Measurement unit</span><select class="select" name="unit" data-inventory-unit required>${inventoryUnitOptions()}</select><small class="unit-helper" data-unit-helper hidden></small></label><label class="field"><span data-stock-unit-label>Pieces in stock</span><span class="quantity-unit-field"><input class="input" name="quantity" type="number" min="0" step="any" required><small data-stock-input-unit aria-hidden="true">pcs</small></span></label><label class="field"><span data-threshold-unit-label>Alert me at (pcs)</span><input class="input" name="threshold" type="number" min="0" step="any" value="2" required></label><div class="field setup-cost-field"><label class="required" data-cost-unit-label for="setup-unit-cost">Cost per piece</label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" id="setup-unit-cost" name="unitCost" type="number" min="0" step="any" required></span><details class="unit-cost-calculator"><summary>Calculate</summary><div class="unit-cost-fields"><label><span data-purchase-quantity-label>Quantity purchased (pcs)</span><span class="quantity-unit-field"><input class="input" data-unit-quantity aria-label="Quantity purchased (pcs)" type="number" min="0.001" step="any" placeholder="e.g. 10"><small data-purchase-unit aria-hidden="true">pcs</small></span></label><label><span data-total-cost-label>Total cost ($)</span><input class="input" data-unit-total aria-label="Total cost in dollars" type="number" min="0" step="0.01" placeholder="e.g. 15.00"></label></div><p data-unit-result>Enter quantity and total cost to calculate the cost per unit.</p></details></div><label class="field setup-purchase-field"><span>Purchase link <span class="optional-note">(optional)</span></span><input class="input" name="purchaseUrl" type="url" placeholder="https://…"></label></div><button class="btn btn-primary" type="submit">+ Add ${consumable?'Useable':'Supply'}</button></form>`}
function renderSetupInventoryRows(items,emptyLabel){return items.length?items.map(item=>`<div class="setup-item"><div><strong>${esc(item.name)}</strong><small>${esc(inventoryStockText(item))}${item.unitCost!==''&&item.unitCost!=null?` · ${esc(inventoryUnitCostText(item))}`:''}</small>${item.purchaseUrl?`<a class="setup-purchase-link" href="${esc(item.purchaseUrl)}" target="_blank" rel="noopener noreferrer">Purchase link ↗</a>`:''}</div><div class="setup-item-actions"><button class="text-button" data-action="edit-inventory" data-id="${esc(item.id)}">Edit</button><button class="text-button setup-delete" data-action="delete-inventory" data-id="${esc(item.id)}">Remove</button></div></div>`).join(''):`<p class="setup-empty">${emptyLabel}</p>`}
function renderSetup(){
  const serviceRows=state.services.length?state.services.map(s=>`<div class="setup-item"><div><strong>${esc(s.name)}</strong><small>${money(s.defaultPrice)} · ${formatDuration(s.defaultDurationMinutes)} · Supply cost ${money(inventoryUsageCost(s.inventoryUsage||[]))}</small></div><div class="setup-item-actions"><button class="text-button" data-action="edit-service" data-id="${esc(s.id)}">Edit</button><button class="text-button setup-delete" data-action="delete-service-setup" data-id="${esc(s.id)}">Delete</button></div></div>`).join(''):'<p class="setup-empty">Your services will appear here.</p>';
  const extraRows=state.extras.length?state.extras.map(x=>`<div class="setup-item"><div><strong>${esc(x.name)}</strong><small>${money(x.price)} · ${formatDuration(x.durationMinutes)} · Supply cost ${money(inventoryUsageCost(x.inventoryUsage||[]))}</small></div><div class="setup-item-actions"><button class="text-button" data-action="edit-extra" data-id="${esc(x.id)}">Edit</button><button class="text-button setup-delete" data-action="delete-extra-setup" data-id="${esc(x.id)}">Delete</button></div></div>`).join(''):'<p class="setup-empty">Your extras will appear here.</p>';
  const supplyRows=renderSetupInventoryRows(state.inventory.filter(item=>item.category!=='consumable'),'Your supplies will appear here.');
  const consumableRows=renderSetupInventoryRows(state.inventory.filter(item=>item.category==='consumable'),'Your useables will appear here.');
  let content='';
  if(setupStep===0) content=`<section class="setup-welcome"><p class="eyebrow">A FRESH START FOR YOUR BUSINESS</p><h1>Thank you so much for your purchase!</h1><p>Polished brings your schedule, services, extras, supplies, and consumables together. Save client work, track stock, and see costs and estimated profit as you go.</p><button class="btn btn-primary" data-action="setup-next">Let’s get started <span>→</span></button></section>`;
  if(setupStep===1) content=`<section class="setup-section setup-inventory">${setupProgress(1)}<div class="setup-intro"><p class="eyebrow">INVENTORY</p><h1>Supplies</h1><p>Add the supplies you use. You can link them to services and extras in the next steps.</p></div>${setupInventoryForm('inventory')}<div class="setup-list">${supplyRows}</div><div class="setup-footer setup-footer-end"><button class="btn btn-primary" data-action="setup-next">Continue to Services <span>→</span></button></div></section>`;
  if(setupStep===2) content=`<section class="setup-section setup-services">${setupProgress(2)}<div class="setup-intro"><p class="eyebrow">WHAT YOU OFFER</p><h1>Services</h1><p>Services are the main things you offer your clients. For a nail technician, these might be Gel Extensions, BIAB, Acrylic Full Set or a Manicure.</p></div><form class="setup-form" data-setup-form="service"><div class="setup-form-title">Add a service</div><div class="setup-fields"><label class="field"><span>Service name</span><input class="input" name="name" required maxlength="60" placeholder="e.g. Gel Extensions"></label><label class="field"><span>Price</span><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" name="price" type="number" min="0" step="0.01" required></span></label><label class="field"><span>Duration</span><div class="input-group"><span class="duration-clock" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span><input class="input" name="duration" type="number" min="0" step="1" required><select class="select" name="unit"><option>Minutes</option><option>Hours</option></select></div></label></div>${inventoryUsageEditor('service',null)}<button class="btn btn-primary" type="submit">+ Add Service</button></form><div class="setup-list">${serviceRows}</div><div class="setup-footer"><button class="btn" data-action="setup-services-back">← Supplies</button><div class="setup-footer-right"><button class="btn btn-primary" data-action="setup-next">Continue to Extras <span>→</span></button></div></div></section>`;
  if(setupStep===3) content=`<section class="setup-section setup-extras">${setupProgress(3)}<div class="setup-intro"><p class="eyebrow">FINISHING TOUCHES</p><h1>Extras</h1><p>Extras are optional additions you can offer alongside a service. Examples include Nail Art, French Tips, Chrome, Repairs or Soak Off. Extras work independently, too.</p></div><form class="setup-form" data-setup-form="extra"><div class="setup-form-title">Add an extra</div><div class="setup-fields"><label class="field"><span>Extra name</span><input class="input" name="name" required maxlength="60" placeholder="e.g. Nail Art"></label><label class="field"><span>Price</span><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" name="price" type="number" min="0" step="0.01" required></span></label><label class="field"><span>Duration</span><div class="input-group"><span class="duration-clock" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span><input class="input" name="duration" type="number" min="0" step="1" required><select class="select" name="unit"><option>Minutes</option><option>Hours</option></select></div></label></div>${inventoryUsageEditor('extra',null)}<button class="btn btn-primary" type="submit">+ Add Extra</button></form><div class="setup-list">${extraRows}</div><div class="setup-footer"><button class="btn" data-action="setup-back">← Services</button><div class="setup-footer-right"><button class="btn btn-primary" data-action="setup-next">Continue to Useables <span>→</span></button></div></div></section>`;
  if(setupStep===4) content=`<section class="setup-section setup-inventory setup-consumables">${setupProgress(4)}<div class="setup-intro"><p class="eyebrow">INVENTORY</p><h1>Useables</h1><p>Add consumables you use during services. Enter the amount used for each client to track its cost and stock.</p></div>${setupInventoryForm('consumable')}<div class="setup-list">${consumableRows}</div><div class="setup-footer"><button class="btn" data-action="setup-consumables-back">← Extras</button><div class="setup-footer-right"><button class="btn btn-primary" data-action="setup-complete">Finish setup</button></div></div></section>`;
  if(setupStep===5) content=`<section class="setup-welcome setup-done"><div class="setup-success">✓</div><h1>You're All Set!</h1><p>Your schedule, services, extras, supplies, and consumables are ready. Open Catalog any time to update them, or select Help on a page for a step-by-step guide.</p><button class="btn btn-primary" data-action="setup-start">Get Started <span>→</span></button></section>`;
  return `<div class="setup-top"><div class="setup-top-actions"><button class="help-button" type="button" data-action="page-help" aria-label="Setup help"><span class="help-mark" aria-hidden="true">?</span><span>Help</span></button>${setupComplete?'<button class="text-button" data-action="setup-exit">Back to app</button>':''}</div></div>${content}${setupStep<5?'<button class="setup-skip-link" data-action="setup-skip">Skip for now</button>':''}`;
}
function showPageHelp(){
  let title='Help',intro='',items=[];
  const supplySteps=[
    "Give each item a clear name, choose its unit (pcs, ml, fl oz, or g), then enter the quantity on hand and the low-stock alert level in that same unit.",
    "Set a cost per unit. If you know the package price instead, use Calculate: enter the package quantity and total price to get the unit cost.",
    "Add optional notes or a purchase link in Catalog. Link supplies to services or extras to include their cost in estimates and track their use from stock."
  ];
  if(page==='setup'){
    if(setupStep===0){title='Welcome';intro='Set up the parts of your studio in four short steps. You can skip setup and add or edit everything later in Catalog.';items=[
      "Supplies: Add stocked materials and define their unit cost and low-stock level.",
      "Services: Add your regular treatments, prices, durations, and the supplies each one uses.",
      "Extras: Add optional add-ons with their own price, time, and supply usage.",
      "Useables: Track items whose actual quantity is entered for each client in Studio Log or when completing an appointment."
    ]}
    if(setupStep===1){title='Supplies';intro='Supplies are materials you link to a service or extra, so their cost and stock use can be tracked automatically.';items=supplySteps}
    if(setupStep===2){title='Services';intro='Set up the treatments you offer most often. You can change these details later in Catalog.';items=[
      "Add a name, default price, and duration. Use minutes or hours; the app converts time to minutes for totals and profit per hour.",
      "Under Supplies used, choose each stocked supply and enter the quantity used in its listed unit. Add or remove rows with + or x.",
      "Linked supply costs are included in estimates. Stock is deducted when you save a Studio Log entry or complete an appointment."
    ]}
    if(setupStep===3){title='Extras';intro='Extras are optional add-ons. They can accompany a service or be used on their own.';items=[
      "Add the extra name, price, and duration. Its price and time are added when you select it.",
      "Link any supplies it uses and enter the amount per use. Supply cost is included in the estimate and tracked against stock.",
      "Choose extras in Studio Log or while booking an appointment. You can also use extras without selecting a service."
    ]}
    if(setupStep===4){title='Useables';intro='Useables are tracked in stock, but their actual amount is entered separately for each client.';items=[
      "Add a name, measurement unit, quantity on hand, low-stock alert level, and cost per unit. Calculate unit cost from a package price if needed.",
      "In Studio Log or an appointment, enter the amount actually used for each item. The app calculates its cost from the saved unit cost.",
      "Stock is checked and deducted when you save the estimate or complete the appointment. Keep the amount at zero when an item was not used."
    ]}
    if(setupStep===5){title='Setup complete';intro='Your starting catalog is ready. Choose Get Started to open Schedule. Use Catalog whenever you need to add or update services, extras, supplies, or useables.'}
  }else if(page==='schedule'){
    title='Schedule';intro='Plan appointments, keep an eye on your profit target, and find saved client work from one place.';items=[
      "Profit goal: Set a target or choose Adjust target. Progress uses profit from all saved Client List entries, not just the week shown in the calendar.",
      "Calendar: Select a day, use Today, or move between weeks with the arrow buttons. Select + to book an appointment; choose a booking to review or edit it.",
      "Booking details: Add a client and date/time, then optionally choose a service, custom one-off service, and extras. Adjust the price, discount, and notes as needed.",
      "Complete a booking after the visit. Enter actual useable quantities; completion records the work and tracks useable and linked-supply stock. Completed bookings leave the calendar and appear in Client List.",
      "Client List: Search saved work by client or service. Open a record for its details; use Export receipt on saved calculations when you need a client copy."
    ]
  }else if(page==='studio'){
    title='Studio Log';intro='Build an estimate, check its costs and profit, then save the finished work to your Client List.';items=[
      "Open Inputs to choose a saved service. Select + to add another service, or choose Custom service for a one-off name, price, duration, and optional material cost.",
      "Select Extras for add-ons; an estimate can include extras with or without a service. Costs for supplies linked to services and extras are included automatically.",
      "In Useables, enter the actual quantity used for each item in its displayed unit. The app calculates cost from unit cost and will not let the amount exceed available stock.",
      "Use Fees to add or deduct an amount and apply a discount. A non-zero discount needs a reason. GST is calculated after the discount, then Tax is applied after GST.",
      "Check Show Breakdown for the price, costs, profit, margin, and profit per hour. Save with a client name to add the dated result to Client List; saving records the estimate and deducts its linked supplies and entered useables."
    ]
  }else if(page==='catalog'){
    title='Catalog';intro='Use the four tabs to manage what you offer and what you keep in stock. Select + to add an item to the open tab.';items=[
      "Services: Set a name, default price, and duration. Link supplies and quantities used so their costs are included and stock can be tracked.",
      "Extras: Add optional priced and timed add-ons. Link supplies used; extras can be selected with a service or on their own.",
      "Useables: Manage items whose actual per-client quantities are entered in Studio Log or when an appointment is completed.",
      "Supplies: Manage materials linked to services and extras. Both inventory tabs use pcs, ml, fl oz, or g and show stock status against each item's alert level.",
      "Edit or Remove an item from its row. Inventory items also support optional notes and purchase links. Unit cost can be calculated from package quantity and total price."
    ]
  }else if(page==='settings'){
    title='Settings';intro='Personalize the workspace, update your sign-in details, or manage your saved studio data.';items=[
      "App colours: Choose a preset or select Primary colour and Secondary colour, then use the colour wheel. Click or drag to change hue; use arrow keys for hue and Shift plus arrow keys for saturation.",
      "Save a colour set by naming it. Saved sets can be renamed or deleted; presets are ready to apply at any time.",
      "Security: Confirm your current password before changing your password or username. New passwords must be at least 8 characters.",
      "Reset data clears studio records and restarts setup. Dev reset clears this account's studio data and signs you out. These actions cannot be undone."
    ]
  }else if(page==='inventory'){
    title='Supplies';intro='Supplies are linked to services and extras so their cost and stock use can be tracked.';items=supplySteps
  }else if(page==='clients'){
    title='Client History';items=[
      "Search by client or service, then open a record to review its price, extras, fees, recorded costs, time, profit, and margin.",
      "Saved calculations can be exported as receipts. Appointments are added to this list when you mark them complete."
    ]
  }
  modal(title,(intro?'<p class="help-intro">'+esc(intro)+'</p>':'')+(items.length?'<ul class="help-list">'+items.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>':'')+'<div class="modal-actions"><button class="btn btn-primary" data-help-done>Done</button></div>');
  $('[data-help-done]').addEventListener('click',closeModal);
}
function header(kicker,title){return `<div class="page-heading"><div><h1>${title}</h1></div><button class="help-button" type="button" data-action="page-help" aria-label="Help with ${esc(title)}"><span class="help-mark" aria-hidden="true">?</span><span>Help</span></button></div>`}
function percentageChoices(selected,type){return Array.from({length:101},(_,percent)=>`<button type="button" class="discount-choice ${selected===percent?'selected':''}" data-${type}-percent="${percent}" aria-pressed="${selected===percent}">${percent}%</button>`).join('')}
function renderGST(){
  const values=currentValues(),selected=Math.max(0,Math.min(100,Number(calc.gstPercent)||0));
  return `<details class="discount-details gst-details" ${calc.gstOpen?'open':''}><summary>GST <span aria-hidden="true">▾</span></summary><div class="discount-content"><span class="discount-prompt">Select a GST rate</span><div class="discount-scroll-panel"><div class="discount-picker" id="gst-picker" role="group" aria-label="GST percentage" tabindex="0">${percentageChoices(selected,'gst')}</div></div><p class="discount-amount" id="gst-amount-preview" aria-live="polite">${selected?`${money(values?.gstAmount||0)} GST added`:'No GST applied.'}</p></div></details>`;
}
function renderTax(){
  const values=currentValues(),selected=Math.max(0,Math.min(100,Number(calc.taxPercent)||0));
  return `<details class="discount-details tax-details" ${calc.taxOpen?'open':''}><summary>Tax <span aria-hidden="true">▾</span></summary><div class="discount-content"><span class="discount-prompt">Select a tax rate</span><div class="discount-scroll-panel"><div class="discount-picker" id="tax-picker" role="group" aria-label="Tax percentage" tabindex="0">${percentageChoices(selected,'tax')}</div></div><p class="discount-amount" id="tax-amount-preview" aria-live="polite">${selected?`${money(values?.taxAmount||0)} tax added`:'No tax applied.'}</p></div></details>`;
}
function renderDiscounts(){
  const values=currentValues(),selected=Math.max(0,Math.min(100,Number(calc.discountPercent)||0));
  return `<details class="discount-details" ${calc.discountsOpen?'open':''}><summary>Discounts <span aria-hidden="true">▾</span></summary><div class="discount-content"><span class="discount-prompt">Select a discount</span><div class="discount-scroll-panel"><div class="discount-picker" id="discount-picker" role="group" aria-label="Discount percentage" tabindex="0">${percentageChoices(selected,'discount')}</div></div><p class="discount-amount" id="discount-amount-preview" aria-live="polite">${selected?`${money(values?.discountAmount||0)} off the price`:'No discount applied.'}</p><label class="field discount-reason-field"><span>Reason for discount</span><input class="input" id="discount-reason" maxlength="160" placeholder="e.g. Loyalty reward" value="${esc(calc.discountReason)}" ${selected?'required aria-required="true"':''}></label></div></details>${renderGST()}${renderTax()}`;
}
function renderCalculator(){
  const s=selectedService(), v=currentValues();
  const durationUnit=calc.unit;
  const serviceOptions=state.services.map(x=>`<option value="${esc(x.id)}" ${x.id===calc.serviceId?'selected':''}>${esc(x.name)} (${money(x.defaultPrice)})</option>`).join('');
  const additionalServiceFields=(calc.additionalServiceIds||[]).map((serviceId,index)=>`<div class="field calc-service-field additional-service-field"><label>Service</label><div class="service-select-row"><select class="select additional-service-select" data-index="${index}" aria-label="Additional service ${index+1}"><option value="" ${!serviceId?'selected':''}>Choose a service</option>${state.services.map(service=>`<option value="${esc(service.id)}" ${service.id===serviceId?'selected':''}>${esc(service.name)} (${money(service.defaultPrice)})</option>`).join('')}</select><button type="button" class="icon-btn" aria-label="Remove service from the estimate" title="Remove this service from the estimate" data-action="remove-additional-service" data-index="${index}">×</button></div>${index===calc.additionalServiceIds.length-1?`<button type="button" class="secondary-service-add" data-action="add-additional-service" aria-label="Add another service to the estimate" title="Add another service to the estimate">+</button>`:''}</div>`).join('');
  const input=`<details class="calc-input-details" ${calc.inputsOpen?'open':''}><summary>Inputs <span>▾</span></summary><div class="calc-input-content"><div class="field calc-service-field"><label>Service</label><div class="service-select-row"><select class="select" id="calc-service"><option value="">Choose a service</option>${serviceOptions}<option value="__custom__" ${calc.customService?'selected':''}>Custom service (one-off)</option></select></div>${(calc.additionalServiceIds||[]).length===0&&(s||calc.customService)?`<button type="button" class="secondary-service-add" data-action="add-additional-service" aria-label="Add another service to the estimate" title="Add another service to the estimate">+</button>`:''}</div>${additionalServiceFields}
    ${calc.customService?`<div class="tweak-disclosure"><div class="tweak-fields"><div class="form-grid"><div class="field full"><label for="calc-custom-name">Service name</label><input class="input" id="calc-custom-name" maxlength="60" placeholder="e.g. Custom nail art" value="${esc(calc.customName)}"></div><div class="field"><label for="calc-price">Price</label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" id="calc-price" type="number" min="0" step="0.01" value="${esc(calc.price)}"></span></div><div class="field"><label for="calc-time">Duration</label><div class="input-group duration-input"><span class="duration-clock" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span><input class="input" id="calc-time" type="number" min="0" step="1" value="${esc(calc.time)}"><select class="select" id="calc-unit"><option ${durationUnit==='Minutes'?'selected':''}>Minutes</option><option ${durationUnit==='Hours'?'selected':''}>Hours</option></select></div></div><div class="field"><label for="calc-material-cost">Useables cost <span class="optional-note">(optional)</span></label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" id="calc-material-cost" type="number" min="0" step="0.01" value="${esc(calc.material)}"></span></div><div class="field full"><label for="calc-custom-notes">Notes <span class="optional-note">(optional)</span></label><textarea class="textarea" id="calc-custom-notes" maxlength="1000" placeholder="Add details for this one-off service">${esc(calc.customNotes)}</textarea></div></div></div></div>`:''}
    <div class="extras-section"><div class="extras-heading"><h3>Extras</h3></div>
    ${state.extras.length?`<div class="extras-list">${state.extras.map(e=>`<div class="extra-option"><label class="extra-pill ${calc.extras.includes(e.id)?'selected':''}"><input class="calc-extra" type="checkbox" value="${esc(e.id)}" ${calc.extras.includes(e.id)?'checked':''}><span>${esc(e.name)}</span><strong>+${money(e.price)}</strong></label></div>`).join('')}</div>`:`<div class="empty-inline">No extras yet.</div>`}</div><div class="extras-section consumables-section"><div class="extras-heading"><h3>Useables</h3></div>${state.inventory.filter(item=>item.category==='consumable').length?`<div class="calc-consumables-list">${state.inventory.filter(item=>item.category==='consumable').map(item=>{const quantity=Math.max(0,Number(calc.consumableUsage?.[item.id])||0);return `<label class="calc-consumable-row ${quantity>0?'selected':''}"><span class="calc-consumable-copy"><strong>${esc(item.name)}</strong><small>${esc(inventoryStockText(item))} · <span class="calc-consumable-cost" data-consumable-cost="${esc(item.id)}">${quantity} ${esc(inventoryUnitInfo(item.unit).short)} used · ${esc(inventoryUnitCostText(item))} · ${money(quantity*(Number(item.unitCost)||0))} total</span></small></span><span class="quantity-unit-field"><input class="input calc-consumable-quantity" type="number" min="0" max="${Math.max(0,Number(item.quantity)||0)}" step="any" value="${quantity}" data-consumable-id="${esc(item.id)}" aria-label="${esc(item.name)} quantity used (${esc(inventoryUnitInfo(item.unit).short)})" title="Enter the amount of ${esc(item.name)} used in ${esc(inventoryUnitInfo(item.unit).short)}."><small aria-hidden="true">${esc(inventoryUnitInfo(item.unit).inputUnit||inventoryUnitInfo(item.unit).short)}</small></span></label>`}).join('')}</div>`:`<div class="empty-inline">Add useables in Catalog > Useables, then enter the amount used here.</div>`}</div><details class="fees-section" ${calc.feesOpen?'open':''}><summary>Fees <span aria-hidden="true">▾</span></summary>${renderDiscounts()}</details></div></details>`;
  let results='';
  if(!v) results=`<div class="result-topline"><div><div class="profit-label">ESTIMATED PROFIT</div><div class="profit-hero empty-profit">—</div></div></div><div class="result-pair"><div class="mini-result client-price"><span>CLIENT PRICE</span><strong>—</strong></div><div class="mini-result"><span>PROFIT PER HOUR</span><strong>—</strong></div><div class="mini-result"><span>PROFIT MARGIN</span><strong>—</strong></div></div>`;
  else if ((num(calc.price)!==null&&num(calc.price)<0)||(timeMins(calc.time,calc.unit)!==null&&timeMins(calc.time,calc.unit)<0)||(calc.customService&&num(calc.material)!==null&&num(calc.material)<0)) results=`<div class="result-topline"><div><div class="profit-label">ESTIMATED PROFIT</div><div class="profit-hero empty-profit">—</div></div></div><div class="result-pair"><div class="mini-result client-price"><span>CLIENT PRICE</span><strong>—</strong></div><div class="mini-result"><span>PROFIT PER HOUR</span><strong>—</strong></div><div class="mini-result"><span>PROFIT MARGIN</span><strong>—</strong></div></div><div class="empty-hint">Use zero or positive values.</div>`;
  else {
    const adjustButton=calc.adjustmentOpen?'Close':v.adjustment!==0?`Edit adjustment · ${v.adjustment>0?'+':'−'}${money(v.adjustmentAmount)}`:'Adjust price';
    results=`<div class="result-topline"><div><div class="profit-label">ESTIMATED PROFIT</div><div class="profit-hero">${money(v.profit)}</div></div></div><div class="result-pair"><div class="mini-result client-price"><span>CLIENT PRICE</span><strong>${money(v.price)}</strong></div><div class="mini-result"><span>PROFIT PER HOUR</span><strong>${money(v.perHour)}<small> /hr</small></strong></div><div class="mini-result"><span>PROFIT MARGIN</span><strong>${v.margin.toFixed(1)}%</strong></div></div><details class="breakdown-details" ${calc.breakdownOpen?'open':''}><summary>Show Breakdown <span>▾</span></summary><div class="result-breakdown"><div class="breakdown-row"><span>Client price</span><strong>${money(v.price)}</strong></div><div class="breakdown-row"><span>${s?'Service price':'Custom price'}</span><strong>${money(v.servicePrice)}</strong></div><div class="breakdown-row"><span>Extra prices${v.extras.length?` (${esc(v.extras.map(extra=>extra.name).join(', '))})`:""}</span><strong>${money(v.extrasPrice)}</strong></div>${v.adjustment!==0?`<div class="breakdown-row"><span>Price adjustment</span><strong>${v.adjustment>0?'+':'−'}${money(v.adjustmentAmount)}</strong></div>`:''}${v.gstPercent?`<div class="breakdown-row"><span>GST (${v.gstPercent}%)</span><strong>+${money(v.gstAmount)}</strong></div>`:''}<div class="breakdown-row"><span>Supplies</span><strong>${money(v.supplyMaterial)}</strong></div><div class="breakdown-row"><span>Useables</span><strong>${money(v.consumables.reduce((sum,use)=>sum+(Number(use.item.unitCost)||0)*use.quantity,0))}</strong></div>${v.customMaterialCost>0?`<div class="breakdown-row"><span>Other useable cost</span><strong>${money(v.customMaterialCost)}</strong></div>`:''}<div class="breakdown-row total"><span>Estimated profit</span><strong>${money(v.profit)}</strong></div><div class="breakdown-row"><span>Total time</span><strong>${formatDuration(v.minutes)}</strong></div><button type="button" class="text-button adjust-toggle" data-action="toggle-adjustment" aria-expanded="${calc.adjustmentOpen}">${adjustButton}</button>${calc.adjustmentOpen?`<div class="adjust-controls"><label class="sr-only" for="calc-adjust-type">Adjustment type</label><select class="select" id="calc-adjust-type"><option value="add" ${calc.adjustmentType==='add'?'selected':''}>Add an amount</option><option value="deduct" ${calc.adjustmentType==='deduct'?'selected':''}>Deduct an amount</option></select><label class="sr-only" for="calc-adjust-amount">Adjustment amount</label><div class="adjust-amount"><span>$</span><input class="input" id="calc-adjust-amount" type="number" min="0" step="0.01" placeholder="Amount" value="${esc(calc.adjustmentAmount)}"></div></div>`:''}</div></details>`;
  }
  return `${header('','Studio Log')}<div class="calc-layout"><section class="card results-card">${results}</section><section class="card input-card">${input}</section></div>${v?`<div class="save-bar"><label for="calc-client">Client name</label><input class="input" id="calc-client" placeholder="Enter client name" value="${esc(calc.client)}"><button class="btn btn-primary" data-action="save-calculation" ${!calc.client.trim()?'disabled':''}>Save to Log</button></div>`:''}`;
}
function formatDuration(m){m=Math.max(0,Math.round(Number(m)||0));const h=Math.floor(m/60),r=m%60;return h?`${h} hr${h===1?'':'s'}${r?` ${r} min`:''}`:`${r} min`}
function inventoryUnitOptions(current='ml'){const normalized=inventoryUnitInfo(current).key,choices=[['pcs','Pieces / Count (pcs)'],['ml','Milliliters (ml)'],['fl oz','Fluid Ounces (fl oz)'],['g','Grams (g)']];return choices.map(([value,label])=>`<option value="${value}" ${value===normalized?'selected':''}>${label}</option>`).join('')}
function inventoryUnitInfo(unit='ml'){const value=String(unit||'ml').trim().toLowerCase(),aliases={milliliter:'ml',milliliters:'ml','fluid ounces':'fl oz','fluid ounce':'fl oz','fl. oz.':'fl oz',ounces:'fl oz',ounce:'fl oz',gram:'g',grams:'g',pieces:'pcs',piece:'pcs',units:'pcs',unit:'pcs',bottles:'pcs',bottle:'pcs',packs:'pcs',pack:'pcs',boxes:'pcs',box:'pcs'},candidate=aliases[value]||value,key=['ml','fl oz','g','pcs'].includes(candidate)?candidate:'pcs';const known={ml:{short:'ml',stock:'ml',singular:'ml',stockLabel:'Total ml in stock',costLabel:'Cost per ml',costSuffix:'/ml',helper:'💡 e.g., Gel polish, monomer, builder gel, cuticle oil.',purchaseExample:'e.g. 500',totalExample:'e.g. 25.00'},'fl oz':{short:'fl oz',stock:'fl oz',singular:'fl oz',stockLabel:'Total fl oz in stock',costLabel:'Cost per fl oz',costSuffix:'/fl oz',helper:'💡 e.g., Monomer, cleanser, remover.',purchaseExample:'e.g. 16',totalExample:'e.g. 25.00'},g:{short:'g',stock:'g',singular:'gram',stockLabel:'Grams in stock',costLabel:'Cost per gram',costSuffix:'/g',helper:'💡 e.g., Acrylic powder, chrome powder, dip powder, glitter.',purchaseExample:'e.g. 100',totalExample:'e.g. 8.00'},pcs:{short:'pcs',stock:'pcs',singular:'piece',stockLabel:'Pieces in stock',costLabel:'Cost per piece',costSuffix:'each',helper:'💡 e.g., Nail files, buffers, forms, brushes.',purchaseExample:'e.g. 10',totalExample:'e.g. 15.00'}};return {key,...known[key]}}
function inventoryStockText(item){return `${Number(item.quantity)||0} ${inventoryUnitInfo(item.unit).stock} in stock`}
function inventoryCostAmount(value,unit){const precision=['ml','fl oz','g'].includes(inventoryUnitInfo(unit).key)?6:2;let amount=Number(value||0).toFixed(precision);if(precision>2){amount=amount.replace(/(\.\d*?[1-9])0+$/,'$1').replace(/\.0+$/,'');if(!amount.includes('.'))amount+='.00';else if(amount.split('.')[1].length<2)amount+='0'}return `$${amount}`}
function inventoryUnitCostText(item){const unit=inventoryUnitInfo(item.unit);return `${inventoryCostAmount(item.unitCost,item.unit)}${unit.costSuffix==='each'?' each':unit.costSuffix}`}
function bindInventoryUnitLabel(root=document){const unit=$('[data-inventory-unit]',root),stock=$('[data-stock-unit-label]',root),cost=$('[data-cost-unit-label]',root),threshold=$('[data-threshold-unit-label]',root),helper=$('[data-unit-helper]',root);if(!unit)return;const update=()=>{const info=inventoryUnitInfo(unit.value);if(stock)stock.textContent=info.stockLabel;if(cost)cost.textContent=info.costLabel;if(threshold)threshold.textContent=`Alert me at (${info.short})`;const stockInputUnit=$('[data-stock-input-unit]',root),purchaseLabel=$('[data-purchase-quantity-label]',root),purchaseUnit=$('[data-purchase-unit]',root),purchaseQuantity=$('[data-unit-quantity]',root),totalLabel=$('[data-total-cost-label]',root),totalCost=$('[data-unit-total]',root);if(stockInputUnit)stockInputUnit.textContent=info.short;if(purchaseLabel)purchaseLabel.textContent=`Quantity purchased (${info.short})`;if(purchaseUnit)purchaseUnit.textContent=info.short;if(purchaseQuantity){purchaseQuantity.placeholder=info.purchaseExample||`e.g. 10`;purchaseQuantity.setAttribute('aria-label',`Quantity purchased (${info.short})`)}if(totalLabel)totalLabel.textContent='Total cost ($)';if(totalCost)totalCost.placeholder=info.totalExample||'e.g. 25.00';if(helper){helper.textContent=info.helper;helper.hidden=!info.helper}};unit.addEventListener('change',update);update()}
function renderCalculationRows(items){return items.length?items.slice().sort((a,b)=>String(b.createdAt||b.date||'').localeCompare(String(a.createdAt||a.date||''))).map(c=>`<div class="log-entry-wrap"><div class="log-entry" role="button" tabindex="0" aria-label="View ${esc(c.clientName)} · ${esc(c.serviceNameSnapshot)}" data-action="view-calculation" data-id="${esc(c.id)}"><div class="entry-main"><strong>${esc(c.clientName)}</strong><small>${esc(c.serviceNameSnapshot)}</small></div><div class="entry-service"><strong>${esc(c.extras?.length?c.extras.map(e=>e.name).join(', '):'No extras')}</strong><small>${c.extras?.length?'Selected extras':'Service only'}</small></div><div class="entry-meta entry-date">${fmtDate(c.date)}</div><div class="entry-money"><strong>${money(c.price)}</strong><small class="${Number(c.profit)<0?'profit-negative':'profit-positive'}">${money(c.profit)} profit</small></div></div><button class="entry-export" type="button" data-action="export-receipt" data-id="${esc(c.id)}">Export receipt</button></div>`).join(''):`<div class="empty-state"><h2>No matches</h2><p>Try a different client or service name.</p></div>`}
function renderScheduleClients(){const count=state.calculations.length;return `<section class="schedule-clients">${count?`<div class="card list-card"><div class="list-toolbar"><div class="client-list-heading"><h2>Client List</h2><span>${count} saved</span></div><input class="input search" id="schedule-client-search" aria-label="Search clients or services" placeholder="Search client or service…"></div><div class="entry-list" id="schedule-client-entries">${renderCalculationRows(state.calculations)}</div></div>`:`<div class="section-label"><h2>Client List</h2><span>0 saved</span></div><p class="empty-helper">Save an estimate in Studio Log or complete an appointment to start your Client List.</p>`}</section>`}
function renderGoals(embedded=false){
  const title=embedded?'':header('','Goals');
  if(!state.goal)return `${title}<p class="empty-helper">Set a profit target to track progress as you save client work.</p><button class="btn" data-action="new-goal">Set goal</button>`;
  const target=Math.max(0,Number(state.goal.targetProfit)||0), logged=state.calculations.reduce((a,c)=>a+(Number(c.profit)||0),0), rem=Math.max(0,target-logged), pct=target>0?(logged/target)*100:0, visual=Math.max(0,Math.min(100,pct));
  return `${title}<section class="card goal-card"><button class="goal-edit" data-action="edit-goal">Adjust target</button><div class="progress-wrap"><div class="progress-ring"><svg viewBox="0 0 150 150"><circle class="ring-track" cx="75" cy="75" r="64"></circle><circle class="ring-value" cx="75" cy="75" r="64" stroke-dasharray="402.12" stroke-dashoffset="${402.12*(1-visual/100)}"></circle></svg><div class="ring-center"><strong>${Math.round(pct)}%</strong><span>PROGRESS</span></div></div>${pct>=100?'<span class="reached">Goal reached ✓</span>':`<span class="goal-remaining-hint">${money(rem)} to go</span>`}</div><div class="goal-stats"><div class="goal-stat"><span>PROFIT GOAL</span><strong>${money(target)}</strong></div><div class="goal-stat"><span>PROFIT LOGGED</span><strong>${money(logged)}</strong></div><div class="goal-stat remaining"><span>REMAINING</span><strong>${money(rem)}</strong></div></div></section>`;
}
function renderSchedule(){return `${header('','Schedule')}${renderGoals(true)}${renderAppointments({embedded:true})}`}
function renderCatalog(){
  const serviceRows=state.services.map(s=>`<article class="catalog-row"><div><strong>${esc(s.name)}</strong><small>${money(s.defaultPrice)} · ${formatDuration(s.defaultDurationMinutes)} · Supply cost ${money(inventoryUsageCost(s.inventoryUsage||[]))}</small></div><div class="catalog-actions"><button class="text-button" data-action="edit-service" data-id="${esc(s.id)}">Edit</button><button class="text-button" data-action="delete-service-setup" data-id="${esc(s.id)}">Remove</button></div></article>`).join('');
  const extraRows=state.extras.map(x=>`<article class="catalog-row"><div><strong>${esc(x.name)}</strong><small>${money(x.price)} · ${formatDuration(x.durationMinutes)} · Supply cost ${money(inventoryUsageCost(x.inventoryUsage||[]))}</small></div><div class="catalog-actions"><button class="text-button" data-action="edit-extra" data-id="${esc(x.id)}">Edit</button><button class="text-button" data-action="delete-extra-setup" data-id="${esc(x.id)}">Remove</button></div></article>`).join('');
  const stockItems=state.inventory.filter(item=>catalogTab==='consumables'?item.category==='consumable':item.category!=='consumable');
  const body=catalogTab==='services'?(serviceRows||'<p class="empty-helper">Nothing here yet. Select + to add an item.</p>'):catalogTab==='extras'?(extraRows||'<p class="empty-helper">Nothing here yet. Select + to add an item.</p>'):renderInventoryRows(stockItems);
  const itemLabel=catalogTab==='consumables'?'useable':'supply';
  return `${header('','Catalog')}<div class="catalog-tabs">${[['services','Services'],['extras','Extras'],['consumables','Useables'],['supplies','Supplies']].map(([key,label])=>`<button class="catalog-tab ${catalogTab===key?'active':''}" data-catalog-tab="${key}">${label}</button>`).join('')}</div><section class="catalog-content">${body}</section><button class="fab" data-action="catalog-add" aria-label="Add ${catalogTab==='services'?'service':catalogTab==='extras'?'extra':itemLabel}">+</button>`;
}
function stockState(item){const quantity=Number(item.quantity)||0,threshold=Number(item.lowStockThreshold??2);return quantity<=0?'out':quantity<=threshold?'low':'good'}
function showClientSaveStockAlert(items){
  if(!items.length)return false;
  toast('Low stock. Restock soon.',5000);
  return true;
}
function renderInventoryRows(items){return items.length?items.map(item=>{const stock=stockState(item);return `<article class="inventory-row"><div class="inventory-main"><strong>${esc(item.name)}</strong><small>${esc(inventoryStockText(item))}${item.unitCost!==''&&item.unitCost!=null?` · ${esc(inventoryUnitCostText(item))}`:''}</small>${item.notes?`<p>${esc(item.notes)}</p>`:''}${item.purchaseUrl?`<a class="inventory-purchase-link" href="${esc(item.purchaseUrl)}" target="_blank" rel="noopener noreferrer">Open purchase link ↗</a>`:''}</div><span class="stock-badge stock-${stock}">${stock==='out'?'Out of Stock':stock==='low'?'Low Stock':'In Stock'}</span><div class="inventory-actions"><button class="text-button" data-action="edit-inventory" data-id="${esc(item.id)}">Edit</button><button class="text-button inventory-delete" data-action="delete-inventory" data-id="${esc(item.id)}">Remove</button></div></article>`}).join(''):'<p class="empty-helper">Nothing here yet. Select + to add an item.</p>'}
function inventoryUsageEditor(kind,record){const supplies=state.inventory.filter(item=>item.category!=='consumable');const usages=(Array.isArray(record?.inventoryUsage)?record.inventoryUsage:[]).filter(use=>supplies.some(item=>item.id===use.itemId));const rows=supplies.length?(usages.length?usages:[{itemId:'',quantity:1}]):[];const addButton=supplies.length?'<button type="button" class="small-add" data-add-usage aria-label="Add supply">+</button>':'';return `<div class="field full inventory-usage-editor"><div class="inventory-usage-heading"><label>Supplies used <span class="optional-note">(optional)</span></label></div><div class="inventory-usage-rows">${rows.map(use=>inventoryUsageRow(use)).join('')}</div>${supplies.length?`<div class="inventory-usage-add">${addButton}</div>`:'<small class="usage-empty-hint">Add items in Catalog > Supplies, then link them to services or extras.</small>'}</div>`}
function inventoryUsageRow(use={}){const selected=state.inventory.find(item=>item.id===use.itemId),unitInfo=selected?inventoryUnitInfo(selected.unit):null,unit=unitInfo?.short||'',inputUnit=unitInfo?.inputUnit||unit;return `<div class="inventory-usage-row"><select class="select usage-item" aria-label="Supply item"><option value="">Choose supply</option>${state.inventory.filter(item=>item.category!=='consumable').map(item=>`<option value="${esc(item.id)}" ${item.id===use.itemId?'selected':''}>${esc(item.name)} · ${esc(inventoryStockText(item))}</option>`).join('')}</select><span class="quantity-unit-field"><input class="input usage-quantity" aria-label="Quantity used${unit?` (${esc(unit)})`:''}" title="${unit?`Enter the amount of this supply used per service or extra (${esc(unit)}).`:'Enter the amount of this supply used per service or extra.'}" type="number" min="0.001" step="any" value="${esc(use.quantity??1)}" placeholder="${unit?`Qty (${esc(inputUnit)})`:'Qty'}"><small data-usage-unit ${unit?'':'hidden'}>${esc(inputUnit)}</small></span><button type="button" class="usage-remove" aria-label="Remove supply">×</button></div>`}
function readInventoryUsage(form){const rows=$$('.inventory-usage-row',form),result=[];for(const row of rows){const itemId=$('.usage-item',row).value,quantity=num($('.usage-quantity',row).value);if(!itemId)continue;if(quantity===null||quantity<=0)return null;if(result.some(entry=>entry.itemId===itemId))return null;result.push({itemId,quantity})}return result}
function bindUsageEditor(){const rows=$('.inventory-usage-rows');$('[data-add-usage]')?.addEventListener('click',()=>{rows.insertAdjacentHTML('beforeend',inventoryUsageRow());bindUsageRows()});bindUsageRows()}
function bindUsageRows(){$$('.inventory-usage-row').forEach(row=>{const select=$('.usage-item',row),quantity=$('.usage-quantity',row),unitLabel=$('[data-usage-unit]',row),updateUnit=()=>{const item=state.inventory.find(entry=>entry.id===select.value),info=item?inventoryUnitInfo(item.unit):null,unit=info?.short||'',inputUnit=info?.inputUnit||unit;quantity.placeholder=unit?`Qty (${inputUnit})`:'Qty';quantity.setAttribute('aria-label',unit?`Quantity used (${unit})`:'Quantity used');quantity.title=unit?`Enter the amount of this supply used per service or extra (${unit}).`:'';if(unitLabel){unitLabel.textContent=inputUnit;unitLabel.hidden=!unit}};select.onchange=updateUnit;updateUnit();$('.usage-remove',row).onclick=()=>{const rows=$$('.inventory-usage-row');if(rows.length>1)row.remove();else{select.value='';quantity.value='1';updateUnit()}}})}
function openInventory(itemId,kind='supply'){const item=state.inventory.find(entry=>entry.id===itemId),editing=!!item,label=kind==='consumable'?'useable':'supply';modal(editing?`Edit ${label}`:`Add ${label}`,`<form><div class="error-message"></div><div class="field"><label class="required">Item name</label><input class="input" name="name" required maxlength="80" placeholder="e.g. Builder Gel" value="${esc(item?.name||'')}"></div><div class="form-grid"><div class="field"><label class="required">Measurement unit</label><select class="select" name="unit" data-inventory-unit required>${inventoryUnitOptions(item?.unit||'ml')}</select><small class="unit-helper" data-unit-helper hidden></small></div><div class="field"><label class="required" data-stock-unit-label>Pieces in stock</label><span class="quantity-unit-field"><input class="input" name="quantity" type="number" min="0" step="any" required value="${esc(item?.quantity??0)}"><small data-stock-input-unit aria-hidden="true">pcs</small></span></div><div class="field"><label class="required" data-cost-unit-label>Cost per piece</label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" name="unitCost" type="number" min="0" step="any" required value="${esc(item?.unitCost??'')}"></span><details class="unit-cost-calculator"><summary>Calculate</summary><div class="unit-cost-fields"><label><span data-purchase-quantity-label>Quantity purchased (pcs)</span><span class="quantity-unit-field"><input class="input" data-unit-quantity aria-label="Quantity purchased (pcs)" type="number" min="0.001" step="any" placeholder="e.g. 10"><small data-purchase-unit aria-hidden="true">pcs</small></span></label><label><span data-total-cost-label>Total cost ($)</span><input class="input" data-unit-total aria-label="Total cost in dollars" type="number" min="0" step="0.01" placeholder="e.g. 15.00"></label></div><p data-unit-result>Enter quantity and total cost to calculate the cost per unit.</p></details></div><div class="field"><label data-threshold-unit-label>Alert me at (pcs)</label><input class="input" name="threshold" type="number" min="0" step="any" value="${esc(item?.lowStockThreshold??2)}"></div><div class="field full"><label>Purchase link <span class="optional-note">(optional)</span></label><input class="input" name="purchaseUrl" type="url" placeholder="https://…" value="${esc(item?.purchaseUrl||'')}"></div><div class="field full"><label>Notes <span class="optional-note">(optional)</span></label><textarea class="textarea" name="notes" maxlength="300" placeholder="Supplier, shade, storage…">${esc(item?.notes||'')}</textarea></div></div>${formActions('Cancel',editing?'Save changes':kind==='consumable'?'Add consumable':'Save item')}</form>`,{neutralEntry:true,subtitle:kind==='consumable'?'Track the useables you use and the quantity you have in stock.':'Keep track of the products and materials you use in your studio.'});bindInventoryUnitLabel($('#modal-root'));bindUnitCostCalculator($('#modal-root'));wireForm(fd=>{const name=String(fd.get('name')||'').trim(),quantity=num(fd.get('quantity')),unit=String(fd.get('unit')||'').trim(),cost=num(fd.get('unitCost')),threshold=num(fd.get('threshold'));if(!name||!unit||quantity===null||quantity<0||threshold===null||threshold<0||cost===null||cost<0)return err('Enter a name, unit, and valid non-negative quantities and cost.');const purchaseUrl=String(fd.get('purchaseUrl')||'').trim();if(purchaseUrl&&!/^https?:\/\//i.test(purchaseUrl))return err('Enter a link starting with http:// or https://.');const values={name,quantity,unit,unitCost:cost,lowStockThreshold:threshold,category:kind==='consumable'?'useable':'supply',notes:String(fd.get('notes')||'').trim(),purchaseUrl};if(editing)Object.assign(item,values);else state.inventory.push({id:id(),...values});if(!save())return;closeModal();render()})}
function deleteInventory(itemId){const item=state.inventory.find(entry=>entry.id===itemId);if(!item||!confirm(`Remove “${item.name}” from ${item.category==='consumable'?'useables':'supplies'}? Its links to services and extras will also be removed.`))return;state.inventory=state.inventory.filter(entry=>entry.id!==itemId);for(const record of [...state.services,...state.extras])record.inventoryUsage=(record.inventoryUsage||[]).filter(use=>use.itemId!==itemId);save();render()}
function shiftDate(date,n){const d=new Date(date);d.setDate(d.getDate()+n);return d}
function appointmentExtras(a){
  return (Array.isArray(a?.selectedExtras)?a.selectedExtras:[])
    .map(extra=>typeof extra==='string'?state.extras.find(item=>item.id===extra)||{id:extra,name:'Saved extra',price:0,durationMinutes:0,materialCost:0}:{...extra})
    .filter(Boolean);
}
function appointmentServiceSnapshot(a){
  if(!a?.serviceId)return null;
  const service=state.services.find(item=>item.id===a.serviceId);
  return {
    id:a.serviceId,
    name:a.serviceNameSnapshot||service?.name||'Saved service',
    price:Number(a.servicePrice??service?.defaultPrice)||0,
    durationMinutes:Number(a.serviceDurationMinutes??service?.defaultDurationMinutes)||0,
  };
}
function appointmentInventoryUsage(serviceId,extras){const service=state.services.find(item=>item.id===serviceId);const combined=[...(service?.inventoryUsage||[]),...extras.flatMap(extra=>(state.extras.find(item=>item.id===extra.id)||extra).inventoryUsage||[])].filter(use=>state.inventory.find(item=>item.id===use.itemId)?.category!=='consumable');const totals=new Map();for(const use of combined)totals.set(use.itemId,(totals.get(use.itemId)||0)+(Number(use.quantity)||0));return [...totals].map(([itemId,quantity])=>({itemId,quantity}))}
function currentAppointmentInventoryUsage(appointment){const totals=new Map();for(const use of Array.isArray(appointment.inventoryUsageSnapshot)?appointment.inventoryUsageSnapshot:[])totals.set(use.itemId,Math.max(0,Number(use.quantity)||0));for(const use of appointmentInventoryUsage(appointment.serviceId,appointmentExtras(appointment)))totals.set(use.itemId,Math.max(totals.get(use.itemId)||0,Number(use.quantity)||0));return [...totals].filter(([,quantity])=>quantity>0).map(([itemId,quantity])=>({itemId,quantity}))}
function renderAppointments({embedded=false}={}){
  const selectedDate=calendar.date instanceof Date?calendar.date:new Date();
  const firstDate=new Date(calendar.startDate instanceof Date?calendar.startDate:selectedDate);firstDate.setHours(0,0,0,0);
  const weekDays=Array.from({length:7},(_,index)=>shiftDate(firstDate,index));
  const selectedISO=localDate(selectedDate);
  const appointments=state.appointments.filter(item=>item&&item.status!=='completed'&&dateFromISO(item.date)).sort((a,b)=>String(a.time||'').localeCompare(String(b.time||''))||String(a.clientName||'').localeCompare(String(b.clientName||'')));
  const weekAppointments=appointments.filter(item=>weekDays.some(day=>localDate(day)===item.date));
  const dayAppointments=weekAppointments.filter(item=>item.date===selectedISO);
  const heading=weekDays[0].toLocaleDateString(undefined,{month:'short',day:'numeric'})+' – '+weekDays[6].toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  const weekPicker=weekDays.map(day=>{
    const dayISO=localDate(day),isSelected=dayISO===selectedISO,isToday=dayISO===localDate();
    const count=weekAppointments.filter(item=>item.date===dayISO).length;
    return '<button class="planner-day '+(isSelected?'is-selected ':'')+(isToday?'is-today':'')+'" data-action="cal-select-day" data-id="'+dayISO+'" aria-label="'+day.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})+', '+count+' appointments" aria-pressed="'+isSelected+'"><span>'+day.toLocaleDateString(undefined,{weekday:'short'})+'</span><strong>'+day.getDate()+'</strong><i class="planner-day-count '+(count?'has-bookings':'')+'" aria-hidden="true">'+(count||'')+'</i></button>';
  }).join('');
  const entries=dayAppointments.map(item=>{
    const extras=appointmentExtras(item);
    const description=[item.serviceNameSnapshot&&item.serviceNameSnapshot!=='Extras only'?item.serviceNameSnapshot:'',...extras.map(extra=>extra.name)].filter(Boolean).join(' · ')||'Appointment';
    const completed=item.status==='completed';
    const expired=!completed&&item.date<localDate();
    return '<button class="planner-booking '+(completed?'is-completed':expired?'is-expired':'')+'" data-action="view-appointment" data-id="'+esc(item.id)+'"><span class="planner-booking-time">'+esc(item.time||'')+'</span><span class="planner-booking-rule" aria-hidden="true"></span><span class="planner-booking-details"><strong>'+esc(item.clientName||'Client')+'</strong><small>'+esc(description)+'</small></span><span class="planner-booking-meta"><strong>'+money(item.price)+'</strong><small>'+(completed?'Completed':expired?'Expired':'Booked')+'</small></span><span class="planner-booking-arrow" aria-hidden="true">&rarr;</span></button>';
  }).join('');
  const selectedDay=selectedDate.getDate(),ordinalSuffix=selectedDay%100>=11&&selectedDay%100<=13?'th':selectedDay%10===1?'st':selectedDay%10===2?'nd':selectedDay%10===3?'rd':'th';
  const selectedLabel=selectedDate.toLocaleDateString(undefined,{weekday:'long'})+', '+selectedDay+ordinalSuffix+' of '+selectedDate.toLocaleDateString(undefined,{month:'long'});
  const agenda=dayAppointments.length?'<div class="planner-bookings">'+entries+'</div>':'<p class="empty-helper">Nothing booked for this day. Select another date or use + to book an appointment.</p>';
  return (embedded?'':header('','Schedule'))+'<section class="planner-card"><div class="planner-toolbar"><div class="planner-week-nav"><button class="planner-arrow" data-action="cal-prev" aria-label="Previous week">&lsaquo;</button><button class="planner-today" data-action="cal-today">Today</button><button class="planner-arrow" data-action="cal-next" aria-label="Next week">&rsaquo;</button><strong>'+heading+'</strong></div><span class="planner-week-total">'+weekAppointments.length+' <small>THIS WEEK</small></span></div><div class="planner-week" role="group" aria-label="Choose a day">'+weekPicker+'</div><div class="planner-agenda"><div class="planner-agenda-heading"><div><h2>'+selectedLabel+(dayAppointments.length?' · Booked appointments':'')+'</h2></div><span class="planner-day-total">'+dayAppointments.length+' '+(dayAppointments.length===1?'appointment':'appointments')+'</span></div>'+agenda+'</div></section>'+renderScheduleClients()+'<button class="fab" data-action="new-appointment" aria-label="Add appointment">+</button>';
}
function bindUnitCostCalculator(root=document){$$('[data-unit-quantity]',root).forEach(quantity=>{if(quantity.dataset.costCalculatorBound)return;const form=quantity.closest('form'),total=$('[data-unit-total]',form),result=$('[data-unit-result]',form),cost=form?.querySelector('[name="unitCost"]'),unitSelect=$('[data-inventory-unit]',form);if(!form||!total||!result||!cost)return;quantity.dataset.costCalculatorBound='true';let lastCalculated='';const unitInfo=()=>inventoryUnitInfo(unitSelect?.value||'units');const update=()=>{const info=unitInfo(),q=num(quantity.value),spent=num(total.value);if(q===null||q<=0||spent===null||spent<0){result.textContent=`Enter quantity and total cost to calculate the ${info.costLabel.toLowerCase()}.`;if(lastCalculated&&cost.value===lastCalculated){cost.value='';cost.dispatchEvent(new Event('input',{bubbles:true}))}lastCalculated='';return}const unitCost=spent/q,precision=['ml','fl oz','g'].includes(info.key)?6:2;lastCalculated=unitCost.toFixed(precision);result.textContent=`${info.costLabel}: ${inventoryCostAmount(unitCost,unitSelect?.value)}`;cost.value=lastCalculated;cost.dispatchEvent(new Event('input',{bubbles:true}))};quantity.addEventListener('input',update);total.addEventListener('input',update);unitSelect?.addEventListener('change',update);update()})}
function confirmEmptySetupStep(type,nextAction,continueLabel,continueCallback){
  const listName=type==='inventory'?'supplies':type;
  modal('No '+type+' added','<p class="confirm-copy">You haven’t added any '+listName+'. Are you sure you want to '+nextAction+'? You can add '+listName+' later.</p><div class="modal-actions"><button class="btn" data-empty-step-stay>Stay here</button><button class="btn btn-primary" data-empty-step-continue>'+continueLabel+'</button></div>');
  $('[data-empty-step-stay]').addEventListener('click',closeModal);
  $('[data-empty-step-continue]').addEventListener('click',()=>{closeModal();continueCallback()});
}
function advanceSetupStep(){
  setupStep=Math.min(4,setupStep+1);
  render();
  const introKind={1:'inventory',2:'service',3:'extra',4:'consumable'}[setupStep];
  if(introKind&&!setupIntrosSeen[introKind]){setupIntrosSeen[introKind]=true;showSetupIntro(introKind)}
}
function requestSetupNext(){
  if(setupStep===1&&!state.inventory.some(item=>item.category!=='consumable'))return confirmEmptySetupStep('inventory','continue to Services','Continue anyway',advanceSetupStep);
  if(setupStep===2&&!state.services.length)return confirmEmptySetupStep('services','continue to Extras','Continue anyway',advanceSetupStep);
  advanceSetupStep();
}
function finishSetup(){setupStep=5;setupComplete=true;localStorage.setItem(userStorageKey(SETUP_KEY),'true');save();render()}
function requestSetupComplete(){
  if(!state.extras.length)return confirmEmptySetupStep('extras','finish setup','Finish setup anyway',finishSetup);
  finishSetup();
}
function showSetupIntro(kind){
  const intro={
    inventory:{title:'Your Supplies',copy:'Add supplies to link to services and extras. Choose a unit, enter the stock quantity and alert threshold, and set the required cost per unit. Calculate divides package total cost by package quantity.'},
    service:{title:'Your Services',copy:'Services are the main treatments or offerings a client books. Set a default price and duration, then link the supplies and quantities used so estimates include their cost and appointments can track stock.'},
    extra:{title:'Your Extras',copy:'Extras are optional add-ons, such as nail art or repairs. Set a price and duration, link the supplies and quantities used, and offer extras with a service or on their own.'},
    consumable:{title:'Your Useables',copy:'Add items you use during services. Enter their actual quantities in Studio Log when saving a calculation or when completing an appointment; cost and stock update from the entered amount.'}
  }[kind];
  modal(intro.title,'<p class="confirm-copy">'+intro.copy+'</p><div class="modal-actions"><button class="btn btn-primary" data-setup-intro-confirm>I understand</button></div>');
  $('[data-setup-intro-confirm]').addEventListener('click',closeModal);
}
function bindPage(){
  $$('.nav-item,[data-page]').forEach(b=>{b.onclick=()=>{page=b.dataset.page;if(page==='setup'&&setupComplete)setupStep=1;if(page==='studio')calc.inputsOpen=true;render()}});
  $('#security-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,fd=new FormData(form),status=$('#security-status');
    const currentPassword=String(fd.get('currentPassword')||''),newPassword=String(fd.get('newPassword')||''),confirmPassword=String(fd.get('confirmPassword')||'');
    if(newPassword.length<8){status.textContent='Use at least 8 characters for your new password.';return}
    if(newPassword!==confirmPassword){status.textContent='The new passwords do not match.';return}
    const {error:verifyError}=await supabase.auth.signInWithPassword({email:activeUser.email,password:currentPassword});
    if(verifyError){status.textContent='Your current password is incorrect.';return}
    const {error}=await supabase.auth.updateUser({password:newPassword});
    if(error){status.textContent=error.message;return}
    status.textContent='Password updated.';
    form.reset();
  });
  $('#username-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,fd=new FormData(form),status=$('#username-status');
    const currentPassword=String(fd.get('currentPassword')||''),newUsername=String(fd.get('newUsername')||'').trim();
    if(!newUsername){status.textContent='Enter a new username.';return}
    const {error:verifyError}=await supabase.auth.signInWithPassword({email:activeUser.email,password:currentPassword});
    if(verifyError){status.textContent='Your current password is incorrect.';return}
    const {error}=await supabase.auth.updateUser({data:{username:newUsername}});
    if(error){status.textContent=error.message;return}
    status.textContent='Username updated.';
    form.reset();
  });
  $$('[data-color-preset]').forEach(button=>button.addEventListener('click',()=>setThemeColors(button.dataset.primary,button.dataset.secondary)));
  $$('.theme-color-control[data-wheel-target]').forEach(button=>button.addEventListener('click',()=>{wheelTarget=button.dataset.wheelTarget;updateThemeControls()}));
  $('[data-save-colours]')?.addEventListener('click',()=>{const input=$('#saved-colour-name'),name=input?.value.trim();if(!name){input?.focus();toast('Enter a name for this colour set.');return}if(savedColorPalettes.some(item=>item.primary===themeColors.primary&&item.secondary===themeColors.secondary)){toast('These colours are already saved.');return}savedColorPalettes.push({...themeColors,name:name.slice(0,32)});try{localStorage.setItem(SAVED_COLOR_PALETTES_KEY,JSON.stringify(savedColorPalettes));render()}catch(error){savedColorPalettes.pop();console.error('Could not save colour palette.',error);toast('Your browser could not save these colours.')}});
  $$('[data-rename-palette]').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.renamePalette),input=$(`[data-palette-name="${index}"]`),name=input?.value.trim();if(!name){input?.focus();toast('Enter a name for this colour set.');return}const previous=savedColorPalettes[index].name;savedColorPalettes[index].name=name.slice(0,32);try{localStorage.setItem(SAVED_COLOR_PALETTES_KEY,JSON.stringify(savedColorPalettes));render()}catch(error){savedColorPalettes[index].name=previous;console.error('Could not rename colour palette.',error);toast('Your browser could not save this name.')}}));
  $$('[data-delete-palette]').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.deletePalette),[removed]=savedColorPalettes.splice(index,1);try{localStorage.setItem(SAVED_COLOR_PALETTES_KEY,JSON.stringify(savedColorPalettes));render()}catch(error){savedColorPalettes.splice(index,0,removed);console.error('Could not delete colour palette.',error);toast('Your browser could not remove these colours.')}}));
  const wheel=$('.colour-wheel');
  if(wheel){
    const selectAt=event=>{const rect=wheel.getBoundingClientRect(),dx=(event.clientX-(rect.left+rect.width/2))/(rect.width/2),dy=(event.clientY-(rect.top+rect.height/2))/(rect.height/2),radius=Math.min(1,Math.hypot(dx,dy)),hue=(Math.atan2(dy,dx)*180/Math.PI+90+360)%360,saturation=radius*100,color=hslHex(hue,saturation,100-saturation*.5);setThemeColors(wheelTarget==='primary'?color:themeColors.primary,wheelTarget==='secondary'?color:themeColors.secondary)};
    wheel.addEventListener('pointerdown',event=>{wheel.setPointerCapture(event.pointerId);selectAt(event)});
    wheel.addEventListener('pointermove',event=>{if(event.buttons)selectAt(event)});
    wheel.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const direction=event.key==='ArrowRight'||event.key==='ArrowUp'?1:-1,{h,s}=hexToHsl(themeColors[wheelTarget]),hue=(h+(event.shiftKey?0:direction*5)+360)%360,saturation=Math.max(0,Math.min(100,s+(event.shiftKey?direction*5:0))),color=hslHex(hue,saturation,100-saturation*.5);setThemeColors(wheelTarget==='primary'?color:themeColors.primary,wheelTarget==='secondary'?color:themeColors.secondary)});
  }
  $$('[data-catalog-tab]').forEach(button=>button.addEventListener('click',()=>{catalogTab=button.dataset.catalogTab;render()}));
  $$('[data-setup-form]').forEach(form=>form.addEventListener('submit',e=>{
    e.preventDefault();
    const fd=new FormData(form),kind=form.dataset.setupForm,name=String(fd.get('name')||'').trim();
    if(kind==='inventory'||kind==='consumable'){
      const quantity=num(fd.get('quantity')),unit=String(fd.get('unit')||'').trim(),unitCost=num(fd.get('unitCost')),threshold=num(fd.get('threshold'));
      if(!name||quantity===null||quantity<0||!unit||unitCost===null||unitCost<0||threshold===null||threshold<0)return;
      const purchaseUrl=String(fd.get('purchaseUrl')||'').trim();
      if(purchaseUrl&&!/^https?:\/\//i.test(purchaseUrl))return;
      const item={id:id(),name,quantity,unit,unitCost,lowStockThreshold:threshold,category:kind==='consumable'?'useable':'supply',notes:'',purchaseUrl};
      state.inventory.push(item);
      if(!save()){state.inventory.pop();return}
      render();
      return;
    }
    const inventoryUsage=readInventoryUsage(form);if(!inventoryUsage)return;
    const price=num(fd.get('price')),duration=num(fd.get('duration')),minutes=duration*(fd.get('unit')==='Hours'?60:1);
    if(!name||price===null||price<0||duration===null||duration<0||!Number.isFinite(minutes))return;
    const item=kind==='service'?{id:id(),name,defaultPrice:price,defaultDurationMinutes:minutes,inventoryUsage,extras:[]}:{id:id(),name,price,durationMinutes:minutes,inventoryUsage};
    const list=kind==='service'?state.services:state.extras;
    list.push(item);
    if(!save()){list.pop();return}
    render();
  }));
  $$('[data-setup-form="inventory"], [data-setup-form="consumable"]').forEach(bindInventoryUnitLabel);
  if($('[data-setup-form]'))bindUsageEditor();
  bindUnitCostCalculator();
  $('.breakdown-details')?.addEventListener('toggle',e=>{calc.breakdownOpen=e.currentTarget.open});
  $('.calc-input-details')?.addEventListener('toggle',e=>{calc.inputsOpen=e.currentTarget.open});
  $('.fees-section')?.addEventListener('toggle',e=>{calc.feesOpen=e.currentTarget.open});
  $('.discount-details:not(.gst-details)')?.addEventListener('toggle',e=>{calc.discountsOpen=e.currentTarget.open;updateDiscountPreview();updateLive()});
  $('.gst-details')?.addEventListener('toggle',e=>{calc.gstOpen=e.currentTarget.open;updateDiscountPreview();updateLive()});
  $('.tax-details')?.addEventListener('toggle',e=>{calc.taxOpen=e.currentTarget.open;updateDiscountPreview();updateLive()});
  const bindPercentPicker=(id,key,attribute)=>{
    const picker=$('#'+id);if(!picker)return;
    const current=()=>Number(calc[key])||0;
    const percentageScrollTop=percent=>percent/100*Math.max(0,picker.scrollHeight-picker.clientHeight);
    picker.scrollTop=current()?percentageScrollTop(current()):0;
    const selectPercent=(percent,center=false)=>{
      percent=Math.max(0,Math.min(100,Math.round(percent)));calc[key]=percent;
      $$('[data-'+attribute+'-percent]',picker).forEach(choice=>{const selected=Number(choice.dataset[attribute+'Percent'])===percent;choice.classList.toggle('selected',selected);choice.setAttribute('aria-pressed',String(selected))});
      if(key==='discountPercent'){const reason=$('#discount-reason');if(reason){reason.required=percent>0;if(percent)reason.setAttribute('aria-required','true');else reason.removeAttribute('aria-required')}}
      if(center)picker.scrollTo({top:percentageScrollTop(percent),behavior:'smooth'});
      updateDiscountPreview();updateLive();
    };
    picker.addEventListener('keydown',event=>{
      if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();
      if(event.key==='Home')selectPercent(0,true);else if(event.key==='End')selectPercent(100,true);else selectPercent(current()+(event.key==='ArrowDown'?1:-1),true);
    });
    let scrollTimer;
    picker.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{const maxScroll=Math.max(1,picker.scrollHeight-picker.clientHeight),percent=Math.max(0,Math.min(100,Math.round(picker.scrollTop/maxScroll*100)));selectPercent(percent,false)},110)},{passive:true});
    $$('[data-'+attribute+'-percent]',picker).forEach(button=>button.addEventListener('click',()=>selectPercent(Number(button.dataset[attribute+'Percent']),true)));
  };
  bindPercentPicker('discount-picker','discountPercent','discount');
  bindPercentPicker('gst-picker','gstPercent','gst');
  bindPercentPicker('tax-picker','taxPercent','tax');
  $('#discount-reason')?.addEventListener('input',event=>{calc.discountReason=event.target.value;updateLive()});
  $('#calc-service')?.addEventListener('change',e=>{calc.customService=e.target.value==='__custom__';calc.serviceId=calc.customService?'':e.target.value;calc.customName='';calc.customNotes='';calc.material='';calc.price='';calc.time='';calc.unit=durationInputParts(selectedService()?.defaultDurationMinutes).unit;calc.adjustmentType='add';calc.adjustmentAmount='';calc.adjustmentOpen=false;render()});
  $$('.additional-service-select').forEach(select=>select.addEventListener('change',e=>{calc.additionalServiceIds[Number(e.target.dataset.index)]=e.target.value;render()}));
  ['calc-price','calc-time','calc-material-cost'].forEach(k=>$('#'+k)?.addEventListener('input',e=>{if(k==='calc-price')calc.price=e.target.value;if(k==='calc-time')calc.time=e.target.value;if(k==='calc-material-cost')calc.material=e.target.value;updateLive()}));
  $('#calc-custom-name')?.addEventListener('input',e=>{calc.customName=e.target.value});
  $('#calc-custom-notes')?.addEventListener('input',e=>{calc.customNotes=e.target.value});
  $('#calc-client')?.addEventListener('input',e=>{calc.client=e.target.value;const saveButton=$('[data-action="save-calculation"]');if(saveButton)saveButton.disabled=!calc.client.trim()});
  $('#calc-unit')?.addEventListener('change',e=>{calc.unit=e.target.value;updateLive()});
  $('#calc-adjust-type')?.addEventListener('change',e=>{calc.adjustmentType=e.target.value;updateLive()});
  $('#calc-adjust-amount')?.addEventListener('input',e=>{calc.adjustmentAmount=e.target.value;updateLive()});
  $$('.calc-extra').forEach(e=>e.addEventListener('change',()=>{calc.extras=$$('.calc-extra:checked').map(x=>x.value);render()}));
  $$('.calc-consumable-quantity').forEach(input=>input.addEventListener('input',event=>{const field=event.currentTarget,item=state.inventory.find(entry=>entry.id===field.dataset.consumableId),quantity=num(field.value);calc.consumableUsage=calc.consumableUsage||{};calc.consumableUsage[field.dataset.consumableId]=field.value;field.closest('.calc-consumable-row')?.classList.toggle('selected',(quantity||0)>0);const cost=$(`[data-consumable-cost="${field.dataset.consumableId}"]`);if(cost)cost.textContent=`${quantity||0} ${inventoryUnitInfo(item?.unit).short} used · ${inventoryUnitCostText(item)} · ${money((quantity||0)*(Number(item?.unitCost)||0))} total`;updateLive()}));
  $('#schedule-client-search')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase();const items=state.calculations.filter(c=>`${c.clientName} ${c.serviceNameSnapshot} ${(c.extras||[]).map(x=>x.name).join('')}`.toLowerCase().includes(q));$('#schedule-client-entries').innerHTML=renderCalculationRows(items);bindActions($('#schedule-client-entries'))});
  bindActions(document);
}
function bindActions(container){container.querySelectorAll('[data-action]').forEach(b=>{if(b.dataset.actionBound)return;b.dataset.actionBound='true';b.addEventListener('click',e=>{if(e.target.closest('.extra-row')&&!e.target.closest('button'))return;const el=e.currentTarget;handleAction(el.dataset.action,el.dataset.id,el.dataset.mode,el.dataset.index)});if(b.getAttribute('role')==='button')b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();b.click()}})})}
function updateLive(){
  const root=$('#main'),preview=document.createElement('div');preview.innerHTML=renderCalculator();
  const nextResults=preview.querySelector('.results-card'),currentResults=root.querySelector('.results-card');
  if(nextResults&&currentResults){currentResults.innerHTML=nextResults.innerHTML;enhanceStudioResults(root);bindActions(currentResults);$('.breakdown-details',currentResults)?.addEventListener('toggle',e=>{calc.breakdownOpen=e.currentTarget.open})}
  const currentSave=root.querySelector('.save-bar'),nextSave=preview.querySelector('.save-bar');
  if(!nextSave){currentSave?.remove()}else if(!currentSave){root.append(nextSave);bindActions(nextSave)}else{const button=currentSave.querySelector('[data-action="save-calculation"]');if(button)button.disabled=!calc.client.trim()}
}
function handleAction(action,itemId,mode,index){
  if(action==='setup-next')requestSetupNext(); if(action==='setup-back'){setupStep=2;render()} if(action==='setup-services-back'){setupStep=1;render()} if(action==='setup-consumables-back'){setupStep=3;render()} if(action==='setup-skip'||action==='setup-start'){setupComplete=true;localStorage.setItem(userStorageKey(SETUP_KEY),'true');page='schedule';save();render()} if(action==='setup-complete')requestSetupComplete(); if(action==='setup-exit'){page='schedule';render()} if(action==='sign-out')signOut();
  if(action==='page-help')showPageHelp();
  if(action==='add-additional-service'){calc.additionalServiceIds=calc.additionalServiceIds||[];calc.additionalServiceIds.push('');render()} if(action==='remove-additional-service'){calc.additionalServiceIds.splice(Number(index),1);render()}
  if(action==='reset-app')confirmReset(false);
  if(action==='dev-reset')confirmReset(true);
  if(action==='backup-restore')openBackupRestore();
  if(action==='setup-sync')openSetupSync();
  if(action==='delete-service-setup'){const s=state.services.find(x=>x.id===itemId);if(s&&confirm(`Delete “${s.name}”?`)){state.services=state.services.filter(x=>x.id!==itemId);calc.additionalServiceIds=(calc.additionalServiceIds||[]).filter(serviceId=>serviceId!==itemId);if(calc.serviceId===itemId){calc.serviceId='';calc.price='';calc.time='';calc.extras=[]}save();render()}}
  if(action==='delete-extra-setup'){const x=state.extras.find(e=>e.id===itemId);if(x&&confirm(`Delete “${x.name}”?`)){state.extras=state.extras.filter(e=>e.id!==itemId);calc.extras=calc.extras.filter(xid=>xid!==itemId);save();render()}}
  if(action==='new-service')openService(); if(action==='edit-service')openService(itemId); if(action==='new-extra')openExtra(); if(action==='edit-extra')openExtra(itemId); if(action==='save-calculation')saveCalculation();
  if(action==='new-calculation'){calc={serviceId:'',additionalServiceIds:[],price:'',time:'',unit:'Minutes',material:'',client:'',extras:[],consumableUsage:{},adjustmentType:'add',adjustmentAmount:'',adjustmentOpen:false,discountPercent:0,discountReason:'',discountsOpen:false,gstPercent:0,gstOpen:false,taxPercent:0,taxOpen:false,feesOpen:false,customService:false,customName:'',customNotes:'',inputsOpen:true,breakdownOpen:false};page='studio';render()}
  if(action==='new-inventory')openInventory(); if(action==='edit-inventory')openInventory(itemId,state.inventory.find(item=>item.id===itemId)?.category==='consumable'?'useable':'supply'); if(action==='delete-inventory')deleteInventory(itemId);
  if(action==='catalog-add'){if(catalogTab==='services')openService();else if(catalogTab==='extras')openExtra();else openInventory(null,catalogTab==='consumables'?'useable':'supply')}
  if(action==='toggle-adjustment'){calc.adjustmentOpen=!calc.adjustmentOpen;updateLive()}
  if(action==='new-goal'||action==='edit-goal')openGoal(); if(action==='new-appointment')openAppointment();
  if(action==='view-calculation')openCalculationDetail(itemId); if(action==='export-receipt')exportReceipt(itemId); if(action==='view-appointment')openAppointmentDetail(itemId);
  if(action==='cal-prev'){calendar.startDate=shiftDate(calendar.startDate||calendar.date,calendar.mode==='day'?-1:-7);calendar.date=shiftDate(calendar.date,calendar.mode==='day'?-1:-7);render()} if(action==='cal-next'){calendar.startDate=shiftDate(calendar.startDate||calendar.date,calendar.mode==='day'?1:7);calendar.date=shiftDate(calendar.date,calendar.mode==='day'?1:7);render()} if(action==='cal-today'){calendar.date=new Date();calendar.startDate=new Date();render()} if(action==='cal-mode'){calendar.mode=mode;render()}
  if(action==='cal-select-day'){calendar.date=dateFromISO(itemId)||calendar.date;render()}
}
function createBackupPayload(){
  return {format:'polished-backup',version:1,exportedAt:new Date().toISOString(),setupComplete,data:{services:state.services,extras:state.extras,inventory:state.inventory,calculations:state.calculations,appointments:state.appointments,goal:state.goal,themeColors:{...themeColors},savedColorPalettes:savedColorPalettes.map(palette=>({...palette}))}};
}
function encodeBackup(payload){
  const bytes=new TextEncoder().encode(JSON.stringify(payload));let binary='';
  for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return 'PB1.'+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decodeBackup(value){
  const input=String(value||'').trim();if(!input)throw new Error('Paste a backup code or choose a backup file.');
  if(input[0]==='{')return JSON.parse(input);
  const code=input.replace(/\s/g,'');
  const raw=code.startsWith('PB1.')?code.slice(4):code;
  const base64=raw.replace(/-/g,'+').replace(/_/g,'/');
  const binary=atob(base64+'='.repeat((4-base64.length%4)%4));
  const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
function normalizedBackup(payload){
  const data=payload?.data||payload?.state;
  if(payload?.format!=='polished-backup'||payload?.version!==1||!data||!['services','extras','inventory','calculations','appointments'].every(key=>Array.isArray(data[key])))throw new Error('This backup is invalid or from an unsupported version.');
  const {themeColors:backupColors,savedColorPalettes:backupPalettes,...businessData}=data;
  const colors={primary:/^#[\da-f]{6}$/i.test(backupColors?.primary||'')?backupColors.primary:DEFAULT_THEME_COLOR,secondary:/^#[\da-f]{6}$/i.test(backupColors?.secondary||'')?backupColors.secondary:DEFAULT_SECONDARY_COLOR};
  const palettes=Array.isArray(backupPalettes)?backupPalettes.filter(item=>/^#[\da-f]{6}$/i.test(item?.primary||'')&&/^#[\da-f]{6}$/i.test(item?.secondary||'')).map((item,index)=>({...item,name:String(item.name||`Saved ${index+1}`).slice(0,32)})):[];
  return {state:{...blankState(),...businessData,goal:data.goal&&typeof data.goal==='object'?data.goal:{targetProfit:0}},themeColors:backupColors?colors:null,savedColorPalettes:Array.isArray(backupPalettes)?palettes:null};
}
function restoreBackup(payload){
  const restored=normalizedBackup(payload),keys=[userStorageKey(STORAGE_KEY),userStorageKey(SETUP_KEY),THEME_COLOR_KEY,SAVED_COLOR_PALETTES_KEY],oldValues=new Map(keys.map(key=>[key,localStorage.getItem(key)]));
  try{
    localStorage.setItem(userStorageKey(STORAGE_KEY),JSON.stringify(restored.state));localStorage.setItem(userStorageKey(SETUP_KEY),'true');
    if(restored.themeColors)localStorage.setItem(THEME_COLOR_KEY,JSON.stringify(restored.themeColors));
    if(restored.savedColorPalettes)localStorage.setItem(SAVED_COLOR_PALETTES_KEY,JSON.stringify(restored.savedColorPalettes));
  }catch(error){for(const [key,value] of oldValues){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}catch{}}throw new Error('Your browser could not store this backup. Try the file on a device with more available storage.')}
  state=restored.state;if(restored.themeColors)themeColors=restored.themeColors;if(restored.savedColorPalettes)savedColorPalettes=restored.savedColorPalettes;applyThemeColors(themeColors.primary,themeColors.secondary);setupComplete=true;page='schedule';save();
  return true;
}
async function copyText(text){
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return}
  const field=document.createElement('textarea');field.value=text;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();const copied=document.execCommand('copy');field.remove();if(!copied)throw new Error('Clipboard access is unavailable. Select and copy the text instead.');
}
function downloadBackup(payload=createBackupPayload()){
  const file=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(file),link=document.createElement('a');
  link.href=url;link.download='polished-backup-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function openBackupRestore(){
  const code=encodeBackup(createBackupPayload());
  const content='<section class="backup-section"><div class="backup-section-heading"><strong>Backup code</strong><span>Use this code to move your data to another device.</span></div><textarea class="textarea backup-code" aria-label="Backup code" readonly>'+esc(code)+'</textarea><div class="backup-actions"><button class="btn btn-primary" type="button" data-backup-copy>Copy Backup Code</button><button class="btn" type="button" data-backup-link>Copy Transfer Link</button><button class="btn" type="button" data-backup-download>Download File Backup (.json)</button></div></section><section class="backup-section"><div class="backup-section-heading"><strong>Paste &amp; Restore</strong><span>Paste a backup code from another device.</span></div><textarea class="textarea" data-backup-paste aria-label="Paste backup code" placeholder="Paste backup code here"></textarea><div class="backup-actions"><button class="btn btn-primary" type="button" data-backup-restore>Restore Data</button><button class="btn" type="button" data-backup-upload>Upload File Backup</button><input type="file" accept=".json,application/json" data-backup-file hidden></div></section>';
  modal('Backup & Restore',content,{wide:true,subtitle:'Keep a portable copy of your clients, appointments, services, extras, and supplies.'});
  $('[data-backup-copy]').onclick=async()=>{try{await copyText(code);toast('Backup code copied.')}catch(error){toast(error.message)}};
  $('[data-backup-link]').onclick=async()=>{const url=new URL(location.href);url.searchParams.set('sync',code);if(url.href.length>6000){toast('This backup is too large for a transfer link. Download the JSON file instead.');return}try{await copyText(url.href);toast('Transfer link copied.')}catch(error){toast(error.message)}};
  $('[data-backup-download]').onclick=()=>{downloadBackup();toast('Backup file downloaded.')};
  $('[data-backup-restore]').onclick=()=>{try{restoreBackup(decodeBackup($('[data-backup-paste]').value));closeModal();render();toast('Backup restored successfully.')}catch(error){toast(error.message)}};
  $('[data-backup-upload]').onclick=()=> $('[data-backup-file]').click();
  $('[data-backup-file]').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{const payload=JSON.parse(await file.text());restoreBackup(payload);closeModal();render();toast('Backup file restored successfully.')}catch(error){toast(error.message||'Could not read this backup file.')}finally{event.target.value=''}};
}
function decodeSyncInput(value){
  const input=String(value||'').trim();
  try{const url=new URL(input);const code=url.searchParams.get('sync');if(code)return decodeBackup(code)}catch{}
  return decodeBackup(input);
}
function openSetupSync(){
  const content='<section class="backup-section"><div class="backup-section-heading"><strong>Import from another device</strong><span>Paste a sync link or code below.</span></div><textarea class="textarea" data-sync-paste aria-label="Paste sync link or code" placeholder="Paste a sync link or code here"></textarea><div class="backup-actions"><button class="btn btn-primary" type="button" data-sync-restore>Import Data</button></div></section>';
  modal('Sync',content,{subtitle:'Import your studio data from another device.'});
  $('[data-sync-restore]').onclick=()=>{try{restoreBackup(decodeSyncInput($('[data-sync-paste]').value));closeModal();render();toast('Data synced successfully.')}catch(error){toast(error.message)}};
}
function processIncomingBackup(){
  if(!activeUser)return;
  const url=new URL(location.href),code=url.searchParams.get('sync');if(!code)return;
  const confirmed=confirm('Restore backup from link? This will load your studio data.');
  url.searchParams.delete('sync');history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  if(!confirmed)return;
  try{restoreBackup(decodeBackup(code));render();toast('Backup restored successfully.')}catch(error){toast(error.message||'Could not restore this backup link.')}
}
function confirmReset(requirePasscode=false){
  const title=requirePasscode?'Reset account data?':'Reset everything?';
  const copy=requirePasscode
    ?'This clears your studio data from this account, then signs you out. This cannot be undone.'
    :'This permanently clears your services, extras, supplies, appointments, and client records, then restarts setup. This cannot be undone.';
  modal(title,`<p class="confirm-copy">${copy}</p><div class="modal-actions"><button class="btn" data-modal-cancel>Cancel</button><button class="btn btn-danger" data-reset-confirm>${requirePasscode?'Reset &amp; Sign Out':'Reset Everything'}</button></div>`);
  $('[data-modal-cancel]').addEventListener('click',closeModal);
  $('[data-reset-confirm]').addEventListener('click',async()=>{
    state=blankState();setupComplete=false;setupStep=0;setupIntrosSeen={inventory:false,service:false,extra:false,consumable:false};page='setup';
    localStorage.setItem(userStorageKey(SETUP_KEY),'false');save();
    calc={serviceId:'',additionalServiceIds:[],price:'',time:'',unit:'Minutes',material:'',client:'',extras:[],consumableUsage:{},adjustmentType:'add',adjustmentAmount:'',adjustmentOpen:false,discountPercent:0,discountReason:'',discountsOpen:false,gstPercent:0,gstOpen:false,taxPercent:0,taxOpen:false,feesOpen:false,customService:false,customName:'',customNotes:'',inputsOpen:true,breakdownOpen:false};
    calendar={mode:'week',date:new Date(),startDate:new Date()};
    closeModal();
    if(requirePasscode){await signOut();return}
    render();
  });
}
async function signOut(){
  clearTimeout(cloudSyncTimer);
  if(cloudReady&&!cloudSyncUnavailable){cloudSyncChain=cloudSyncChain.then(syncCloudState).catch(error=>{console.error('Could not finish cloud sync before sign out.',error)});await cloudSyncChain}
  const {error}=await supabase.auth.signOut();
  if(error){toast(error.message||'Could not sign out. Try again.',5000,'error');return}
  location.replace('index.html#login');
}
function openPasswordRecovery(){
  const url=new URL(location.href);url.searchParams.delete('password-reset');history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  modal('Set a new password',`<form id="recovery-form"><div class="field"><label class="required">New password</label><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="modal-actions"><button class="btn btn-primary" type="submit">Update password</button></div></form>`);
  $('#recovery-form').addEventListener('submit',async event=>{event.preventDefault();const password=String(new FormData(event.currentTarget).get('password')||'');if(password.length<8){toast('Use at least 8 characters for your password.',4000,'error');return}const {error}=await supabase.auth.updateUser({password});if(error){toast(error.message||'Could not update the password.',5000,'error');return}closeModal();toast('Password updated.',3000,'success')});
}
function modal(title,content,{wide=false,subtitle='',neutralEntry=false}={}){
  const root=$('#modal-root');
  if(!$('.modal-backdrop',root))modalReturnFocus=document.activeElement;
  root.innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'wide':''} ${neutralEntry?'neutral-entry':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-header"><div><h2 id="modal-title">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><button class="close-modal" aria-label="Close">×</button></div>${content}</section></div>`;
  document.body.classList.add('modal-open');
  $('.close-modal',root).onclick=closeModal;
  $('.modal-backdrop',root).addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal()});
  document.onkeydown=e=>{
    if(e.key==='Escape'){closeModal();return}
    if(e.key==='Tab'){
      const dialog=$('.modal',root),items=$$('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',dialog).filter(el=>el.getClientRects().length);
      if(!items.length){e.preventDefault();dialog.focus();return}
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    }
  };
  requestAnimationFrame(()=>($('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])',root)||$('.modal',root)).focus());
}
function closeModal(){ $('#modal-root').innerHTML=''; document.body.classList.remove('modal-open'); document.onkeydown=null;if(modalReturnFocus?.isConnected)modalReturnFocus.focus();modalReturnFocus=null }
function err(msg){const e=$('.error-message');if(e){e.textContent=msg;e.setAttribute('role','alert');e.classList.add('show')}}
function formActions(cancel='Cancel',save='Save'){return `<div class="modal-actions"><button type="button" class="btn" data-modal-cancel>${cancel}</button><button type="submit" class="btn btn-primary">${save}</button></div>`}
function wireForm(onSubmit){const f=$('.modal form');if(!f)return;f.addEventListener('submit',async e=>{e.preventDefault();if(f.dataset.submitting==='true')return;f.dataset.submitting='true';f.setAttribute('aria-busy','true');const button=f.querySelector('button[type=submit]'),label=button?.textContent;button?.classList.add('is-loading');if(button)button.disabled=true;try{await onSubmit(new FormData(f));if(!f.isConnected)toast('Changes saved',3000,'success')}catch(error){console.error('Could not submit form.',error);err('Something went wrong. Your changes were not saved.')}finally{f.dataset.submitting='false';f.removeAttribute('aria-busy');if(button?.isConnected){button.classList.remove('is-loading');button.disabled=false;if(label)button.textContent=label}}});$('[data-modal-cancel]')?.addEventListener('click',closeModal)}
function openService(serviceId){
  const s=state.services.find(x=>x.id===serviceId), editing=!!s;
  const duration=durationInputParts(s?.defaultDurationMinutes);
  modal(editing?'Edit service':'Add service',`<form><div class="error-message"></div><div class="field"><label class="required">Service name</label><input class="input" name="name" required maxlength="60" placeholder="Service name" value="${esc(s?.name||'')}"></div><div class="form-grid"><div class="field"><label class="required">Default price</label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" name="price" type="number" min="0" step="0.01" required value="${esc(s?.defaultPrice??'')}"></span></div><div class="field"><label class="required">Default time</label><div class="input-group duration-input"><span class="duration-clock" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span><input class="input" name="duration" type="number" min="0" step="1" required value="${editing?esc(duration.value):''}"><select class="select" name="unit"><option ${duration.unit==='Minutes'?'selected':''}>Minutes</option><option ${duration.unit==='Hours'?'selected':''}>Hours</option></select></div></div></div>${inventoryUsageEditor('service',s)}${editing?'<div class="modal-actions modal-actions-spread"><button type="button" class="btn btn-danger" data-delete-service>Delete service</button><div class="modal-action-group"><button type="button" class="btn" data-modal-cancel>Cancel</button><button type="submit" class="btn btn-primary">Save changes</button></div></div>':formActions('Cancel','Save Service')}</form>`,{neutralEntry:true,subtitle:editing?'Historical calculations keep their saved details.':'Enter your own service details.'});
  bindUsageEditor();
  $('[data-delete-service]')?.addEventListener('click',()=>{if(confirm(`Delete “${s.name}”? Saved calculations will keep their historical details.`)){state.services=state.services.filter(x=>x.id!==s.id);calc.additionalServiceIds=(calc.additionalServiceIds||[]).filter(serviceId=>serviceId!==s.id);if(calc.serviceId===s.id){calc.serviceId='';calc.extras=[]}save();closeModal();render()}});
  wireForm(fd=>{const inventoryUsage=readInventoryUsage($('.modal form'));if(!inventoryUsage)return err('Choose a supply and enter a quantity greater than zero.');const name=fd.get('name').trim(),p=num(fd.get('price')),duration=num(fd.get('duration')),unit=fd.get('unit');if(!name)return err('Enter a service name.');if(p===null||p<0||duration===null||duration<0)return err('Enter valid zero or positive numbers for price and time.');const minutes=duration*(unit==='Hours'?60:1);if(!Number.isFinite(minutes))return err('Enter a valid service duration.');if(editing){Object.assign(s,{name,defaultPrice:p,defaultDurationMinutes:minutes,inventoryUsage})}else{const n={id:id(),name,defaultPrice:p,defaultDurationMinutes:minutes,inventoryUsage,extras:[]};state.services.push(n);calc.serviceId=n.id;calc.customService=false;calc.price='';calc.time='';calc.unit=unit;calc.extras=[]}save();closeModal();render()});
}
function openExtra(extraId){const e=state.extras.find(x=>x.id===extraId),editing=!!e,duration=durationInputParts(e?.durationMinutes);
  modal(editing?'Edit extra':'Add extra',`<form><div class="error-message"></div><div class="field"><label class="required">Extra name</label><input class="input" name="name" required maxlength="60" value="${esc(e?.name||'')}"></div><div class="form-grid"><div class="field"><label class="required">Extra price</label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" name="price" type="number" min="0" step="0.01" required value="${esc(e?.price??'')}"></span></div><div class="field"><label class="required">Extra time</label><div class="input-group duration-input"><span class="duration-clock" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span><input class="input" name="duration" type="number" min="0" step="1" required value="${editing?esc(duration.value):''}"><select class="select" name="unit"><option ${duration.unit==='Minutes'?'selected':''}>Minutes</option><option ${duration.unit==='Hours'?'selected':''}>Hours</option></select></div></div></div>${inventoryUsageEditor('extra',e)}${editing?'<div class="modal-actions modal-actions-spread"><button type="button" class="btn btn-danger" data-delete-extra>Delete extra</button><div class="modal-action-group"><button type="button" class="btn" data-modal-cancel>Cancel</button><button type="submit" class="btn btn-primary">Save changes</button></div></div>':formActions('Cancel','Save Extra')}</form>`,{neutralEntry:true,subtitle:'Extras can be used with any service or on their own.'});
  bindUsageEditor();
  $('[data-delete-extra]')?.addEventListener('click',()=>{if(confirm(`Delete “${e.name}”? Saved records keep their historical details.`)){state.extras=state.extras.filter(x=>x.id!==e.id);calc.extras=calc.extras.filter(x=>x!==e.id);save();closeModal();render()}});
  wireForm(fd=>{const inventoryUsage=readInventoryUsage($('.modal form'));if(!inventoryUsage)return err('Choose a supply and enter a quantity greater than zero.');const name=fd.get('name').trim(),p=num(fd.get('price')),d=num(fd.get('duration'));if(!name)return err('Enter an extra name.');if(p===null||p<0||d===null||d<0)return err('Enter valid zero or positive numbers for price and time.');const minutes=d*(fd.get('unit')==='Hours'?60:1);if(editing)Object.assign(e,{name,price:p,durationMinutes:minutes,inventoryUsage});else{const item={id:id(),name,price:p,durationMinutes:minutes,inventoryUsage};state.extras.push(item);calc.extras.push(item.id)}save();closeModal();render()});
}
function saveCalculation(){
  if((calc.additionalServiceIds||[]).some(serviceId=>!serviceId)){toast('Choose a service in each added service field or remove the empty field.');return}
  const v=currentValues();
  if(!v||!calc.client.trim())return;
  if(v.discountPercent&&!calc.discountReason.trim()){toast('Add a reason for the discount before saving.');$('#discount-reason')?.focus();return}
  if(num(calc.price)!==null&&num(calc.price)<0||timeMins(calc.time,calc.unit)!==null&&timeMins(calc.time,calc.unit)<0||calc.customService&&num(calc.material)!==null&&num(calc.material)<0){toast('Prices, time, and material cost must be zero or more.');return}
  const inventoryTotals=new Map();
  for(const use of [...v.inventoryUsage,...v.consumables])inventoryTotals.set(use.itemId,(inventoryTotals.get(use.itemId)||0)+(Number(use.quantity)||0));
  const inventoryUsageSnapshot=[...inventoryTotals].map(([itemId,quantity])=>({itemId,quantity}));
  const totals=new Map();
  for(const use of inventoryUsageSnapshot)totals.set(use.itemId,(totals.get(use.itemId)||0)+(Number(use.quantity)||0));
  const short=[];
  for(const [itemId,quantity] of totals){const item=state.inventory.find(entry=>entry.id===itemId);if(item&&Number(item.quantity)<quantity)short.push(`${item.name} (need ${quantity}, have ${Number(item.quantity)||0})`)}
  if(short.length){toast(`Not enough stock to save: ${short.join(', ')}.`,5000);return}
  const oldQuantities=[];
  for(const [itemId,quantity] of totals){const item=state.inventory.find(entry=>entry.id===itemId);if(item){oldQuantities.push([item,Number(item.quantity)||0]);item.quantity=(Number(item.quantity)||0)-quantity}}
  const serviceNames=[v.s?.name||(calc.customService?calc.customName.trim()||'Custom service':null),...(calc.additionalServiceIds||[]).map(serviceId=>state.services.find(service=>service.id===serviceId)?.name)].filter(Boolean);
  const record={id:id(),clientName:calc.client.trim(),serviceId:v.s?.id||null,additionalServiceIds:(calc.additionalServiceIds||[]).filter(Boolean),serviceNameSnapshot:serviceNames.join(' + ')||(v.manual?'Custom service':'Extras only'),notes:calc.customService?calc.customNotes.trim():'',selectedExtras:v.extras.map(e=>({...e})),extras:v.extras.map(e=>({...e})),inventoryUsageSnapshot,servicePrice:v.servicePrice,extraPrices:v.extras.map(e=>({name:e.name,price:e.price})),adjustmentAmount:v.adjustmentAmount,adjustmentType:calc.adjustmentType,preDiscountPrice:v.preDiscountPrice,discountPercent:v.discountPercent,discountAmount:v.discountAmount,discountReason:v.discountPercent?calc.discountReason.trim():'',gstPercent:v.gstPercent,gstAmount:v.gstAmount,taxPercent:v.taxPercent,taxAmount:v.taxAmount,price:v.price,serviceTimeMinutes:v.serviceTime,extraTimeMinutes:v.extrasTime,totalTimeMinutes:v.minutes,inventoryMaterialCost:v.inventoryMaterial,customMaterialCost:v.customMaterialCost,materialCost:v.materialCost,profit:v.profit,profitPerHour:v.perHour,profitMargin:v.margin,date:localDate(),createdAt:new Date().toISOString()};
  state.calculations.push(record);
  if(!save()){state.calculations.pop();for(const [item,quantity] of oldQuantities)item.quantity=quantity;return}
  const lowStockItems=oldQuantities.map(([item])=>item).filter(item=>stockState(item)!=='good');
  calc.client='';calc.customNotes='';calc.consumableUsage={};calc.discountPercent=0;calc.discountReason='';calc.gstPercent=0;calc.taxPercent=0;render();
  if(!showClientSaveStockAlert(lowStockItems))toast('Calculation saved to Client Log and supply stock updated',3000,'success');
}
function openGoal(){modal(state.goal?'Edit profit goal':'Set profit goal',`<form><div class="error-message"></div><div class="field"><label class="required">Target profit</label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" name="target" type="number" min="0" step="0.01" required value="${esc(state.goal?.targetProfit??'')}"></span></div>${formActions('Cancel',state.goal?'Save changes':'Save goal')}</form>`,{subtitle:'Your saved calculations will add to your logged profit.'});wireForm(fd=>{const t=num(fd.get('target'));if(t===null||t<0)return err('Enter zero or a positive target.');state.goal={targetProfit:t};save();closeModal();render()})}
function openAppointment(appointmentId){
  const appointment=state.appointments.find(item=>item.id===appointmentId)||null;
  const editing=!!appointment;
  const originalService=appointmentServiceSnapshot(appointment);
  const originalExtras=appointmentExtras(appointment);
  const originalServiceId=appointment?.serviceId||'';
  const isCustomAppointment=appointment?.customService===true;
  const customDuration=durationInputParts(appointment?.serviceDurationMinutes||0);
  const selectedExtras=new Map(originalExtras.map(extra=>[extra.id,{...extra}]));
  let appointmentDiscountPercent=Number(appointment?.discountPercent)||0;
  let appointmentDiscountReason=String(appointment?.discountReason||'');
  let appointmentDiscountOpen=appointmentDiscountPercent>0;
  const initialDate=appointment?.date||localDate(calendar.date);
  const initialDateParts=dateFromISO(initialDate)||new Date();
  const initialYear=initialDateParts.getFullYear();
  const monthOptions=Array.from({length:12},(_,index)=>`<option value="${index+1}" ${initialDateParts.getMonth()===index?'selected':''}>${new Date(2024,index,1).toLocaleDateString(undefined,{month:'long'})}</option>`).join('');
  const yearStart=Math.min(new Date().getFullYear()-5,initialYear);
  const yearEnd=Math.max(new Date().getFullYear()+10,initialYear);
  const yearOptions=Array.from({length:yearEnd-yearStart+1},(_,index)=>yearStart+index).map(year=>`<option value="${year}" ${year===initialYear?'selected':''}>${year}</option>`).join('');
  const serviceOptions=state.services.map(service=>`<option value="${esc(service.id)}" ${service.id===originalServiceId?'selected':''}>${esc(service.name)}</option>`).join('');
  const appointmentDiscountChoices=Array.from({length:101},(_,percent)=>`<button type="button" class="discount-choice ${appointmentDiscountPercent===percent?'selected':''}" data-appt-discount-percent="${percent}" aria-pressed="${appointmentDiscountPercent===percent}">${percent}%</button>`).join('');
  const deletedServiceOption=originalService&&!state.services.some(service=>service.id===originalService.id)
    ?`<option value="${esc(originalService.id)}" selected>${esc(originalService.name)} (saved)</option>`:'';
  const knownClients=[...new Set(state.calculations.map(record=>record.clientName).filter(Boolean))];
  modal(editing?'Edit appointment':'Add appointment',`<form><div class="error-message"></div><div class="form-grid">
    <div class="field appointment-client-field"><label class="required">Client</label><input class="input" name="client" required maxlength="100" list="client-names" value="${esc(appointment?.clientName||'')}" placeholder="Select or enter client"><datalist id="client-names">${knownClients.map(name=>`<option value="${esc(name)}">`).join('')}</datalist></div>
    <div class="field"><label>Service <span class="optional-note">(optional)</span></label><select class="select" name="service"><option value="" ${!originalServiceId&&!isCustomAppointment?'selected':''}>No service</option>${deletedServiceOption}${serviceOptions}<option value="__custom__" ${isCustomAppointment?'selected':''}>Custom service (one-off)</option></select></div>
    <div class="field full appt-custom-service-fields ${isCustomAppointment?'':'hidden'}" id="appt-custom-service-fields"><div class="form-grid"><div class="field full"><label>Service name</label><input class="input" name="customServiceName" maxlength="60" placeholder="e.g. Custom nail art" value="${esc(isCustomAppointment?appointment?.serviceNameSnapshot||'':'')}"></div><div class="field"><label>Price</label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" name="customServicePrice" type="number" min="0" step="0.01" value="${esc(isCustomAppointment?appointment?.servicePrice??'':'')}"></span></div><div class="field"><label>Duration</label><div class="input-group duration-input"><span class="duration-clock" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span><input class="input" name="customServiceDuration" type="number" min="0" step="1" value="${isCustomAppointment?esc(customDuration.value):''}"><select class="select" name="customServiceUnit"><option ${customDuration.unit==='Minutes'?'selected':''}>Minutes</option><option ${customDuration.unit==='Hours'?'selected':''}>Hours</option></select></div></div><div class="field full"><label>Material cost <span class="optional-note">(optional)</span></label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" name="customServiceMaterialCost" type="number" min="0" step="0.01" value="${esc(isCustomAppointment?appointment?.serviceMaterialCost??'':'')}"></span></div><div class="field full"><label>Notes <span class="optional-note">(optional)</span></label><textarea class="textarea" name="customServiceNotes" maxlength="1000" placeholder="Add details for this one-off service">${esc(isCustomAppointment?appointment?.customServiceNotes||'':'')}</textarea></div></div></div>
    <div class="field full"><label>Extras <span class="optional-note">(optional)</span></label><div id="appt-extras-list" class="extras-list"></div></div>
    <div class="field full appointment-discount-field"><details class="discount-details appt-discount-details" ${appointmentDiscountOpen?'open':''}><summary>Discounts <span aria-hidden="true">▾</span></summary><div class="discount-content"><span class="discount-prompt">Select a discount</span><div class="discount-scroll-panel"><div id="appt-discount-picker" class="discount-picker" role="group" aria-label="Appointment discount percentage" tabindex="0">${appointmentDiscountChoices}</div></div><p class="discount-amount" id="appt-discount-amount-preview" aria-live="polite">${appointmentDiscountOpen&&appointmentDiscountPercent?'': 'No discount applied.'}</p><label class="field discount-reason-field"><span>Reason for discount</span><input class="input" id="appt-discount-reason" maxlength="160" placeholder="e.g. Loyalty reward" value="${esc(appointmentDiscountReason)}" ${appointmentDiscountOpen&&appointmentDiscountPercent?'required aria-required="true"':''}></label></div></details></div>
    <div class="field appointment-date-field"><label class="required">Date</label><div class="appointment-date-selects"><select class="select" name="dateMonth" aria-label="Month">${monthOptions}</select><select class="select" name="dateDay" aria-label="Day">${Array.from({length:new Date(initialYear,initialDateParts.getMonth()+1,0).getDate()},(_,index)=>index+1).map(day=>`<option value="${day}" ${day===initialDateParts.getDate()?'selected':''}>${day}</option>`).join('')}</select><select class="select" name="dateYear" aria-label="Year">${yearOptions}</select></div><input type="hidden" name="date" value="${esc(initialDate)}"><small class="appointment-date-preview" id="appointment-date-preview" aria-live="polite"></small></div>
    <div class="field"><label class="required">Time</label><input class="input" name="time" type="time" required value="${esc(appointment?.time||'09:00')}"></div>
    <div class="field"><label>Total duration</label><output class="input appt-total" id="appt-total-duration">0 min</output></div>
    <div class="field"><label>Total price</label><output class="input appt-total" id="appt-total-price">$0.00</output></div>
    <div class="field full"><label>Notes</label><textarea class="textarea" name="notes" maxlength="500" placeholder="Optional notes">${esc(appointment?.notes||'')}</textarea></div>
  </div>${formActions('Cancel',editing?'Save changes':'Save Appointment')}</form>`,{wide:true,neutralEntry:true,subtitle:'Choose a client and date/time, then optionally add a catalog or custom service, extras, and a discount.'});

  const form=$('.modal form');
  const serviceInput=$('[name="service"]',form);
  const customServiceFields=$('#appt-custom-service-fields',form);
  const customNameInput=$('[name="customServiceName"]',form);
  const customPriceInput=$('[name="customServicePrice"]',form);
  const customDurationInput=$('[name="customServiceDuration"]',form);
  const customUnitInput=$('[name="customServiceUnit"]',form);
  const customMaterialInput=$('[name="customServiceMaterialCost"]',form);
  const customNotesInput=$('[name="customServiceNotes"]',form);
  const dateInput=$('[name="date"]',form);
  const monthInput=$('[name="dateMonth"]',form);
  const dayInput=$('[name="dateDay"]',form);
  const yearInput=$('[name="dateYear"]',form);
  const datePreview=$('#appointment-date-preview');
  const extraList=$('#appt-extras-list');
  const selectedService=()=>{
    const serviceId=serviceInput.value;
    if(serviceId==='__custom__'){
      const price=num(customPriceInput.value),duration=num(customDurationInput.value),materialCost=num(customMaterialInput.value);
      return {id:null,name:customNameInput.value.trim()||'Custom service',price:price===null?0:price,durationMinutes:(duration===null?0:duration)*(customUnitInput.value==='Hours'?60:1),materialCost:materialCost===null?0:materialCost,custom:true,notes:customNotesInput.value.trim()};
    }
    if(!serviceId)return null;
    if(editing&&serviceId===originalServiceId)return originalService;
    const service=state.services.find(item=>item.id===serviceId);
    return service?{id:service.id,name:service.name,price:Number(service.defaultPrice)||0,durationMinutes:Number(service.defaultDurationMinutes)||0,materialCost:Number(service.defaultMaterialCost)||0}:null;
  };
  const totals=()=>{
    const service=selectedService();
    const extras=[...selectedExtras.values()];
    const preDiscountPrice=(Number(service?.price)||0)+extras.reduce((sum,extra)=>sum+(Number(extra.price)||0),0);
    return {
      service,
      extras,
      preDiscountPrice,
      discountPercent:appointmentDiscountOpen?appointmentDiscountPercent:0,
      discountAmount:appointmentDiscountOpen&&preDiscountPrice>0?Math.round((preDiscountPrice*appointmentDiscountPercent/100+Number.EPSILON)*100)/100:0,
      durationMinutes:(Number(service?.durationMinutes)||0)+extras.reduce((sum,extra)=>sum+(Number(extra.durationMinutes)||0),0)
    };
  };
  const updateTotals=()=>{
    const result=totals();
    result.price=Math.max(0,result.preDiscountPrice-result.discountAmount);
    $('#appt-total-price').textContent=money(result.price);
    $('#appt-total-duration').textContent=formatDuration(result.durationMinutes);
    const discountPreview=$('#appt-discount-amount-preview');if(discountPreview)discountPreview.textContent=result.discountPercent?`${money(result.discountAmount)} off the appointment price`:'No discount applied.';
    return result;
  };
  const renderExtras=()=>{
    const catalog=[...state.extras];
    for(const saved of originalExtras)if(!catalog.some(item=>item.id===saved.id))catalog.push(saved);
    extraList.innerHTML=catalog.length?catalog.map(extra=>{
      const display=selectedExtras.get(extra.id)||extra;
      return `<label class="extra-row"><input class="check appt-extra" type="checkbox" value="${esc(extra.id)}" ${selectedExtras.has(extra.id)?'checked':''}><span class="extra-copy"><strong>${esc(display.name)}</strong><small>+${money(display.price)} · ${formatDuration(display.durationMinutes)}</small></span></label>`;
    }).join(''):'<div class="empty-inline">Add an extra from Setup to include one here.</div>';
    $$('.appt-extra',extraList).forEach(input=>input.addEventListener('change',()=>{
      const extraId=input.value;
      if(input.checked){
        const item=state.extras.find(extra=>extra.id===extraId)||originalExtras.find(extra=>extra.id===extraId);
        if(item)selectedExtras.set(extraId,{...item});
      }else selectedExtras.delete(extraId);
      updateTotals();
    }));
    updateTotals();
  };
  const apptDiscountPicker=$('#appt-discount-picker',form);
  $('.appt-discount-details',form)?.addEventListener('toggle',event=>{appointmentDiscountOpen=event.currentTarget.open;const reason=$('#appt-discount-reason',form),required=appointmentDiscountOpen&&appointmentDiscountPercent>0;if(reason){reason.required=required;if(required)reason.setAttribute('aria-required','true');else reason.removeAttribute('aria-required')}updateTotals()});
  if(apptDiscountPicker){
    const percentageScrollTop=percent=>percent/100*Math.max(0,apptDiscountPicker.scrollHeight-apptDiscountPicker.clientHeight);
    apptDiscountPicker.scrollTop=percentageScrollTop(appointmentDiscountPercent);
    const selectAppointmentDiscount=(percent,scroll=false)=>{
      appointmentDiscountPercent=Math.max(0,Math.min(100,Math.round(percent)));
      $$('[data-appt-discount-percent]',apptDiscountPicker).forEach(button=>{const selected=Number(button.dataset.apptDiscountPercent)===appointmentDiscountPercent;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});
      const reason=$('#appt-discount-reason',form),required=appointmentDiscountOpen&&appointmentDiscountPercent>0;if(reason){reason.required=required;if(required)reason.setAttribute('aria-required','true');else reason.removeAttribute('aria-required')}
      if(scroll)apptDiscountPicker.scrollTo({top:percentageScrollTop(appointmentDiscountPercent),behavior:'smooth'});
      updateTotals();
    };
    apptDiscountPicker.addEventListener('keydown',event=>{
      if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();
      if(event.key==='Home')selectAppointmentDiscount(0,true);else if(event.key==='End')selectAppointmentDiscount(100,true);else selectAppointmentDiscount((appointmentDiscountPercent||0)+(event.key==='ArrowDown'?1:-1),true);
    });
    let scrollTimer;
    apptDiscountPicker.addEventListener('scroll',()=>{
      clearTimeout(scrollTimer);
      scrollTimer=setTimeout(()=>{const maxScroll=Math.max(1,apptDiscountPicker.scrollHeight-apptDiscountPicker.clientHeight);selectAppointmentDiscount(Math.max(0,Math.min(100,Math.round(apptDiscountPicker.scrollTop/maxScroll*100))))},110);
    },{passive:true});
    $$('[data-appt-discount-percent]',apptDiscountPicker).forEach(button=>button.addEventListener('click',()=>selectAppointmentDiscount(Number(button.dataset.apptDiscountPercent),true)));
  }
  $('#appt-discount-reason',form)?.addEventListener('input',event=>{appointmentDiscountReason=event.target.value});
  const updateDatePreview=()=>{
    const year=Number(yearInput.value),month=Number(monthInput.value),day=Number(dayInput.value);
    const daysInMonth=new Date(year,month,0).getDate();
    const selectedDay=Math.min(day,daysInMonth);
    dayInput.innerHTML=Array.from({length:daysInMonth},(_,index)=>index+1).map(value=>`<option value="${value}" ${value===selectedDay?'selected':''}>${value}</option>`).join('');
    dateInput.value=`${year}-${String(month).padStart(2,'0')}-${String(Number(dayInput.value)).padStart(2,'0')}`;
    const parsed=dateFromISO(dateInput.value);
    datePreview.textContent=parsed?`Booking on ${parsed.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}`:'';
  };
  serviceInput.addEventListener('change',()=>{customServiceFields.classList.toggle('hidden',serviceInput.value!=='__custom__');updateTotals()});
  [customPriceInput,customDurationInput].forEach(input=>input.addEventListener('input',updateTotals));
  customUnitInput.addEventListener('change',updateTotals);
  [monthInput,dayInput,yearInput].forEach(input=>input.addEventListener('change',updateDatePreview));
  renderExtras();
  updateDatePreview();

  wireForm(fd=>{
    const client=String(fd.get('client')||'').trim();
    const serviceChoice=String(fd.get('service')||'');
    const customService=serviceChoice==='__custom__';
    const serviceId=customService?null:serviceChoice||null;
    const customPrice=num(fd.get('customServicePrice')),customDuration=num(fd.get('customServiceDuration')),customMaterialCost=num(fd.get('customServiceMaterialCost'));
    const date=String(fd.get('date')||'');
    const time=String(fd.get('time')||'');
    const result=updateTotals();
    if(!client)return err('Enter a client name.');
    if(!dateFromISO(date))return err('Choose a valid date.');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return err('Enter a valid appointment time.');
    if(customService&&((customPrice!==null&&customPrice<0)||(customDuration!==null&&customDuration<0)||(customMaterialCost!==null&&customMaterialCost<0)))return err('Custom service price, duration, and material cost must be zero or more.');
    if(result.discountPercent&&!appointmentDiscountReason.trim())return err('Add a reason for the discount before saving.');
    if(!Number.isFinite(result.price)||result.price<0||!Number.isFinite(result.durationMinutes)||result.durationMinutes<0)return err('Check the selected service and extras.');
    const record={
      id:appointment?.id||id(),
      clientName:client,
      serviceId,
      customService,
      serviceNameSnapshot:result.service?.name||(result.extras.length?'Extras only':'Appointment'),
      servicePrice:Number(result.service?.price)||0,
      serviceDurationMinutes:Number(result.service?.durationMinutes)||0,
      serviceMaterialCost:customService?(Number(result.service?.materialCost)||0):0,
      customServiceNotes:customService?String(fd.get('customServiceNotes')||'').trim():'',
      selectedExtras:result.extras.map(extra=>({...extra})),
      inventoryUsageSnapshot:appointmentInventoryUsage(serviceId,result.extras),
      date,time,
      durationMinutes:result.durationMinutes,
      preDiscountPrice:result.preDiscountPrice,
      discountPercent:result.discountPercent,
      discountAmount:result.discountAmount,
      discountReason:result.discountPercent?appointmentDiscountReason.trim():'',
      price:result.price,
      notes:String(fd.get('notes')||'').trim(),
      status:appointment?.status||'scheduled'
    };
    if(appointment){
      const previous={...appointment};
      Object.assign(appointment,record);
      if(!save()){Object.assign(appointment,previous);return}
    }else{
      state.appointments.push(record);
      if(!save()){state.appointments.pop();return}
    }
    calendar.date=dateFromISO(date)||calendar.date;
    const calendarDays=Array.from({length:7},(_,index)=>localDate(shiftDate(calendar.startDate||calendar.date,index)));
    if(!calendarDays.includes(localDate(calendar.date)))calendar.startDate=new Date(calendar.date);
    closeModal();
    render();
  });
}
function exportReceipt(cid){
  const c=state.calculations.find(item=>item.id===cid);if(!c)return;
  const serviceName=String(c.serviceNameSnapshot||'Custom service');
  const extras=Array.isArray(c.extraPrices)&&c.extraPrices.length?c.extraPrices:(c.extras||c.selectedExtras||[]);
  const rows=[];
  if(serviceName!=='Extras only')rows.push({type:'SERVICE',name:serviceName,price:Number(c.servicePrice)||0});
  for(const extra of extras)rows.push({type:'EXTRA',name:String(extra.name||'Extra'),price:Number(extra.price)||0});
  if(!rows.length)rows.push({type:'SERVICE',name:'Service',price:Number(c.price)||0});
  if(Number(c.adjustmentAmount)>0)rows.push({type:'ADJUSTMENT',name:'Price adjustment',price:(c.adjustmentType==='deduct'?-1:1)*Number(c.adjustmentAmount)});
  if(Number(c.discountPercent)>0)rows.push({type:`DISCOUNT · ${Number(c.discountPercent)}%`,name:String(c.discountReason||'Discount'),price:-Math.abs(Number(c.discountAmount)||0)});
  if(Number(c.gstPercent)>0)rows.push({type:`GST · ${Number(c.gstPercent)}%`,name:'GST',price:Math.abs(Number(c.gstAmount)||0)});
  if(Number(c.taxPercent)>0)rows.push({type:`TAX · ${Number(c.taxPercent)}%`,name:'Tax',price:Math.abs(Number(c.taxAmount)||0)});
  const serviceDate=c.date||c.appointmentDate||c.createdAt?.slice?.(0,10)||'';
  const canvas=document.createElement('canvas'),scale=2,width=350,pad=28,rowHeight=52;
  const height=260+rows.length*rowHeight;
  canvas.width=width*scale;canvas.height=height*scale;
  const ctx=canvas.getContext('2d');ctx.scale(scale,scale);
  const theme=getComputedStyle(document.documentElement);
  const colors={
    canvas:theme.getPropertyValue('--app-bg').trim(),
    card:theme.getPropertyValue('--standard-card-bg').trim(),
    ink:theme.getPropertyValue('--standard-card-text').trim(),
    muted:theme.getPropertyValue('--muted').trim(),
    accent:theme.getPropertyValue('--accent-color').trim(),
    line:theme.getPropertyValue('--line').trim(),
    paid:theme.getPropertyValue('--green').trim(),
    paidBg:theme.getPropertyValue('--green-soft').trim()
  };
  ctx.fillStyle=colors.canvas;ctx.fillRect(0,0,width,height);
  const roundRect=(x,y,w,h,r,color)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=color;ctx.fill()};
  roundRect(10,10,width-20,height-20,18,colors.card);
  roundRect(width-98,29,66,26,13,colors.paidBg);
  ctx.fillStyle=colors.paid;ctx.font='700 10px "DM Sans", Arial, sans-serif';ctx.textAlign='center';ctx.fillText('PAID',width-65,46);ctx.textAlign='left';
  ctx.fillStyle=colors.ink;ctx.font='700 15px Manrope, Arial, sans-serif';ctx.fillText('PAYMENT RECEIPT',pad,50);
  ctx.strokeStyle=colors.line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad,94);ctx.lineTo(width-pad,94);ctx.stroke();
  ctx.fillStyle=colors.muted;ctx.font='600 9px "DM Sans", Arial, sans-serif';ctx.fillText('CLIENT NAME',pad,115);ctx.fillText('DATE OF SERVICE',width/2+3,115);
  ctx.fillStyle=colors.ink;ctx.font='600 12px "DM Sans", Arial, sans-serif';ctx.fillText(String(c.clientName||'Client'),pad,134,width/2-43);ctx.fillText(fmtDate(serviceDate),width/2+3,134,width/2-pad-3);
  ctx.strokeStyle=colors.line;ctx.beginPath();ctx.moveTo(pad,151);ctx.lineTo(width-pad,151);ctx.stroke();
  ctx.fillStyle=colors.muted;ctx.font='600 9px "DM Sans", Arial, sans-serif';ctx.fillText('ITEM',pad,171);ctx.textAlign='right';ctx.fillText('AMOUNT',width-pad,171);ctx.textAlign='left';
  let y=197;
  rows.forEach(row=>{ctx.fillStyle=colors.accent;ctx.font='700 8px "DM Sans", Arial, sans-serif';ctx.fillText(row.type,pad,y);ctx.fillStyle=colors.ink;ctx.font='500 11px "DM Sans", Arial, sans-serif';ctx.fillText(row.name,pad,y+16,width-pad*2-72);ctx.textAlign='right';ctx.fillStyle=colors.ink;const amount=row.type==='ADJUSTMENT'||row.type.startsWith('DISCOUNT')||row.type.startsWith('GST')||row.type.startsWith('TAX')?(row.price<0?'−':'+')+money(Math.abs(row.price)):money(Math.abs(row.price));ctx.fillText(amount,width-pad,y+16);ctx.textAlign='left';ctx.strokeStyle=colors.line;ctx.beginPath();ctx.moveTo(pad,y+27);ctx.lineTo(width-pad,y+27);ctx.stroke();y+=rowHeight});
  y+=5;ctx.fillStyle=colors.muted;ctx.font='600 11px "DM Sans", Arial, sans-serif';ctx.fillText('TOTAL PAID',pad,y+3);ctx.fillStyle=colors.ink;ctx.textAlign='right';ctx.font='700 20px Manrope, Arial, sans-serif';ctx.fillText(money(c.price),width-pad,y+6);ctx.textAlign='left';
  ctx.fillStyle=colors.muted;ctx.font='500 9px "DM Sans", Arial, sans-serif';ctx.textAlign='center';ctx.fillText('Thank you for your visit',width/2,height-31);ctx.textAlign='left';
  const imageUrl=canvas.toDataURL('image/png');
  const clientFile=String(c.clientName||'client').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'client';
  const dateFile=/^\d{4}-\d{2}-\d{2}$/.test(String(serviceDate))?serviceDate:String(serviceDate||'date').replace(/[^\da-z-]/gi,'-');
  const filename=`receipt-${clientFile}-${dateFile}.png`;
  const download=document.createElement('a');download.href=imageUrl;download.download=filename;download.style.display='none';document.body.append(download);download.click();download.remove();
  modal('Receipt preview',`<div class="receipt-preview"><img src="${imageUrl}" alt="Paid receipt for ${esc(c.clientName||'client')}" /></div><div class="modal-actions receipt-actions"><button class="btn" type="button" data-receipt-share>Share Receipt</button><button class="btn btn-primary" type="button" data-receipt-download>Download Image</button></div>`,{subtitle:`Downloaded as ${esc(filename)}`});
  const saveImage=()=>{const link=document.createElement('a');link.href=imageUrl;link.download=filename;document.body.append(link);link.click();link.remove()};
  $('[data-receipt-download]').onclick=()=>{saveImage();toast('Receipt image downloaded.')};
  $('[data-receipt-share]').onclick=async()=>{
    const blob=await (await fetch(imageUrl)).blob();
    const file=new File([blob],filename,{type:'image/png'});
    try{
      if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
        try{await navigator.share({files:[file],title:`Receipt for ${c.clientName||'client'}`,text:'Your payment receipt'});return}
        catch(error){if(error?.name==='AbortError')return}
      }
      if(navigator.clipboard?.write&&window.ClipboardItem){try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);toast('Receipt image copied. You can paste it into a message.');return}catch{}}
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(imageUrl);toast('Receipt image data copied. Paste it into a compatible app.');return}
      saveImage();toast('Receipt downloaded. Sharing is not available in this browser.');
    }catch(error){console.error('Could not share receipt.',error);toast('Could not share the receipt. Use Download Image instead.')}
  };
}
function openCalculationDetail(cid){const c=state.calculations.find(x=>x.id===cid);if(!c)return;modal(`${esc(c.clientName)} · ${esc(c.serviceNameSnapshot)}`,`<div class="detail-grid"><div class="detail-item"><span>Client</span><strong>${esc(c.clientName)}</strong></div><div class="detail-item"><span>Date</span><strong>${fmtDate(c.date)}</strong></div>${c.appointmentTime?`<div class="detail-item"><span>Appointment time</span><strong>${esc(c.appointmentTime)}</strong></div>`:""}<div class="detail-item"><span>Service price</span><strong>${money(c.servicePrice)}</strong></div><div class="detail-item"><span>Extra prices</span><strong>${money((c.extras||[]).reduce((n,e)=>n+Number(e.price||0),0))}</strong></div>${Number(c.adjustmentAmount)>0?`<div class="detail-item"><span>Price adjustment</span><strong>${c.adjustmentType==='deduct'?'−':'+'}${money(c.adjustmentAmount)}</strong></div>`:''}${Number(c.gstPercent)>0?`<div class="detail-item"><span>GST</span><strong>${Number(c.gstPercent)}% · ${money(c.gstAmount)}</strong></div>`:''}${Number(c.taxPercent)>0?`<div class="detail-item"><span>Tax</span><strong>${Number(c.taxPercent)}% · ${money(c.taxAmount)}</strong></div>`:''}${Number(c.discountPercent)>0?`<div class="detail-item"><span>Discount</span><strong>${Number(c.discountPercent)}% · ${money(c.discountAmount)}</strong></div><div class="detail-item"><span>Discount reason</span><strong>${esc(c.discountReason||'—')}</strong></div>`:''}<div class="detail-item"><span>Total client price</span><strong>${money(c.price)}</strong></div><div class="detail-item"><span>Useables</span><strong>${money(inventoryUsageCost(c.inventoryUsageSnapshot||[]))}</strong></div>${Number(c.customMaterialCost)>0?`<div class="detail-item"><span>Useables cost</span><strong>${money(c.customMaterialCost)}</strong></div>`:''}<div class="detail-item"><span>Service time</span><strong>${formatDuration(c.serviceTimeMinutes)}</strong></div><div class="detail-item"><span>Extra time</span><strong>${formatDuration(c.extraTimeMinutes)}</strong></div><div class="detail-item"><span>Total time</span><strong>${formatDuration(c.totalTimeMinutes)}</strong></div><div class="detail-item"><span>Estimated profit</span><strong>${money(c.profit)}</strong></div><div class="detail-item"><span>Profit per hour</span><strong>${money(c.profitPerHour)} /hr</strong></div><div class="detail-item"><span>Profit margin</span><strong>${Number(c.profitMargin||0).toFixed(1)}%</strong></div></div><p class="detail-section-title">Selected extras</p><div class="detail-extras">${c.extras?.length?c.extras.map(e=>`<span>${esc(e.name)} · ${money(e.price)}</span>`).join(''):'<span>No extras</span>'}</div>${c.notes?`<p class="detail-section-title">Notes</p><p class="detail-note">${esc(c.notes)}</p>`:""}<div class="modal-actions"><button class="btn btn-danger" data-detail-delete>Delete</button><button class="btn" data-detail-receipt>Export receipt</button><button class="btn" data-detail-notes>${c.notes?'Edit notes':'Add notes'}</button><button class="btn" data-detail-edit>Edit details</button><button class="btn btn-primary" data-modal-cancel>Done</button></div>`,{wide:true});$('[data-modal-cancel]').onclick=closeModal;$('[data-detail-notes]').onclick=()=>openCalculationNotes(cid);$('[data-detail-delete]').onclick=()=>{if(confirm('Delete this saved calculation?')){state.calculations=state.calculations.filter(x=>x.id!==cid);save();closeModal();render()}};$('[data-detail-edit]').onclick=()=>openCalculationEdit(cid);$('[data-detail-receipt]').onclick=()=>exportReceipt(cid)}
function openCalculationNotes(cid){const c=state.calculations.find(x=>x.id===cid);if(!c)return;modal('Client notes',`<form><div class="field"><label for="client-log-notes">Notes</label><textarea class="textarea" id="client-log-notes" name="notes" maxlength=1000 placeholder="Add a note about this client or appointment…">${esc(c.notes||'')}</textarea></div>${formActions('Cancel','Save notes')}</form>`,{subtitle:`${esc(c.clientName)} · ${esc(c.serviceNameSnapshot)}`});wireForm(fd=>{c.notes=String(fd.get('notes')||'').trim();save();closeModal();openCalculationDetail(cid)})}
function openCalculationEdit(cid){const c=state.calculations.find(x=>x.id===cid);if(!c)return;const duration=durationInputParts(c.totalTimeMinutes);modal('Edit calculation',`<form><div class="error-message"></div><div class="form-grid"><div class="field full"><label class="required">Service name</label><input class="input" name="serviceName" required maxlength="60" value="${esc(c.serviceNameSnapshot||'Custom service')}"></div><div class="field"><label class="required">Client name</label><input class="input" name="client" required value="${esc(c.clientName)}"></div><div class="field"><label class="required">Date</label><input class="input" name="date" type="date" required value="${esc(c.date)}"></div><div class="field"><label class="required">Client price</label><span class="money-input"><span class="money-affix" aria-hidden="true">$</span><input class="input" name="price" type="number" min="0" step="0.01" required value="${esc(c.price)}"></span></div><div class="field"><label class="required">Total time</label><div class="input-group duration-input"><span class="duration-clock" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span><input class="input" name="duration" type="number" min="0" step="1" required value="${esc(duration.value)}"><select class="select" name="unit"><option ${duration.unit==='Minutes'?'selected':''}>Minutes</option><option ${duration.unit==='Hours'?'selected':''}>Hours</option></select></div></div></div>${formActions('Cancel','Save changes')}</form>`,{subtitle:'Rename the service and update the saved calculation details.'});wireForm(fd=>{const serviceName=fd.get('serviceName').trim(),client=fd.get('client').trim(),date=fd.get('date'),p=num(fd.get('price')),durationValue=num(fd.get('duration')),t=durationValue===null?null:durationValue*(fd.get('unit')==='Hours'?60:1);if(!serviceName||!client||!date||p===null||p<0||t===null||t<0)return err('Complete every field with valid non-negative values.');const extras=c.extras||c.selectedExtras||[],extraPrice=extras.reduce((sum,e)=>sum+(Number(e.price)||0),0),priceAdjustment=p-(Number(c.servicePrice)||0)-extraPrice,oldMinutes=Number(c.totalTimeMinutes)||0,extraTimeRatio=oldMinutes>0?Math.max(0,Math.min(1,(Number(c.extraTimeMinutes)||0)/oldMinutes)):0,extraMinutes=Math.round(t*extraTimeRatio),supplyCost=inventoryUsageCost(c.inventoryUsageSnapshot||[]);c.serviceNameSnapshot=serviceName;c.clientName=client;c.date=date;c.price=p;c.discountPercent=0;c.discountAmount=0;c.discountReason='';c.gstPercent=0;c.gstAmount=0;c.taxPercent=0;c.taxAmount=0;c.preDiscountPrice=p;c.adjustmentType=priceAdjustment<0?'deduct':'add';c.adjustmentAmount=Math.abs(priceAdjustment);c.materialCost=supplyCost;c.inventoryMaterialCost=supplyCost;c.profit=p-supplyCost;c.totalTimeMinutes=t;c.serviceTimeMinutes=t-extraMinutes;c.extraTimeMinutes=extraMinutes;c.profitPerHour=t>0?c.profit/(t/60):0;c.profitMargin=p>0?c.profit/p*100:0;save();closeModal();render()})}
function appointmentLogExists(appointment){
  return state.calculations.some(record=>record.appointmentId===appointment.id);
}
function appointmentToCalculation(appointment){
  const extras=appointmentExtras(appointment);
  const price=Number(appointment.price)||0;
  const inventoryMaterial=inventoryUsageCost(Array.isArray(appointment.inventoryUsageSnapshot)?appointment.inventoryUsageSnapshot:appointmentInventoryUsage(appointment.serviceId,extras));
  const customMaterialCost=Number(appointment.serviceMaterialCost)||0;
  const materialCost=inventoryMaterial+customMaterialCost;
  const profit=price-materialCost;
  const minutes=Number(appointment.durationMinutes)||0;
  return {
    id:id(),
    appointmentId:appointment.id,
    clientName:appointment.clientName,
    serviceId:appointment.serviceId||null,
    serviceNameSnapshot:appointment.serviceNameSnapshot||'Extras only',
    selectedExtras:extras.map(extra=>({...extra})),
    extras:extras.map(extra=>({...extra})),
    servicePrice:Number(appointment.servicePrice)||0,
    extraPrices:extras.map(extra=>({name:extra.name,price:extra.price})),
    preDiscountPrice:Number(appointment.preDiscountPrice??appointment.price)||0,
    discountPercent:Number(appointment.discountPercent)||0,
    discountAmount:Number(appointment.discountAmount)||0,
    discountReason:String(appointment.discountReason||''),
    price,
    serviceTimeMinutes:Number(appointment.serviceDurationMinutes)||0,
    extraTimeMinutes:extras.reduce((sum,extra)=>sum+(Number(extra.durationMinutes)||0),0),
    totalTimeMinutes:minutes,
    inventoryMaterialCost:inventoryMaterial,
    customMaterialCost,
    materialCost,
    profit,
    profitPerHour:minutes?profit/(minutes/60):0,
    profitMargin:price?profit/price*100:0,
    date:appointment.date,
    appointmentTime:appointment.time,
    notes:[appointment.customServiceNotes,appointment.notes].filter(Boolean).join('\n\n'),
    createdAt:new Date().toISOString()
  };
}
function addAppointmentToLog(appointment){
  if(appointmentLogExists(appointment))return false;
  const record=appointmentToCalculation(appointment);
  state.calculations.push(record);
  if(save())return true;
  state.calculations.pop();
  return false;
}
function ensureCompletedAppointmentsLogged(){
  const missing=state.appointments.filter(appointment=>appointment?.status==='completed'&&!appointmentLogExists(appointment));
  if(!missing.length)return;
  state.calculations.push(...missing.map(appointment=>appointmentToCalculation(appointment)));
  if(!save())state.calculations.splice(-missing.length,missing.length);
}
function confirmAppointmentLog(appointment){
  if(appointmentLogExists(appointment)){toast('This appointment is already in the Client Log.');return}
  modal('Add to Client Log?',`<p class="confirm-copy">Save ${esc(appointment.clientName)}’s completed appointment with its service, extras, date, price, and duration?</p><div class="modal-actions"><button class="btn" data-modal-cancel>Not now</button><button class="btn btn-primary" data-confirm-log>Add to Client Log</button></div>`);
  $('[data-modal-cancel]').onclick=closeModal;
  $('[data-confirm-log]').onclick=()=>{
    if(!addAppointmentToLog(appointment)){closeModal();return}
    closeModal();render();toast('Appointment added to Client Log',3000,'success');
  };
}
function completeAppointment(appointmentId){
  const appointment=state.appointments.find(item=>item.id===appointmentId);
  if(!appointment||appointment.status==='completed')return;
  const consumables=state.inventory.filter(item=>item.category==='consumable');
  if(!consumables.length){finalizeAppointment(appointmentId,[]);return}
  modal('Useables used',`<form><p class="confirm-copy">Enter the actual amount of each useable used for ${esc(appointment.clientName)}’s appointment. Completion deducts these quantities and the linked supply use from stock.</p><div class="completion-usage-list">${consumables.map(item=>`<label class="completion-usage-row"><span><strong>${esc(item.name)}</strong><small class="completion-usage-summary">${esc(inventoryStockText(item))} · 0 ${esc(inventoryUnitInfo(item.unit).short)} used · ${esc(inventoryUnitCostText(item))}</small></span><span class="quantity-unit-field"><input class="input completion-usage-quantity" type="number" min="0" max="${Math.max(0,Number(item.quantity)||0)}" step="any" value="0" data-consumable-id="${esc(item.id)}" aria-label="${esc(item.name)} quantity used (${esc(inventoryUnitInfo(item.unit).short)})" title="Enter the amount of ${esc(item.name)} used in ${esc(inventoryUnitInfo(item.unit).short)}."><small aria-hidden="true">${esc(inventoryUnitInfo(item.unit).inputUnit||inventoryUnitInfo(item.unit).short)}</small></span></label>`).join('')}</div><div class="modal-actions"><button type="button" class="btn" data-modal-cancel>Cancel</button><button type="submit" class="btn btn-primary">Finish appointment</button></div></form>`,{subtitle:`${esc(appointment.clientName)} · ${fmtDate(appointment.date)}`});
  $('[data-modal-cancel]').onclick=closeModal;
  $$('.completion-usage-quantity').forEach(input=>input.addEventListener('input',()=>{const item=state.inventory.find(entry=>entry.id===input.dataset.consumableId),summary=input.closest('.completion-usage-row')?.querySelector('.completion-usage-summary');if(summary&&item)summary.textContent=`${inventoryStockText(item)} · ${num(input.value)||0} ${inventoryUnitInfo(item.unit).short} used · ${inventoryUnitCostText(item)}`}));
  $('.modal form')?.addEventListener('submit',event=>{event.preventDefault();const usages=$$('.completion-usage-quantity').map(input=>({itemId:input.dataset.consumableId,quantity:num(input.value)}));if(usages.some(use=>use.quantity===null||use.quantity<0)){const error=$('.error-message');if(error)error.textContent='Enter a quantity of zero or more for each useable.';else toast('Enter a quantity of zero or more for each useable.');return}finalizeAppointment(appointmentId,usages)});
}
function finalizeAppointment(appointmentId,consumableUsages=[]){
  const appointment=state.appointments.find(item=>item.id===appointmentId);
  if(!appointment||appointment.status==='completed')return;
  const savedUsages=currentAppointmentInventoryUsage(appointment);
  const usages=[...savedUsages.filter(use=>state.inventory.find(item=>item.id===use.itemId)?.category!=='consumable'),...consumableUsages.filter(use=>Number(use.quantity)>0)];
  const totals=new Map();for(const use of usages)totals.set(use.itemId,(totals.get(use.itemId)||0)+(Number(use.quantity)||0));
  const short=[];for(const [itemId,quantity] of totals){const item=state.inventory.find(entry=>entry.id===itemId);if(item&&Number(item.quantity)<quantity)short.push(`${item.name} (need ${quantity}, have ${Number(item.quantity)||0})`)}
  if(short.length){toast(`Not enough stock to complete: ${short.join(', ')}.`,5000);return}
  const oldStatus=appointment.status,oldQuantities=[],oldUsageSnapshot=appointment.inventoryUsageSnapshot,oldInventoryDeducted=appointment.inventoryDeducted;
  for(const [itemId,quantity] of totals){const item=state.inventory.find(entry=>entry.id===itemId);if(item){oldQuantities.push([item,Number(item.quantity)||0]);item.quantity=(Number(item.quantity)||0)-quantity}}
  appointment.status='completed';
  appointment.inventoryDeducted=true;
  appointment.inventoryUsageSnapshot=[...totals].map(([itemId,quantity])=>({itemId,quantity,costAtTime:Number(state.inventory.find(item=>item.id===itemId)?.unitCost)||0}));
  const shouldAddToClientList=!appointmentLogExists(appointment);
  if(shouldAddToClientList)state.calculations.push(appointmentToCalculation(appointment));
  if(!save()){
    if(shouldAddToClientList)state.calculations.pop();
    appointment.status=oldStatus;appointment.inventoryDeducted=oldInventoryDeducted;appointment.inventoryUsageSnapshot=oldUsageSnapshot;
    for(const [item,quantity] of oldQuantities)item.quantity=quantity;
    return;
  }
  closeModal();render();
  if(shouldAddToClientList)toast('Added to client list',3000,'success');
}
function openAppointmentDetail(appointmentId){
  const appointment=state.appointments.find(item=>item.id===appointmentId);
  if(!appointment)return;
  const extras=appointmentExtras(appointment);
  const status=appointment.status==='completed'?'completed':appointment.date<localDate()?'expired':'scheduled';
  const logged=appointmentLogExists(appointment);
  const extraDetails=extras.length
    ?extras.map(extra=>`<span>${esc(extra.name)} · ${money(extra.price)} · ${formatDuration(extra.durationMinutes)}</span>`).join('')
    :'<span>No extras</span>';
  const statusAction=status==='completed'
    ?logged?'<button class="btn" disabled>Added to Client Log</button>':'<button class="btn btn-primary" data-appt-log>Add to Client Log</button>'
    :'<button class="btn btn-primary" data-appt-complete>Mark completed</button>';
  modal(esc(appointment.clientName||'Appointment'),`<div class="detail-grid">
    <div class="detail-item"><span>Client</span><strong>${esc(appointment.clientName||'—')}</strong></div>
    <div class="detail-item"><span>Service</span><strong>${esc(appointment.serviceNameSnapshot||'Appointment')}</strong></div>
    <div class="detail-item"><span>Date</span><strong>${fmtDate(appointment.date)}</strong></div>
    <div class="detail-item"><span>Time</span><strong>${esc(appointment.time||'—')}</strong></div>
    <div class="detail-item"><span>Total duration</span><strong>${formatDuration(appointment.durationMinutes)}</strong></div>
    ${Number(appointment.discountPercent)>0?`<div class="detail-item"><span>Price before discount</span><strong>${money(appointment.preDiscountPrice??appointment.price)}</strong></div><div class="detail-item"><span>Discount</span><strong>${Number(appointment.discountPercent)}% · ${money(appointment.discountAmount)}</strong></div><div class="detail-item"><span>Discount reason</span><strong>${esc(appointment.discountReason||'—')}</strong></div>`:''}
    <div class="detail-item"><span>Total price</span><strong>${money(appointment.price)}</strong></div>
    ${Number(appointment.serviceMaterialCost)>0?`<div class="detail-item"><span>Material cost</span><strong>${money(appointment.serviceMaterialCost)}</strong></div>`:''}
    <div class="detail-item"><span>Status</span><strong class="status-label status-${status}">${status==='completed'?'Completed':status==='expired'?'Expired':'Scheduled'}</strong></div>
  </div><p class="detail-section-title">Selected extras</p><div class="detail-extras">${extraDetails}</div>
  ${appointment.customServiceNotes?`<p class="detail-section-title">One-off service notes</p><p class="detail-note">${esc(appointment.customServiceNotes)}</p>`:''}
  ${appointment.notes?`<p class="detail-section-title">Notes</p><p class="detail-note">${esc(appointment.notes)}</p>`:''}
  <div class="modal-actions appointment-detail-actions"><button class="btn btn-danger" data-appt-delete>Delete</button><button class="btn" data-appt-notes>${appointment.notes?'Edit notes':'Add notes'}</button><button class="btn" data-appt-edit>Edit</button>${statusAction}<button class="btn" data-modal-cancel>Done</button></div>`,{wide:true});
  $('[data-modal-cancel]').onclick=closeModal;
  $('[data-appt-notes]').onclick=()=>openAppointmentNotes(appointmentId);
  $('[data-appt-edit]').onclick=()=>openAppointment(appointmentId);
  $('[data-appt-complete]')?.addEventListener('click',()=>completeAppointment(appointmentId));
  $('[data-appt-log]')?.addEventListener('click',()=>confirmAppointmentLog(appointment));
  $('[data-appt-delete]').onclick=()=>{
    if(!confirm('Delete this appointment?'))return;
    const previous=state.appointments;
    state.appointments=previous.filter(item=>item.id!==appointmentId);
    if(!save()){state.appointments=previous;return}
    closeModal();render();
  };
}

function openAppointmentNotes(appointmentId){
  const appointment=state.appointments.find(item=>item.id===appointmentId);
  if(!appointment)return;
  modal('Appointment notes',`<form><div class="field"><label for="appointment-notes">Notes</label><textarea class="textarea" id="appointment-notes" name="notes" maxlength="1000" placeholder="Add notes for this appointment…">${esc(appointment.notes||'')}</textarea></div>${formActions('Cancel','Save notes')}</form>`,{subtitle:`${esc(appointment.clientName||'Appointment')} · ${fmtDate(appointment.date)}`});
  wireForm(fd=>{
    const previous=appointment.notes||'';
    appointment.notes=String(fd.get('notes')||'').trim();
    if(!save()){appointment.notes=previous;return}
    closeModal();
    openAppointmentDetail(appointmentId);
  });
}

function toast(message,duration=3000,tone='auto'){const old=$('.toast');old?.remove();const t=document.createElement('div');const resolvedTone=tone==='auto'?(/could not|not enough|invalid|failed|unable|error|must be|enter |choose |already|no account/i.test(message)?'error':'info'):tone;t.className='toast';t.dataset.tone=resolvedTone;t.setAttribute('role',resolvedTone==='error'?'alert':'status');t.setAttribute('aria-live',resolvedTone==='error'?'assertive':'polite');t.textContent=message;document.body.append(t);setTimeout(()=>{if(t.isConnected)t.remove()},duration)}
initializeSupabaseApp().catch(error=>{console.error('Could not initialize Polished.',error);document.body.classList.remove('app-initializing');toast('Could not connect to your account. Refresh and try again.',6000,'error')});
