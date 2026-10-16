/* =======================================================================
   app/csv.js — Lecture CSV et gabarit
   Contenu    : parseCSV() (séparateur ; ou , détecté), GABARIT (CSV d'exemple téléchargeable)
   Dépend de  : —
   ======================================================================= */
function parseCSV(text){
  text=String(text).replace(/^\uFEFF/,'');
  const firstLine=text.split(/\r?\n/,1)[0]||'';
  const sep=(firstLine.match(/;/g)||[]).length>=(firstLine.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){
      if(ch==='"'){ if(text[i+1]==='"'){cur+='"';i++} else q=false }
      else cur+=ch;
    }else{
      if(ch==='"')q=true;
      else if(ch===sep){row.push(cur);cur=''}
      else if(ch==='\n'||ch==='\r'){
        if(ch==='\r'&&text[i+1]==='\n')i++;
        row.push(cur);cur='';
        if(row.some(c=>c.trim()!==''))rows.push(row);
        row=[];
      }
      else cur+=ch;
    }
  }
  row.push(cur);
  if(row.some(c=>c.trim()!==''))rows.push(row);
  return rows;
}

const GABARIT='\uFEFF'+[
  'type_periode;periode;filiale;activite;agents;heures_loguees;heures_productives;appels_traites;fiches_traitees;dmt_sec;ca_facture;masse_salariale;t_comm_h;t_attente_h;t_acw_h',
  'hebdo;2026-S33;Congo;Service Client;44;1760;1390;20400;0;245;13620000;7900000;;;',
  'hebdo;2026-S33;Congo;Back Office;18;720;590;0;5450;0;4480000;2610000;;;',
  "mensuel;2026-07;Côte d'Ivoire;Support Technique;22;3690;3020;26400;0;412;37750000;20760000;;;"
].join('\r\n');
