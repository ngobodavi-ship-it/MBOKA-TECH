/* =======================================================================
   app/navigation.js — Habillage, thème et navigation
   Contenu    : renderChrome(), renderDash(), renderAll(), bascule de thème, switchView()
   Dépend de  : toutes les vues
   ======================================================================= */
/* ---------- chrome : source, fréquences, navigation ---------- */
function setPressed(boxId,attr,val){
  document.querySelectorAll('#'+boxId+' button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[attr]===val)));
}
function rebuildSelects(){
  const sf=document.getElementById('selFiliale');
  sf.innerHTML='<option value="all">Toutes les filiales</option>'+filialesList().map(f=>`<option value="${esc(f.id)}">${esc(f.nom)}</option>`).join('');
  sf.value=state.filiale;if(sf.value!==state.filiale){state.filiale='all';sf.value='all'}
  const sa=document.getElementById('selActivite');
  sa.innerHTML='<option value="all">Toutes les activités</option>'+activitesList().map(a=>`<option value="${esc(a.id)}">${esc(a.nom)}</option>`).join('');
  sa.value=state.activite;if(sa.value!==state.activite){state.activite='all';sa.value='all'}
}
function renderChrome(){
  const tag=document.getElementById('srcTag');
  tag.textContent='PRODUCTION';
  tag.classList.add('prod');
  document.getElementById('navUsers').hidden=!droits().manage;
  document.getElementById('navAudit').hidden=!droits().aud;
  setPressed('segNiveau','n',state.niveau);
  const av=freqsDisponibles();
  document.querySelectorAll('#segFreq button').forEach(b=>{
    const ok=av.includes(b.dataset.f);
    b.disabled=!ok;
    b.title=ok?'':'Aucune période de ce type dans la base';
  });
  setPressed('segFreq','f',state.freq);
  document.getElementById('navCount').textContent=CHARGE?'chargement…':(DB.rows.length?DB.rows.length+' lignes en base':'base vide');
}
function renderDash(){
  renderContext();
  if(CHARGE){document.getElementById('context').textContent='Chargement des données de production…'}
  const has=!CHARGE&&selection().length>0;
  document.getElementById('dashContent').style.display=has?'':'none';
  document.getElementById('emptyState').style.display=(has||CHARGE)?'none':'';
  document.getElementById('emptyMsg').innerHTML=droits().imp
    ?'La base centrale ne contient aucune donnée pour cette sélection.<br>Onglet Données : téléchargez le modèle Excel, remplissez-le, importez-le.'
    :'La base centrale ne contient aucune donnée pour cette sélection.<br>Les imports sont assurés par la DFC ou un administrateur.';
  document.getElementById('btnGoData').style.display=droits().imp?'':'none';
  if(has){renderKPI();renderCharts();renderTable()}
}
function renderAll(){renderChrome();renderDash();renderData()}
function majBoutonTheme(){
  const sombre=document.documentElement.getAttribute('data-theme')==='dark';
  document.getElementById('btnTheme').innerHTML=sombre
    ?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>Thème clair'
    :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>Thème sombre';
}
document.getElementById('btnTheme').onclick=()=>{
  const t=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',t);
  try{localStorage.setItem('pilotage-theme',t)}catch(e){}
  majBoutonTheme();
  try{if(DB.rows.length)renderCharts()}catch(e){}
};
majBoutonTheme();
let _rsz;window.addEventListener('resize',()=>{clearTimeout(_rsz);_rsz=setTimeout(()=>{try{if(state.view==='dash'&&DB.rows.length)renderCharts()}catch(e){}},150)});
function switchView(v){
  if(v==='users'&&!droits().manage)v='dash';
  if(v==='audit'&&!droits().aud)v='dash';
  state.view=v;
  document.querySelectorAll('#mainNav button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===v)));
  document.querySelectorAll('.view').forEach(s=>s.classList.remove('on'));
  document.getElementById('view-'+v).classList.add('on');
  if(v==='users')chargerUsers();
  if(v==='audit')chargerAudit();
  if(v==='data'){chargerJournal();chargerCorbeille()}
}
