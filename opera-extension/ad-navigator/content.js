(() => {
  const VERSION='0.6.0';
  const p=new URLSearchParams(location.search);
  const wantedPlate=(p.get('bildiagnosReg')||'').replace(/\s+/g,'').toUpperCase();
  const clickPath=(p.get('bdClick')||'').split('>').map(s=>s.trim()).filter(Boolean);
  const searchText=(p.get('bdSearch')||'').trim();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const norm=v=>String(v||'').replace(/\s+/g,' ').trim().toLowerCase();

  function status(msg,ok=true){
    let n=document.getElementById('bildiagnos-ad-helper-status');
    if(!n){n=document.createElement('div');n.id='bildiagnos-ad-helper-status';n.setAttribute('role','status');
      Object.assign(n.style,{position:'fixed',right:'12px',bottom:'12px',zIndex:'2147483647',padding:'8px 11px',borderRadius:'7px',font:'12px/1.35 Arial,sans-serif',boxShadow:'0 2px 8px rgba(0,0,0,.25)',maxWidth:'440px'});
      document.documentElement.appendChild(n);}
    n.style.background=ok?'#153d23':'#6b1d1d'; n.style.color='#fff';
    n.textContent='Bildiagnos AD Helper v'+VERSION+': '+msg;
  }

  function visible(el){
    if(!el || !el.isConnected) return false;
    const r=el.getBoundingClientRect();
    if(r.width<2 || r.height<2) return false;
    const s=getComputedStyle(el);
    return s.display!=='none' && s.visibility!=='hidden' && s.pointerEvents!=='none' && Number(s.opacity||1)>0;
  }

  function ownLabel(el){
    const vals=[
      el.getAttribute?.('aria-label'), el.getAttribute?.('title'),
      el.getAttribute?.('alt'), el.getAttribute?.('data-tooltip')
    ].filter(Boolean);
    const t=el.querySelector?.(':scope > title'); if(t?.textContent) vals.push(t.textContent);
    const direct=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' ');
    if(direct.trim()) vals.push(direct);
    if(el.children.length<=2 && el.textContent) vals.push(el.textContent);
    return vals.map(norm).filter(Boolean);
  }

  function exactVisibleMatches(label){
    const target=norm(label);
    const all=[...document.querySelectorAll('button,a,[role="button"],[aria-label],[title],svg,g,li,span,div,p')];
    return all.filter(el=>visible(el) && ownLabel(el).some(v=>v===target))
      .sort((a,b)=>{
        const ar=a.getBoundingClientRect(), br=b.getBoundingClientRect();
        const adepth=a.querySelectorAll('*').length, bdepth=b.querySelectorAll('*').length;
        return (adepth-bdepth) || ((ar.width*ar.height)-(br.width*br.height));
      });
  }

  function candidateChain(el){
    const out=[]; let n=el;
    for(let i=0;n&&i<7;i++,n=n.parentElement){
      if(visible(n)) out.push(n);
      if(n.matches?.('button,a,[role="button"],li')) break;
    }
    return out;
  }

  function visualClick(el){
    const r=el.getBoundingClientRect();
    const x=Math.max(1,Math.min(innerWidth-1,r.left+r.width/2));
    const y=Math.max(1,Math.min(innerHeight-1,r.top+r.height/2));
    const hit=document.elementFromPoint(x,y) || el;
    const targets=[hit,...candidateChain(hit),...candidateChain(el)];
    const uniq=[...new Set(targets)];
    for(const t of uniq){
      try{t.scrollIntoView({block:'center',inline:'center'});}catch{}
      for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){
        try{
          const C=type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
          t.dispatchEvent(new C(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerId:1,pointerType:'mouse'}));
        }catch{}
      }
      try{t.click?.();}catch{}
    }
  }

  async function waitVisibleLabel(label,timeout=3500){
    const end=Date.now()+timeout;
    while(Date.now()<end){
      if(exactVisibleMatches(label).length) return true;
      await sleep(150);
    }
    return false;
  }

  function pageSignature(){
    return norm(document.body.innerText).replace(/bildiagnos ad helper v[^\n]*/g,'').slice(0,15000);
  }

  async function waitMeaningfulChange(before,timeout=2600){
    const end=Date.now()+timeout;
    while(Date.now()<end){
      const now=pageSignature();
      if(now!==before) return true;
      await sleep(160);
    }
    return false;
  }

  async function clickLabel(label,nextLabel=''){
    for(let round=0;round<5;round++){
      const matches=exactVisibleMatches(label);
      for(const m of matches.slice(0,5)){
        const before=pageSignature();
        visualClick(m);
        if(nextLabel){
          if(await waitVisibleLabel(nextLabel,1400)) return true;
        }else{
          if(await waitMeaningfulChange(before,1400)) return true;
        }
      }
      await sleep(250);
    }
    return false;
  }

  function setNativeValue(input,value){
    const proto=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const d=Object.getOwnPropertyDescriptor(proto,'value');
    if(d?.set)d.set.call(input,value); else input.value=value;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function pressEnter(input){
    for(const type of ['keydown','keypress','keyup']){
      input.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    }
  }
  function globalSearch(){
    const inputs=[...document.querySelectorAll('input')].filter(visible);
    return inputs.find(i=>/sok regnr|chassinr|artiklar|search/i.test(norm(i.placeholder)+' '+norm(i.getAttribute('aria-label'))))||inputs[0]||null;
  }
  function vehicleSearch(){
    const inputs=[...document.querySelectorAll('input')].filter(visible);
    return inputs.find(i=>/sok i vald bil/i.test(norm(i.placeholder)+' '+norm(i.getAttribute('aria-label'))))||null;
  }

  async function ensurePlate(plate){
    if(!plate) return true;
    if(norm(document.body.innerText).includes(norm(plate))) return true;
    for(let i=0;i<10;i++){await sleep(250);if(norm(document.body.innerText).includes(norm(plate)))return true;}
    const input=globalSearch(); if(!input) return false;
    input.focus(); setNativeValue(input,plate); pressEnter(input); await sleep(900);
    const hit=exactVisibleMatches(plate)[0];
    if(hit){visualClick(hit); await sleep(900);}
    return norm(document.body.innerText).includes(norm(plate));
  }

  async function fallbackSearch(term){
    const input=vehicleSearch();
    if(!input) return false;
    const before=pageSignature();
    input.focus(); setNativeValue(input,term); pressEnter(input);
    return await waitMeaningfulChange(before,3000);
  }

  async function runPath(parts){
    for(let i=0;i<parts.length;i++){
      const part=parts[i], next=parts[i+1]||'';
      status('abriendo "'+part+'"...');
      const ok=await clickLabel(part,next);
      if(ok){await sleep(500);continue;}

      if(i===parts.length-1 && await fallbackSearch(part)){
        status('abierto mediante busqueda: "'+part+'".');
        return true;
      }
      status('no pude abrir "'+part+'".',false);
      return false;
    }
    return true;
  }

  async function runSearch(value){
    if(!value) return true;
    return await fallbackSearch(value) || (async()=>{
      const input=globalSearch(); if(!input) return false;
      const before=pageSignature(); input.focus(); setNativeValue(input,value); pressEnter(input);
      return await waitMeaningfulChange(before,3000);
    })();
  }

  async function main(){
    status('iniciando...');
    if(!await ensurePlate(wantedPlate)){status('no pude seleccionar '+wantedPlate+'.',false);return;}
    if(clickPath.length && !await runPath(clickPath)) return;
    if(searchText && !await runSearch(searchText)){status('no pude ejecutar la busqueda "'+searchText+'".',false);return;}
    status('listo'+(wantedPlate?' - '+wantedPlate:'')+'.');
  }
  main().catch(e=>status(e?.message||'error inesperado',false));
})();