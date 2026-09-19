(() => {
  const VERSION='0.5.0';
  const p=new URLSearchParams(location.search);
  const wantedPlate=(p.get('bildiagnosReg')||'').replace(/\s+/g,'').toUpperCase();
  const clickPath=(p.get('bdClick')||'').split('>').map(s=>s.trim()).filter(Boolean);
  const searchText=(p.get('bdSearch')||'').trim();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const norm=v=>String(v||'').replace(/\s+/g,' ').trim().toLowerCase();

  function status(msg,ok=true){
    let n=document.getElementById('bildiagnos-ad-helper-status');
    if(!n){n=document.createElement('div');n.id='bildiagnos-ad-helper-status';n.setAttribute('role','status');
      Object.assign(n.style,{position:'fixed',right:'12px',bottom:'12px',zIndex:'2147483647',padding:'8px 11px',borderRadius:'7px',font:'12px/1.35 Arial,sans-serif',boxShadow:'0 2px 8px rgba(0,0,0,.25)',maxWidth:'420px'});document.documentElement.appendChild(n);}
    n.style.background=ok?'#153d23':'#6b1d1d';n.style.color='#fff';n.textContent='Bildiagnos AD Helper v'+VERSION+': '+msg;
  }

  function labels(el){
    const a=[el.textContent,el.getAttribute?.('aria-label'),el.getAttribute?.('title'),el.getAttribute?.('alt'),el.getAttribute?.('data-tooltip')];
    const t=el.querySelector?.('title'); if(t)a.push(t.textContent);
    return a.filter(Boolean).map(norm);
  }

  function findMatches(label){
    const target=norm(label);
    const els=[...document.querySelectorAll('button,a,[role="button"],[aria-label],[title],svg,g,li,span,div,p')];
    return els.map(el=>({el,score:Math.max(-1,...labels(el).map(v=>v===target?100:(v.includes(target)||target.includes(v)?60:-1)))}))
      .filter(x=>x.score>=0).sort((a,b)=>b.score-a.score).map(x=>x.el);
  }

  function ancestors(el){
    const out=[]; let n=el;
    for(let i=0;n&&i<8;i++,n=n.parentElement){out.push(n);}
    return out.filter((v,i,a)=>a.indexOf(v)===i);
  }

  function fire(el){
    try{el.scrollIntoView({block:'center',inline:'center'});}catch{}
    for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){
      try{el.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window}));}catch{}
    }
    try{el.click?.();}catch{}
  }

  function pageSig(){
    return norm(document.body.innerText).slice(0,12000);
  }

  async function waitForLabel(label,timeout=3500){
    const end=Date.now()+timeout;
    while(Date.now()<end){if(findMatches(label).length)return true; await sleep(180);}
    return false;
  }

  async function waitForChange(before,timeout=2500){
    const end=Date.now()+timeout;
    while(Date.now()<end){if(pageSig()!==before)return true; await sleep(180);}
    return false;
  }

  async function clickStep(label,nextLabel){
    for(let round=0;round<4;round++){
      const matches=findMatches(label).slice(0,6);
      for(const m of matches){
        for(const candidate of ancestors(m)){
          const before=pageSig();
          fire(candidate);
          if(nextLabel){
            if(await waitForLabel(nextLabel,1100)) return true;
          }else{
            if(await waitForChange(before,1100)) return true;
            const cls=norm(candidate.className);
            if(/active|selected|open/.test(cls)) return true;
          }
        }
      }
      await sleep(300);
    }
    return false;
  }

  function setNativeValue(input,value){
    const proto=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const d=Object.getOwnPropertyDescriptor(proto,'value');
    if(d?.set)d.set.call(input,value); else input.value=value;
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function globalSearch(){
    const inputs=[...document.querySelectorAll('input')];
    return inputs.find(i=>/sok regnr|chassinr|artiklar|search/i.test(norm(i.placeholder)+' '+norm(i.getAttribute('aria-label'))))||inputs[0]||null;
  }
  function vehicleSearch(){
    const inputs=[...document.querySelectorAll('input')];
    return inputs.find(i=>/sok i vald bil/i.test(norm(i.placeholder)+' '+norm(i.getAttribute('aria-label'))))||null;
  }
  function pressEnter(input){input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));input.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));}

  async function ensurePlate(plate){
    if(!plate)return true;
    for(let i=0;i<12;i++){if(norm(document.body.innerText).includes(norm(plate)))return true;await sleep(250);}
    const input=globalSearch(); if(!input)return false;
    input.focus();setNativeValue(input,plate);pressEnter(input);await sleep(900);
    const hit=findMatches(plate)[0]; if(hit){for(const a of ancestors(hit)){fire(a);await sleep(350);if(norm(document.body.innerText).includes(norm(plate)))return true;}}
    return norm(document.body.innerText).includes(norm(plate));
  }

  async function runPath(parts){
    for(let i=0;i<parts.length;i++){
      const part=parts[i],next=parts[i+1]||'';
      status('abriendo "'+part+'"...');
      const ok=await clickStep(part,next);
      if(!ok){status('no pude abrir "'+part+'".',false);return false;}
      await sleep(600);
    }
    return true;
  }

  async function runSearch(value){
    if(!value)return true;
    const input=vehicleSearch()||globalSearch(); if(!input)return false;
    const before=pageSig();input.focus();setNativeValue(input,value);pressEnter(input);
    return await waitForChange(before,2500);
  }

  async function main(){
    status('iniciando...');
    if(!await ensurePlate(wantedPlate)){status('no pude seleccionar '+wantedPlate+'.',false);return;}
    if(clickPath.length && !await runPath(clickPath))return;
    if(searchText && !await runSearch(searchText)){status('no pude ejecutar la busqueda "'+searchText+'".',false);return;}
    status('listo'+(wantedPlate?' - '+wantedPlate:'')+'.');
  }
  main().catch(e=>status(e?.message||'error inesperado',false));
})();