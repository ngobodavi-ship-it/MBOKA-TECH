/* lib/graphiques.js — Micro-bibliothèque de graphiques SVG (hbar, stack, group2, lines) + formatage (nf, mmss, fcfa, esc). Sans dépendance. */
// Micro-bibliothèque de graphiques SVG (sans dépendance) + formatage.
const nf=(v,d=0)=>new Intl.NumberFormat('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
const mmss=s=>{if(!s)return '—';const m=Math.floor(s/60),x=Math.round(s%60);return m+"'"+String(x).padStart(2,'0')+'"'};
const fcfa=v=>v>=1e6?nf(v/1e6,1)+' M':v>=1e3?nf(v/1e3,0)+' k':nf(v,0);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const NS='http://www.w3.org/2000/svg';
const cv=(n,f)=>{try{return getComputedStyle(document.documentElement).getPropertyValue(n).trim()||f}catch(e){return f}};
function svg(w,h){const s=document.createElementNS(NS,'svg');s.setAttribute('viewBox',`0 0 ${w} ${h}`);s.setAttribute('width','100%');s.style.display='block';s.setAttribute('role','img');return s}
function el(t,a){const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);return e}
function txt(x,y,s,o={}){const t=el('text',{x,y,'font-size':o.size||10.5,'font-family':'IBM Plex Sans, system-ui, sans-serif',fill:o.fill||cv('--chart-muted','#56707B'),'text-anchor':o.anchor||'start','font-weight':o.weight||400});t.textContent=s;return t}

function hbar(node,data,{unit='',fmt=v=>nf(v),color='#0E8C8C',ref=null,refLab=''}={}){
  node.innerHTML='';
  if(!data.length){node.innerHTML='<div style="padding:28px 0;font-family:var(--mono);font-size:11px;color:#9A9A9A">Aucun appel sur la sélection (activité Back Office : voir « fiches traitées »).</div>';return}
  const rowH=34, padL=132, padR=64, w=Math.max(340,Math.round(node.clientWidth||640)), h=data.length*rowH+22;
  const s=svg(w,h);
  const max=Math.max(...data.map(d=>d.v), ref||0)*1.12||1;
  const x=v=>padL+(w-padL-padR)*(v/max);
  data.forEach((d,i)=>{
    const y=i*rowH+6;
    s.appendChild(el('rect',{x:padL,y:y,width:w-padL-padR,height:16,fill:cv('--chart-track','#EEF3F5'),rx:4}));
    s.appendChild(el('rect',{x:padL,y:y,width:Math.max(2,x(d.v)-padL),height:16,fill:d.color||color,rx:4}));
    s.appendChild(txt(padL-9,y+12,d.k,{anchor:'end',fill:cv('--chart-ink','#10232C'),mono:false,size:12,weight:500}));
    s.appendChild(txt(x(d.v)+7,y+12,fmt(d.v)+unit,{fill:cv('--chart-ink','#10232C'),size:11.5,weight:600}));
  });
  if(ref!==null){
    const xr=x(ref);
    s.appendChild(el('line',{x1:xr,y1:2,x2:xr,y2:data.length*rowH+2,stroke:'#D7262E','stroke-width':1.2,'stroke-dasharray':'4 3'}));
    s.appendChild(txt(xr+4,data.length*rowH+16,refLab,{fill:'#D7262E',size:11,weight:500}));
  }
  node.appendChild(s);
}

function stack(node,rows,keys,colors){
  node.innerHTML='';
  const rowH=34, padL=118, w=Math.max(340,Math.round(node.clientWidth||640)), h=rows.length*rowH+8;
  const s=svg(w,h);
  rows.forEach((r,i)=>{
    const y=i*rowH+7, tot=keys.reduce((t,k)=>t+r[k],0)||1;
    let x=padL;
    keys.forEach((k,j)=>{
      const wd=(w-padL-8)*(r[k]/tot);
      s.appendChild(el('rect',{x,y,width:Math.max(0,wd),height:20,fill:colors[j]}));
      if(wd>34)s.appendChild(txt(x+wd/2,y+12.5,Math.round(r[k]/tot*100)+'%',{anchor:'middle',fill:j===3?cv('--chart-muted','#56707B'):'#fff',size:10.5,weight:600}));
      x+=wd;
    });
    s.appendChild(txt(padL-9,y+13,r.k,{anchor:'end',fill:cv('--chart-ink','#10232C'),mono:false,size:12,weight:500}));
  });
  node.appendChild(s);
}

