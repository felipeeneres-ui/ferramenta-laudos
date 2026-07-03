import { buildSvg } from './exportPng';
import { LOCAL_COLORS, type Project } from './types';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface PointEntry {
  label: string;
  tipo: string;
  comodo: string;
  color: string;
  descricao: string;
  photos: { src: string; nome: string; descricao: string }[];
}

// CSS da página do cliente (estático — sem interpolação).
const CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2329;background:#eef0f3;display:flex;flex-direction:column}
header{background:#0F1E3C;color:#fff;padding:14px 20px}
header h1{margin:0;font-size:18px;font-weight:600}
header p{margin:4px 0 0;font-size:13px;opacity:.8}
.floors{display:flex;gap:6px;padding:10px 16px 0;background:#eef0f3}
.floor-tab{border:1px solid #c7ccd4;background:#fff;color:#46536B;padding:6px 14px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer}
.floor-tab.on{background:#0F1E3C;color:#fff;border-color:#0F1E3C}
.wrap{flex:1;min-height:0;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:20px}
.stage{display:none;width:100%;max-width:960px}
.stage.on{display:block}
.stage svg{width:100%;height:auto;background:#fff;border:1px solid #d7dbe0;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.pt{cursor:pointer}
.pt circle{transition:opacity .12s}
.pt:hover circle{opacity:1;fill:transparent;stroke:#0F1E3C;stroke-width:2;stroke-dasharray:4 3}
.pt.sel circle{opacity:1;fill:transparent;stroke:#0F1E3C;stroke-width:3}
.panel{position:fixed;top:0;right:0;height:100%;width:340px;max-width:88vw;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,.18);transform:translateX(100%);transition:transform .22s ease;z-index:20;display:flex;flex-direction:column}
.panel.open{transform:none}
.pclose{position:absolute;top:8px;right:10px;border:0;background:none;font-size:26px;line-height:1;color:#46536B;cursor:pointer}
#pc{padding:48px 18px 18px;overflow:auto}
.ph-head{font-size:16px;margin-bottom:2px}
.ph-head .dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:7px;vertical-align:middle}
.ph-room{font-size:13px;color:#46536B;margin-bottom:8px}
.ph-desc{font-size:13.5px;line-height:1.5;color:#2b2f36;margin:0 0 14px;white-space:pre-wrap}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.thumb{padding:0;border:1px solid #d7dbe0;border-radius:8px;overflow:hidden;cursor:pointer;background:#f3f4f6;aspect-ratio:4/3}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.empty{color:#8a909a;font-size:13px}
.lb{position:fixed;inset:0;background:rgba(10,14,24,.92);display:none;align-items:center;justify-content:center;z-index:40}
.lb.open{display:flex}
.lb img{max-width:92vw;max-height:84vh;object-fit:contain;border-radius:4px}
.lb .x{position:absolute;top:14px;right:18px;font-size:34px;color:#fff;background:none;border:0;cursor:pointer;line-height:1}
.lb .nav{position:absolute;top:50%;transform:translateY(-50%);font-size:46px;color:#fff;background:none;border:0;cursor:pointer;padding:0 14px;opacity:.8}
.lb .nav:hover{opacity:1}
.lb .prev{left:6px}.lb .next{right:6px}
#lbcap{position:absolute;bottom:18px;left:0;right:0;text-align:center;color:#fff;font-size:14px;padding:0 20px}
@media(max-width:700px){
 .panel{top:auto;bottom:0;height:72%;width:100%;max-width:100%;transform:translateY(100%);box-shadow:0 -4px 24px rgba(0,0,0,.2);border-radius:14px 14px 0 0}
 .panel.open{transform:none}
 .grid{grid-template-columns:1fr 1fr 1fr}
}
`;

// Lógica de interação (estática — sem interpolação; evita template literals com cifrão).
const JS = `
(function(){
 var panel=document.getElementById('panel'),pc=document.getElementById('pc');
 var lb=document.getElementById('lb'),lbImg=document.getElementById('lbimg'),lbCap=document.getElementById('lbcap');
 var cur=[],idx=0;
 function e(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
 function sel(id,el){
  var d=DATA[id]; if(!d) return;
  var s=document.querySelectorAll('.pt.sel'); for(var i=0;i<s.length;i++) s[i].classList.remove('sel');
  if(el) el.classList.add('sel');
  var h='<div class="ph-head"><span class="dot" style="background:'+d.color+'"></span><b>'+e(d.label)+'</b> '+e(d.tipo)+'</div>';
  if(d.comodo) h+='<div class="ph-room">'+e(d.comodo)+'</div>';
  if(d.descricao) h+='<p class="ph-desc">'+e(d.descricao)+'</p>';
  if(d.photos.length){ h+='<div class="grid">'; for(var j=0;j<d.photos.length;j++){ h+='<button class="thumb" data-i="'+j+'"><img src="'+d.photos[j].src+'" alt=""></button>'; } h+='</div>'; }
  else { h+='<p class="empty">Sem fotos vinculadas a este ponto.</p>'; }
  pc.innerHTML=h; cur=d.photos; panel.classList.add('open');
  var t=pc.querySelectorAll('.thumb'); for(var k=0;k<t.length;k++){ (function(b){ b.onclick=function(){ open(parseInt(b.getAttribute('data-i'),10)); }; })(t[k]); }
 }
 function open(i){ idx=i; draw(); lb.classList.add('open'); }
 function draw(){ var p=cur[idx]; if(!p) return; lbImg.src=p.src; lbCap.textContent=p.descricao||p.nome; }
 function close(){ lb.classList.remove('open'); }
 function go(d){ if(!cur.length) return; idx=(idx+d+cur.length)%cur.length; draw(); }
 var pts=document.querySelectorAll('[data-point]');
 for(var i=0;i<pts.length;i++){ (function(el){ el.addEventListener('click',function(){ sel(el.getAttribute('data-point'),el); }); })(pts[i]); }
 document.getElementById('pclose').onclick=function(){ panel.classList.remove('open'); var s=document.querySelectorAll('.pt.sel'); for(var i=0;i<s.length;i++) s[i].classList.remove('sel'); };
 document.getElementById('lbclose').onclick=close;
 document.getElementById('lbprev').onclick=function(){ go(-1); };
 document.getElementById('lbnext').onclick=function(){ go(1); };
 lb.addEventListener('click',function(ev){ if(ev.target===lb) close(); });
 document.addEventListener('keydown',function(ev){ if(lb.classList.contains('open')){ if(ev.key==='Escape') close(); else if(ev.key==='ArrowLeft') go(-1); else if(ev.key==='ArrowRight') go(1); } });
 var ft=document.querySelectorAll('.floor-tab');
 for(var f=0;f<ft.length;f++){ (function(t){ t.onclick=function(){ var fl=t.getAttribute('data-floor'); var all=document.querySelectorAll('.floor-tab'); for(var a=0;a<all.length;a++) all[a].classList.toggle('on',all[a]===t); var st=document.querySelectorAll('.stage'); for(var b=0;b<st.length;b++) st[b].classList.toggle('on',st[b].getAttribute('data-floor')===fl); panel.classList.remove('open'); }; })(ft[f]); }
})();
`;

// Monta o arquivo HTML autocontido (croqui interativo + fotos embutidas).
export function buildInteractiveHtml(
  project: Project,
  srcMap: Map<string, string>,
  bgMap: Map<string, string> = new Map(),
): string {
  const floors = project.floors.filter(
    (f) =>
      f.walls.length > 0 ||
      !!f.bg ||
      (f.traces ?? []).length > 0 ||
      project.points.some((p) => p.floorId === f.id),
  );
  const floorSvgs = floors.map((f) => {
    const pts = project.points.filter((p) => p.floorId === f.id);
    return {
      id: f.id,
      nome: f.nome,
      svg: buildSvg(f, project.anomalyTypes, pts, project.croquiPointSize ?? 18, {
        interactive: true,
        bgDataUrl: bgMap.get(f.id),
      }).svg,
    };
  });

  const data: Record<string, PointEntry> = {};
  for (const p of project.points) {
    const type = project.anomalyTypes.find((t) => t.id === p.typeId);
    const linked = project.photos.filter((ph) => ph.classification && ph.pointIds.includes(p.id));
    data[p.id] = {
      label: `${type?.prefix ?? '?'}${p.numero}`,
      tipo: type?.nome ?? '',
      comodo: p.comodo || '',
      color: LOCAL_COLORS[p.local],
      descricao: p.descricao || '',
      photos: linked
        .map((ph) => ({ src: srcMap.get(ph.id) || '', nome: ph.nome, descricao: ph.descricao || '' }))
        .filter((x) => x.src),
    };
  }

  const tabs =
    floorSvgs.length > 1
      ? '<div class="floors">' +
        floorSvgs
          .map((f, i) => `<button class="floor-tab${i === 0 ? ' on' : ''}" data-floor="${esc(f.id)}">${esc(f.nome)}</button>`)
          .join('') +
        '</div>'
      : '';
  const stages = floorSvgs
    .map((f, i) => `<div class="stage${i === 0 ? ' on' : ''}" data-floor="${esc(f.id)}">${f.svg}</div>`)
    .join('');

  const json = JSON.stringify(data);
  const nome = esc(project.nome || 'Laudo');

  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${nome} — Croqui interativo</title><style>${CSS}</style></head><body>` +
    `<header><h1>${nome}</h1><p>Clique em um ponto de anomalia no croqui para ver as fotos.</p></header>` +
    tabs +
    `<div class="wrap">${stages}</div>` +
    '<aside id="panel" class="panel"><button id="pclose" class="pclose" aria-label="Fechar">&times;</button><div id="pc"></div></aside>' +
    '<div id="lb" class="lb"><button id="lbclose" class="x" aria-label="Fechar">&times;</button>' +
    '<button id="lbprev" class="nav prev" aria-label="Anterior">&lsaquo;</button>' +
    '<img id="lbimg" alt=""><div id="lbcap"></div>' +
    '<button id="lbnext" class="nav next" aria-label="Próxima">&rsaquo;</button></div>' +
    `<script>var DATA=${json};\n${JS}</script>` +
    '</body></html>'
  );
}
