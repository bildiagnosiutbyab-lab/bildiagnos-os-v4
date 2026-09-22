(() => {
  const VERSION='1.0.0';
  const params=new URLSearchParams(location.search);
  const plate=(params.get('bildiagnosReg')||'').replace(/\s+/g,'').toUpperCase();
  const path=(params.get('bdClick')||'').split('>').map(s=>s.trim()).filter(Boolean);
  let auth=null, apiBase='https://katalogapi.adsverige.com/api/v1.0/', seq=1;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const norm=v=>String(v||'').replace(/\s+/g,' ').trim().toLowerCase();

  function status(msg,ok=true){
    let n=document.getElementById('bildiagnos-ad-helper-status');
    if(!n){n=document.createElement('div');n.id='bildiagnos-ad-helper-status';n.setAttribute('role','status');
      Object.assign(n.style,{position:'fixed',right:'12px',bottom:'12px',zIndex:'2147483647',padding:'8px 11px',borderRadius:'7px',font:'12px/1.35 Arial,sans-serif',boxShadow:'0 2px 8px rgba(0,0,0,.25)',maxWidth:'480px'});
      document.documentElement.appendChild(n);}
    n.style.background=ok?'#153d23':'#6b1d1d';n.style.color='#fff';n.textContent='Bildiagnos AD Helper v'+VERSION+': '+msg;
  }

  window.addEventListener('BILDIAGNOS_AD_AUTH',ev=>{
    if(ev.detail?.auth) auth=ev.detail.auth;
    const u=String(ev.detail?.url||'');
    const m=u.match(/^(https:\/\/[^/]+\/api\/v1\.0\/)/i);
    if(m) apiBase=m[1];
  });

  function pageRequest(url,options={}){
    return new Promise((resolve,reject)=>{
      const id='bd-'+Date.now()+'-'+seq++;
      const timer=setTimeout(()=>{window.removeEventListener('BILDIAGNOS_AD_RESPONSE',on);reject(new Error('timeout'));},10000);
      function on(ev){
        if(ev.detail?.id!==id)return;
        clearTimeout(timer);window.removeEventListener('BILDIAGNOS_AD_RESPONSE',on);
        ev.detail.ok?resolve(ev.detail.data):reject(new Error('HTTP '+(ev.detail.status||0)));
      }
      window.addEventListener('BILDIAGNOS_AD_RESPONSE',on);
      window.dispatchEvent(new CustomEvent('BILDIAGNOS_AD_REQUEST',{detail:{id,url,options}}));
    });
  }

  async function api(endpoint,body){
    if(!auth) throw new Error('sin token de sesion capturado');
    return pageRequest(apiBase+endpoint.replace(/^\/+/,''),{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':auth},
      body:JSON.stringify(body)
    });
  }
  async function apiTry(endpoints,bodies){
    let last;
    for(const ep of endpoints) for(const body of bodies){
      try{return await api(ep,body)}catch(e){last=e;}
    }
    throw last||new Error('API sin respuesta');
  }

  function flattenObjects(value,out=[],seen=new Set()){
    if(value===null||value===undefined||typeof value!=='object'||seen.has(value))return out;
    seen.add(value);
    if(Array.isArray(value)){for(const x of value)flattenObjects(x,out,seen);return out;}
    out.push(value);
    for(const v of Object.values(value)) if(v&&typeof v==='object') flattenObjects(v,out,seen);
    return out;
  }
  function labelOf(o){
    for(const k of ['name','nodeName','title','text','description','gaNoName','itemName']){
      if(o&&o[k]!=null&&String(o[k]).trim())return String(o[k]).trim();
    }
    return '';
  }
  function nodeNoOf(o){
    const preferred=['nodeNo','nodeNr','nodeNumber','nodeID','nodeId','node','no','nr','id','topNode','subNode'];
    for(const k of preferred){
      const v=o?.[k];
      if(v!==null&&v!==undefined&&v!==''&&!Array.isArray(v)&&typeof v!=='object'){
        const n=Number(v); if(Number.isFinite(n)&&n>0)return n;
      }
    }
    for(const [k,v] of Object.entries(o||{})){
      if(!/(node|number|(^|_)no$|(^|_)nr$|id$)/i.test(k))continue;
      if(/parent/i.test(k))continue;
      const n=Number(v); if(Number.isFinite(n)&&n>0)return n;
    }
    return null;
  }
  function findNamed(data,name){
    const target=norm(name);
    const all=flattenObjects(data);
    return all.find(o=>norm(labelOf(o))===target)||all.find(o=>norm(labelOf(o)).includes(target))||null;
  }

  function readVehicle(){
    const text=document.body.innerText||'';
    const pick=label=>{
      const m=text.match(new RegExp(label+'\\s*\\n?\\s*([^\\n]+)','i'));
      return m?m[1].trim():'';
    };
    return {regNr:plate||pick('Regnr'),typeNo:pick('Ktypnr'),engineCode:pick('Motorkod'),manufactureDate:pick('Tillv\\.datum')};
  }

  async function waitForAuth(){
    for(let i=0;i<40;i++){if(auth)return true;await sleep(250);}
    return false;
  }
  async function ensurePlate(){
    if(!plate)return true;
    if(norm(document.body.innerText).includes(norm(plate)))return true;
    const inputs=[...document.querySelectorAll('input')];
    const input=inputs.find(i=>/sök regnr|chassinr|artiklar/i.test((i.placeholder||'').toLowerCase()));
    if(!input)return false;
    const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d?.set?.call(input,plate);
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    for(const type of ['keydown','keyup'])input.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',bubbles:true}));
    await sleep(1200);
    const exact=[...document.querySelectorAll('*')].find(e=>norm(e.textContent)===norm(plate));
    try{(exact?.closest('button,a,[role="button"],li,[onclick]')||exact)?.click?.()}catch{}
    await sleep(1200);
    return norm(document.body.innerText).includes(norm(plate));
  }

  function articleObjects(data){
    const all=flattenObjects(data);
    const strong=all.filter(o=>['artNum','articleNumber','cleanartnum','brandName','articlePrice','stocks','repairTime','adid'].some(k=>o[k]!=null));
    if(strong.length)return strong;
    const arrays=[];
    const scan=v=>{
      if(Array.isArray(v)){if(v.some(x=>x&&typeof x==='object'))arrays.push(v);for(const x of v)scan(x);}
      else if(v&&typeof v==='object')for(const x of Object.values(v))scan(x);
    };scan(data);
    return (arrays.sort((a,b)=>b.length-a.length)[0]||[]).filter(x=>x&&typeof x==='object');
  }
  function firstVal(o,keys){
    for(const k of keys){const v=o?.[k];if(v!==null&&v!==undefined&&v!=='')return v;}
    return '';
  }
  function priceText(o){
    const p=firstVal(o,['price','yourPrice','netPrice','salePrice','unitPrice','costPrice']);
    if(p!=='')return String(p);
    const ap=o?.articlePrice;
    if(ap&&typeof ap==='object'){
      const v=firstVal(ap,['price','yourPrice','netPrice','salesPrice','value','amount']);
      if(v!=='')return String(v);
    }
    return '';
  }
  function stockText(o){
    const st=o?.stocks;
    if(Array.isArray(st))return st.map(x=>{
      const name=firstVal(x,['stockName','name','storeName']);
      const qty=firstVal(x,['stock','quantity','qty','amount']);
      return [name,qty].filter(v=>v!=='').join(': ');
    }).filter(Boolean).join(' · ');
    return String(firstVal(o,['stock','quantityInStock','availability'])||'');
  }
  function repairText(o){
    const r=o?.repairTime;
    if(r&&typeof r==='object')return String(firstVal(r,['time','hours','value','repairTime'])||'');
    return String(firstVal(o,['repairHours','laborHours'])||'');
  }

  function numericValue(value){
    let text=String(value??'').trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
    if(!text)return null;
    if(text.includes(',')&&text.includes('.')){
      text=text.lastIndexOf(',')>text.lastIndexOf('.')?text.replace(/\./g,'').replace(',','.'):text.replace(/,/g,'');
    }else text=text.replace(',','.');
    const number=Number(text);
    return Number.isFinite(number)?number:null;
  }

  function laborHours(value){
    const text=String(value??'').trim();
    const clock=text.match(/^(\d{1,2}):(\d{2})$/);
    if(clock)return Number(clock[1])+Number(clock[2])/60;
    return numericValue(text);
  }

  function exportSelection(panel,items,category,vehicle){
    const selected=[...panel.querySelectorAll('[data-bd-index]:checked')];
    if(!selected.length){status('selecciona al menos una pieza antes de enviarla.',false);return;}
    const parts=[]; const laborItems=[];
    selected.forEach(input=>{
      const index=Number(input.dataset.bdIndex); const article=items[index];
      const brand=firstVal(article,['brandName','brand','manufacturer']);
      const articleNumber=firstVal(article,['artNum','articleNumber','cleanartnum','partNumber']);
      const name=firstVal(article,['itemName','name','gaNoName','description'])||category;
      const quantityInput=panel.querySelector(`[data-bd-quantity="${index}"]`);
      const quantity=Math.max(1,Number(quantityInput?.value||1));
      const price=numericValue(priceText(article));
      const discount=numericValue(firstVal(article,['discount','discountPercent','discountPercentage']));
      parts.push({articleNumber:String(articleNumber||''),description:[brand,name].filter(Boolean).join(' · '),quantity,supplier:'AD Bildelar',cost:null,price,discount});
      const hours=laborHours(repairText(article));
      if(hours!==null&&hours>0)laborItems.push({code:String(articleNumber||''),description:`Arbetstid · ${name}`,hours,hourlyRate:null});
    });
    const payload={source:'AD Bildelar',plate:vehicle.regNr||plate,parts,laborItems};
    chrome.storage.local.set({bildiagnosCatalogTransfer:{payload,createdAt:new Date().toISOString(),version:1}},()=>{
      if(chrome.runtime.lastError){status('no pude preparar la transferencia a Bildiagnos.',false);return;}
      status(parts.length+' pieza(s) preparada(s). Vuelve a Bildiagnos y pulsa Recibir selección.');
    });
  }

  function renderResults(category,nodeNo,data,vehicle){
    const items=articleObjects(data);
    let panel=document.getElementById('bildiagnos-ad-results');
    if(!panel){panel=document.createElement('div');panel.id='bildiagnos-ad-results';
      Object.assign(panel.style,{position:'fixed',right:'12px',top:'12px',zIndex:'2147483646',width:'min(600px,48vw)',maxHeight:'72vh',overflow:'auto',background:'#fff',color:'#111',border:'1px solid #bbb',borderRadius:'8px',padding:'10px',font:'12px/1.4 Arial,sans-serif',boxShadow:'0 3px 18px rgba(0,0,0,.25)'});
      document.documentElement.appendChild(panel);}
    panel.innerHTML='<b>'+category+' · '+(vehicle.regNr||plate)+'</b><br><small>Nodo '+nodeNo+' · '+items.length+' artículo(s). Selecciona sin realizar pedidos.</small>';
    items.slice(0,30).forEach((a,i)=>{
      const brand=firstVal(a,['brandName','brand','manufacturer']);
      const art=firstVal(a,['artNum','articleNumber','cleanartnum','partNumber']);
      const name=firstVal(a,['itemName','name','gaNoName','description']);
      const price=priceText(a), stock=stockText(a), repair=repairText(a);
      const row=document.createElement('label');row.style.cssText='display:block;padding:8px 0;border-top:1px solid #eee;cursor:pointer';
      row.innerHTML='<input type="checkbox" data-bd-index="'+i+'"> <b>'+(i+1)+'. '+[brand,art].filter(Boolean).join(' ')+'</b><br>'+String(name||category)+
        (price?'<br>Precio: '+price:'')+(stock?'<br>Stock: '+stock:'')+(repair?'<br>Tiempo: '+repair:'')+
        '<br>Cantidad: <input type="number" min="1" step="1" value="1" data-bd-quantity="'+i+'" style="width:56px">';
      panel.appendChild(row);
    });
    const send=document.createElement('button');
    send.type='button';send.textContent='Enviar selección a Bildiagnos';
    send.style.cssText='position:sticky;bottom:0;width:100%;margin-top:8px;padding:9px;border:0;border-radius:6px;background:#0f766e;color:#fff;font-weight:bold;cursor:pointer';
    send.addEventListener('click',()=>exportSelection(panel,items.slice(0,30),category,vehicle));
    panel.appendChild(send);
    window.__BILDIAGNOS_AD_RESULTS__={plate:vehicle.regNr||plate,category,nodeNo,articles:items,raw:data};
    status(category+' cargado por API: '+items.length+' artículo(s).');
    return items;
  }

  async function directNavigate(parts){
    const vehicle=readVehicle();
    if(!vehicle.typeNo)throw new Error('no pude leer Ktypnr del vehículo');
    const typeNo=String(vehicle.typeNo);

    status('leyendo categorías principales...');
    let top=await apiTry(
      ['Article/GetPartsTopNodes','Article/GetTopNodes','Tree/GetTopNodes'],
      [{TypeNo:typeNo,TreeType:'pc'},{typeNo,treeType:'pc'},{TypeNo:typeNo},{treeType:'pc'}]
    );

    const categoryName=parts[0]||'';
    let cat=findNamed(top,categoryName);
    let catNode=nodeNoOf(cat);
    if(!catNode&&norm(categoryName)==='filter')catNode=100005;
    if(!catNode)throw new Error('categoría sin nodeNo: '+categoryName);

    if(parts.length===1){status(categoryName+' identificado: nodo '+catNode);return true;}

    status('leyendo subcategorías de '+categoryName+'...');
    const subs=await apiTry(
      ['Article/GetSubNodes','Tree/GetSubNodes'],
      [{TreeType:'pc',Node:catNode,TypeNo:typeNo},{treeType:'pc',Node:catNode,TypeNo:typeNo},{Node:catNode,treeType:'pc'}]
    );
    const subName=parts[1];
    const sub=findNamed(subs,subName);
    let subNode=nodeNoOf(sub);
    if(!subNode&&norm(categoryName)==='filter'&&norm(subName)==='luftfilter')subNode=100260;
    if(!subNode)throw new Error('subcategoría sin nodeNo: '+subName);

    status('cargando '+subName+' (nodo '+subNode+')...');
    const body={
      TypeNo:typeNo,Node:subNode,RegNr:vehicle.regNr||plate,
      EngineCode:vehicle.engineCode||'',Lang:'SE',ManufactureDate:vehicle.manufactureDate||''
    };
    const data=await apiTry(['Article/GetLinkages','Tree/GetLinkages'],[body]);
    renderResults(subName,subNode,data,vehicle);
    return true;
  }

  async function main(){
    status('iniciando...');
    if(!await ensurePlate()){status('no pude seleccionar '+plate+'.',false);return;}
    if(!await waitForAuth()){status('no pude capturar la sesión API de AD.',false);return;}
    if(path.length){
      try{await directNavigate(path);return;}
      catch(e){status(e.message||String(e),false);return;}
    }
    status('listo'+(plate?' - '+plate:'')+'.');
  }
  main().catch(e=>status(e?.message||'error inesperado',false));
})();