function group2(node,data){
  node.innerHTML='';
  const w=Math.max(340,Math.round(node.clientWidth||640)),h=260,padB=46,padT=18,padL=56;
  const s=svg(w,h);
  const max=Math.max(...data.flatMap(d=>[d.a,d.b]))*1.15||1;
  const y=v=>h-padB-(h-padB-padT)*(v/max);
  [0,.25,.5,.75,1].forEach(t=>{
    const yy=y(max*t);
    s.appendChild(el('line',{x1:padL,y1:yy,x2:w-8,y2:yy,stroke:cv('--chart-grid','#EAF0F2'),'stroke-width':1}));
    s.appendChild(txt(padL-8,yy+3.5,fcfa(max*t),{anchor:'end',size:10}));
  });
  const bw=(w-padL-16)/data.length;
  data.forEach((d,i)=>{
    const x0=padL+i*bw+bw*0.16, bwe=bw*0.29;
    s.appendChild(el('rect',{x:x0,y:y(d.a),width:bwe,height:h-padB-y(d.a),fill:'#0E8C8C',rx:3}));
    s.appendChild(el('rect',{x:x0+bwe+4,y:y(d.b),width:bwe,height:h-padB-y(d.b),fill:'#E9A23B',rx:3}));
    const marge=d.a?(d.a-d.b)/d.a*100:0;
    s.appendChild(txt(x0+bwe+2,y(Math.max(d.a,d.b))-7,nf(marge,0)+'%',{anchor:'middle',size:10.5,weight:600,fill:marge<25?'#D7262E':'#178A55'}));
    s.appendChild(txt(x0+bwe+2,h-padB+16,d.k,{anchor:'middle',size:11.5,fill:cv('--chart-ink','#10232C'),mono:false,weight:500}));
  });
  s.appendChild(txt(padL,h-8,'Marge sur coût direct affichée au-dessus des barres',{size:10.5,fill:cv('--chart-faint','#8EA3AC')}));
  node.appendChild(s);
}

function lines(node,series,fmtA,fmtB){
  node.innerHTML='';
  const w=Math.max(340,Math.round(node.clientWidth||640)),h=260,padB=40,padT=18,padL=60,padR=52;
  const s=svg(w,h);
  const n=series.labels.length;
  if(!n){node.innerHTML='<div style="padding:28px 0;font-family:var(--mono);font-size:11px;color:#9A9A9A">Pas assez de périodes pour tracer une tendance.</div>';return}
  const maxA=Math.max(...series.a)*1.15||1, maxB=Math.max(...series.b)*1.2||1;
  const X=i=>padL+(w-padL-padR)*(n<2?0.5:i/(n-1));
  const YA=v=>h-padB-(h-padB-padT)*(v/maxA);
  const YB=v=>h-padB-(h-padB-padT)*(v/maxB);
  [0,.5,1].forEach(t=>{
    const yy=YA(maxA*t);
    s.appendChild(el('line',{x1:padL,y1:yy,x2:w-padR,y2:yy,stroke:cv('--chart-grid','#EAF0F2')}));
    s.appendChild(txt(padL-8,yy+3.5,fmtA(maxA*t),{anchor:'end',size:10}));
    s.appendChild(txt(w-padR+8,YB(maxB*t)+3.5,fmtB(maxB*t),{anchor:'start',size:10,fill:'#0E8C8C'}));
  });
  const area='M'+series.a.map((v,i)=>X(i)+','+YA(v)).join(' L')+` L${X(n-1)},${h-padB} L${X(0)},${h-padB} Z`;
  s.appendChild(el('path',{d:area,fill:cv('--chart-a','#0B3140'),'fill-opacity':.07}));
  s.appendChild(el('path',{d:'M'+series.a.map((v,i)=>X(i)+','+YA(v)).join(' L'),fill:'none',stroke:cv('--chart-a','#0B3140'),'stroke-width':2.2,'stroke-linejoin':'round'}));
  s.appendChild(el('path',{d:'M'+series.b.map((v,i)=>X(i)+','+YB(v)).join(' L'),fill:'none',stroke:'#0E8C8C','stroke-width':2.2,'stroke-linejoin':'round'}));
  if(n){s.appendChild(el('circle',{cx:X(n-1),cy:YA(series.a[n-1]),r:4,fill:cv('--chart-a','#0B3140'),stroke:cv('--surface','#fff'),'stroke-width':1.5}));
        s.appendChild(el('circle',{cx:X(n-1),cy:YB(series.b[n-1]),r:4,fill:'#0E8C8C',stroke:cv('--surface','#fff'),'stroke-width':1.5}))}
  series.labels.forEach((l,i)=>{ if(n>8&&i%2)return; s.appendChild(txt(X(i),h-padB+16,l,{anchor:'middle',size:10})) });
  node.appendChild(s);
}
