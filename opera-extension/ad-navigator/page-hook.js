(() => {
  if(window.__BILDIAGNOS_AD_HOOK__) return;
  window.__BILDIAGNOS_AD_HOOK__=true;
  const send=(type,detail={})=>window.dispatchEvent(new CustomEvent(type,{detail}));
  const originalFetch=window.fetch.bind(window);
  window.fetch=async (...args)=>{
    const input=args[0], init=args[1]||{};
    const url=typeof input==='string'?input:(input&&input.url)||'';
    const headers=new Headers(init.headers||(input&&input.headers)||undefined);
    const auth=headers.get('Authorization');
    if(auth&&/adsverige\.com/i.test(url)) send('BILDIAGNOS_AD_AUTH',{auth,url});
    return originalFetch(...args);
  };
  window.addEventListener('BILDIAGNOS_AD_REQUEST',async ev=>{
    const {id,url,options}=ev.detail||{};
    try{
      const res=await originalFetch(url,options);
      const text=await res.text();
      let data=text; try{data=JSON.parse(text)}catch{}
      send('BILDIAGNOS_AD_RESPONSE',{id,ok:res.ok,status:res.status,data});
    }catch(e){send('BILDIAGNOS_AD_RESPONSE',{id,ok:false,status:0,error:String(e)})}
  });
})();