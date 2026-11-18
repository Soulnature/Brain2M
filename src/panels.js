// Static anatomical/axis backgrounds with observed significant records as hotspots.
import { GWS, T_THRESHOLD } from './config.js';
import { regionName, snpLabel, voxelLabel } from './model.js';
import { formatP } from './resource.js';
const $=id=>document.getElementById(id);
const C={muted:'#a9bacb',teal:'#7fe3d4',amber:'#ffd27a',grid:'rgba(150,210,225,.14)'};
const PAGE=20;
function fit(canvas) {
  const dpr=Math.min(window.devicePixelRatio||1,2),w=canvas.clientWidth,h=canvas.clientHeight;
  canvas.width=Math.max(1,Math.round(w*dpr));canvas.height=Math.max(1,Math.round(h*dpr));
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w,h};
}
export function tColor(t,tmax) {
  if(!Number.isFinite(t)||Math.abs(t)<T_THRESHOLD)return null;
  const m=Math.min(1,Math.abs(t)/Math.max(tmax,.0001));
  return t>0?[255,80+150*m,40+60*m]:[50+60*m,110+130*m,255];
}
function button(text,fn,label=text) {
  const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=text;b.setAttribute('aria-label',label);b.addEventListener('click',fn);return b;
}
function download(rows,columns,filename) {
  const text=[columns.join('\t'),...rows.map(r=>r.join('\t'))].join('\n')+'\n';
  const url=URL.createObjectURL(new Blob([text],{type:'text/tab-separated-values;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function createPanels({genome,vox,on}) {
  const resource=vox.resource,man={records:[],sel:null,page:0,points:[],id:null};
  const view={s:null,T:new Map(),records:[],page:0,focus:null,tmax:10};
  const slices=[{id:'sliceAx',u:0,v:1,fixed:2,label:'Axial'},{id:'sliceCor',u:0,v:2,fixed:1,label:'Coronal'},{id:'sliceSag',u:1,v:2,fixed:0,label:'Sagittal'}];
  const axis=new Image();axis.src=new URL('../assets/significant-genome-axis.svg',import.meta.url).href;axis.onload=()=>drawManhattan();
  const off=document.createElement('canvas');
  function drawManhattan() {
    if(man.id==null||$('panelVoxel').hidden)return;
    const {ctx,w,h}=fit($('manhattan')),L=42,R=10,top=9,bottom=25,pw=w-L-R,ph=h-top-bottom;
    if(axis.complete&&axis.naturalWidth)ctx.drawImage(axis,L,top,pw,ph+bottom);
    const ymax=Math.max(16,...man.records.map(r=>r.lp))*1.08;
    const X=s=>L+genome.x[s]*pw,Y=lp=>top+ph*(1-lp/ymax);
    ctx.font='11px system-ui';ctx.fillStyle=C.muted;ctx.textAlign='right';ctx.textBaseline='middle';
    for(let n=0;n<=4;n++){const v=ymax*n/4;ctx.fillText(v.toFixed(0),L-6,Y(v));ctx.strokeStyle=C.grid;ctx.beginPath();ctx.moveTo(L,Y(v));ctx.lineTo(L+pw,Y(v));ctx.stroke();}
    ctx.setLineDash([4,4]);ctx.strokeStyle=C.amber;ctx.beginPath();ctx.moveTo(L,Y(GWS));ctx.lineTo(L+pw,Y(GWS));ctx.stroke();ctx.setLineDash([]);
    ctx.textBaseline='bottom';ctx.fillStyle=C.amber;ctx.fillText('5e−8 / 2,075,298',w-10,Y(GWS)-3);
    man.points=man.records.map(r=>({...r,x:X(r.s),y:Y(r.lp)}));
    for(const p of man.points){ctx.fillStyle=p.s===man.sel?'#ffffff':C.amber;ctx.beginPath();ctx.arc(p.x,p.y,p.s===man.sel?3.7:2.1,0,Math.PI*2);ctx.fill();}
    if(!man.records.length){ctx.fillStyle=C.muted;ctx.textAlign='center';ctx.fillText('No exported significant associations at this voxel.',w/2,h/2);}
  }
  function hitMan(e) {
    const rect=$('manhattan').getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
    let best=null,distance=64;
    for(const p of man.points){const d=(x-p.x)**2+(y-p.y)**2;if(d<distance){distance=d;best=p;}}
    return best;
  }
  $('manhattan').addEventListener('pointermove',e=>{
    const p=hitMan(e);$('manhattan').style.cursor=p?'pointer':'default';
    $('manReadout').textContent=p?`${snpLabel(genome,p.s)} · T ${p.t.toFixed(3)} · P ${formatP(p.lp)}`:'Only observed significant SNP markers are clickable.';
  });
  $('manhattan').addEventListener('click',e=>{const p=hitMan(e);if(p)on.snp(p.s);});
  function table(target,records,page,makeRow,move) {
    const body=$(target+'Body');body.replaceChildren();
    records.slice(page*PAGE,(page+1)*PAGE).forEach(r=>{
      const tr=document.createElement('tr');for(const cell of makeRow(r)){const td=document.createElement('td');if(cell instanceof Node)td.append(cell);else td.textContent=cell;tr.append(td);}body.append(tr);
    });
    $(target+'Count').textContent=`${records.length.toLocaleString('en-US')} significant associations · ${records.length?`${page*PAGE+1}–${Math.min(records.length,(page+1)*PAGE)}`:'0'} shown`;
    const pager=$(target+'Pager');pager.replaceChildren();
    const prev=button('Previous',()=>move(-1)),next=button('Next',()=>move(1));prev.disabled=page===0;next.disabled=(page+1)*PAGE>=records.length;pager.append(prev,next);
  }
  function voxelTable() {
    table('voxel',man.records,man.page,r=>[button(genome.rows[r.s][1],()=>on.snp(r.s)),`chr${genome.chr[r.s]}:${genome.rows[r.s][3]}`,r.t.toFixed(3),r.lp.toFixed(4)],d=>{man.page+=d;voxelTable();});
    const peaks=$('manPeaks');peaks.replaceChildren();
    for(const r of man.records.slice(0,3))peaks.append(button(genome.rows[r.s][1],()=>on.snp(r.s)));
  }
  function snpTable() {
    table('snp',view.records,view.page,r=>[button(resource.ijkOf(r.other).join(', '),()=>on.voxel(r.other),`Open voxel ${resource.ijkOf(r.other).join(' ')}`),regionName(vox,r.other),r.t.toFixed(3),r.lp.toFixed(4)],d=>{view.page+=d;snpTable();});
  }
  function drawSlices() {
    if(view.s==null||$('panelSnp').hidden)return;
    const f=resource.ijkOf(view.focus);
    for(const sl of slices){
      const du=vox.dims[sl.u],dv=vox.dims[sl.v],ijk=[...f];off.width=du;off.height=dv;
      const octx=off.getContext('2d'),img=octx.createImageData(du,dv);
      for(let a=0;a<du;a++)for(let b=0;b<dv;b++) {
        ijk[sl.u]=a;ijk[sl.v]=b;const flat=(ijk[0]*vox.dims[1]+ijk[1])*vox.dims[2]+ijk[2],v=resource.grid[flat],g=resource.template[flat];
        const row=view.T.get(v),c=row?tColor(row.t,view.tmax):[g*.90,g*.95,g];const o=4*((dv-1-b)*du+a);
        img.data[o]=c[0];img.data[o+1]=c[1];img.data[o+2]=c[2];img.data[o+3]=255;
      }
      octx.putImageData(img,0,0);const {ctx,w,h}=fit($(sl.id)),scale=Math.min(w/du,h/dv),ox=(w-du*scale)/2,oy=(h-dv*scale)/2;
      sl.map={scale,ox,oy,du,dv};ctx.imageSmoothingEnabled=false;ctx.drawImage(off,ox,oy,du*scale,dv*scale);
      ctx.strokeStyle='rgba(255,255,255,.6)';ctx.lineWidth=.7;
      const x=ox+(f[sl.u]+.5)*scale,y=oy+(dv-.5-f[sl.v])*scale;
      ctx.beginPath();ctx.moveTo(x,oy);ctx.lineTo(x,oy+dv*scale);ctx.moveTo(ox,y);ctx.lineTo(ox+du*scale,y);ctx.stroke();
      // Orientation letters: i runs right-to-left (radiological view), j runs posterior-to-anterior.
      const [lo,hi]=sl.u===0?['R','L']:['P','A'];
      ctx.font='600 10px system-ui';ctx.fillStyle='rgba(255,255,255,.8)';ctx.textBaseline='top';
      ctx.textAlign='left';ctx.fillText(lo,ox+3,oy+3);ctx.textAlign='right';ctx.fillText(hi,ox+du*scale-3,oy+3);
      const mni=[90-f[0],f[1]-126,f[2]-72];
      $(sl.id).nextElementSibling.textContent=`${sl.label} · ${['x','y','z'][sl.fixed]} = ${mni[sl.fixed]} mm`;
    }
  }
  function sliceHit(sl,e) {
    if(!sl.map||view.focus==null)return null;
    const rect=$(sl.id).getBoundingClientRect(),p=resource.ijkOf(view.focus),m=sl.map;
    p[sl.u]=Math.floor((e.clientX-rect.left-m.ox)/m.scale);p[sl.v]=m.dv-1-Math.floor((e.clientY-rect.top-m.oy)/m.scale);
    const id=resource.at(p);return view.T.has(id)?{id,row:view.T.get(id)}:null;
  }
  for(const sl of slices){
    $(sl.id).addEventListener('click',e=>{const hit=sliceHit(sl,e);if(hit)on.voxel(hit.id);});
    $(sl.id).addEventListener('pointermove',e=>{const hit=sliceHit(sl,e);$(sl.id).style.cursor=hit?'pointer':'default';$('sliceReadout').textContent=hit?`${voxelLabel(vox,hit.id)} · T ${hit.row.t.toFixed(3)} · P ${formatP(hit.row.lp)}`:'Static anatomical background; colored voxels show observed significant associations.';});
  }
  $('downloadSnp').addEventListener('click',()=>{
    if(view.s==null)return;const row=genome.rows[view.s];download(view.records.map(r=>[row[1],row[2],row[3],row[4],row[5],r.other,...resource.ijkOf(r.other),r.t,r.lp,regionName(vox,r.other)]),['SNP','CHR','BP','A1','A2','source_voxel_ID','i','j','k','T','minus_log10_P','Brain2M120_region'],`${row[1]}_significant_voxels.tsv`);
  });
  $('downloadVoxel').addEventListener('click',()=>{
    if(man.id==null)return;download(man.records.map(r=>{const s=genome.rows[r.s];return [s[1],s[2],s[3],s[4],s[5],man.id,...resource.ijkOf(man.id),r.t,r.lp];}),['SNP','CHR','BP','A1','A2','source_voxel_ID','i','j','k','T','minus_log10_P'],`voxel_${resource.ijkOf(man.id).join('_')}_significant_SNPs.tsv`);
  });
  $('closeVoxel').addEventListener('click',on.closeVoxel);$('closeSnp').addEventListener('click',on.closeSnp);
  $('prevSnp').addEventListener('click',()=>on.step(-1));$('nextSnp').addEventListener('click',()=>on.step(1));
  window.addEventListener('resize',()=>{drawManhattan();drawSlices();});
  return {
    showVoxel(id,records) {
      man.id=id;man.records=[...records].sort((a,b)=>b.lp-a.lp);man.page=0;
      $('manReadout').textContent='Only observed significant SNP markers are clickable.';
      $('voxTitle').textContent=`${voxelLabel(vox,id)} · ${regionName(vox,id)}`;$('panelVoxel').hidden=false;
      $('panelVoxel').dataset.voxelId=String(id);voxelTable();drawManhattan();
    },
    hideVoxel(){$('panelVoxel').hidden=true;man.id=null;man.points=[];},
    markSnp(s){man.sel=s;drawManhattan();},
    showSnp({s,T,records,tmax,focus,peak,peakT}) {
      if(view.s!==s||view.focus!==focus)$('sliceReadout').textContent='Static anatomical background; colored voxels show observed significant associations.';
      if(view.s!==s){view.page=0;view.records=[...records].sort((a,b)=>b.lp-a.lp);}
      Object.assign(view,{s,T,tmax,focus});const r=genome.rows[s];
      $('snpTitle').textContent=r[1];$('snpMeta').textContent=`chr${r[2]}:${r[3].toLocaleString('en-US')} · ${r[4]}/${r[5]} · ${records.length.toLocaleString('en-US')} significant voxels. Peak T ${peakT.toFixed(3)}; P ${formatP(r[9])}. ${regionName(vox,peak)}.`;
      $('locusCap').textContent='Native 1-mm significant voxels';$('tmaxLabel').textContent=`+${tmax.toFixed(1)}`;$('tminLabel').textContent=`−${tmax.toFixed(1)}`;
      $('panelSnp').hidden=false;$('panelSnp').dataset.sid=String(r[0]);snpTable();drawSlices();
    },
    hideSnp(){$('panelSnp').hidden=true;view.s=null;view.T=new Map();},
    redraw(){drawManhattan();drawSlices();},
  };
}
