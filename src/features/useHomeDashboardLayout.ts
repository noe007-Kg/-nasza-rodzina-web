import { useEffect, useRef, useState } from 'react';
import { familyAction } from '../family-v2-client';
import { homeLayoutCacheKey, reconcileHomeLayout, type HomeDevice, type HomeLayouts, type HomeTileLayout } from './home-dashboard-layout';
function cached(uid:string):HomeLayouts {
  try { const value=JSON.parse(localStorage.getItem(homeLayoutCacheKey(uid))||'null');
    if(value?.schemaVersion!==1)return {};
    return Object.fromEntries((['mobile','desktop'] as const).filter(device=>Array.isArray(value.layouts?.[device])).map(device=>[device,reconcileHomeLayout(value.layouts[device])]));
  }catch{return {};}
}
export function useHomeDashboardLayout(uid:string) {
  const [state,setState]=useState(()=>({uid,layouts:cached(uid),loaded:false,error:''}));
  const generation=useRef(0);
  useEffect(()=>{
    const current=++generation.current;setState({uid,layouts:cached(uid),loaded:false,error:''});
    void familyAction<{layouts:HomeLayouts}>('home-layout',{operation:'state'}).then(result=>{
      if(current!==generation.current)return;
      const layouts:HomeLayouts={};
      for(const device of ['mobile','desktop'] as const)if(Array.isArray(result.layouts?.[device]))layouts[device]=reconcileHomeLayout(result.layouts[device]);
      setState({uid,layouts,loaded:true,error:''});
      try{localStorage.setItem(homeLayoutCacheKey(uid),JSON.stringify({schemaVersion:1,layouts}));}catch{/* Server remains authoritative. */}
    }).catch(()=>{if(current===generation.current)setState(previous=>({...previous,loaded:true,error:'Nie udało się odczytać układu z konta. Pokazujemy układ dostępny na tym urządzeniu.'}));});
    return()=>{++generation.current;};
  },[uid]);
  async function save(device:HomeDevice, tiles:HomeTileLayout[]) {
    const current=generation.current;
    const result=await familyAction<{layouts:HomeLayouts}>('home-layout',{operation:'save',device,tiles});
    if(current!==generation.current)throw new Error('Konto zostało zmienione.');
    const layouts=result.layouts;
    setState({uid,layouts,loaded:true,error:''});
    try{localStorage.setItem(homeLayoutCacheKey(uid),JSON.stringify({schemaVersion:1,layouts}));}catch{/* Server saved successfully. */}
  }
  return { ...(state.uid===uid?state:{uid,layouts:{},loaded:false,error:''}), save };
}
