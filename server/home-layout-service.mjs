import { EduServerError } from './edu-auth.mjs';
export const HOME_LAYOUT_IDS=['family','parcels','calendar','tasks','shortcuts','school'];
function fail(status,message){throw new EduServerError('HOME_LAYOUT',status,message);}
function active(profile){return profile?.active===true && profile.canLogin===true && !profile.archived && ['parent','adult','child'].includes(profile.role);}
export function validateHomeLayout(value){
  if(!Array.isArray(value)||value.length>HOME_LAYOUT_IDS.length)fail(400,'Nieprawidłowy układ kafelków.');
  const ids=new Set();
  return value.map(tile=>{
    if(!tile||typeof tile!=='object'||Array.isArray(tile)||Object.keys(tile).some(k=>!['id','size'].includes(k))||!HOME_LAYOUT_IDS.includes(tile.id)||!['small','rectangle','large'].includes(tile.size)||ids.has(tile.id))fail(400,'Nieprawidłowy układ kafelków.');
    ids.add(tile.id);return {id:tile.id,size:tile.size};
  });
}
export async function manageHomeLayout(context,body,{env=process.env}={}){
  if(!['state','save'].includes(body.operation)||Object.keys(body).some(k=>!(body.operation==='save'?['operation','device','tiles']:['operation']).includes(k)))fail(400,'Nieprawidłowa operacja układu.');
  if(!active(context.profile))fail(403,'Brak aktywnego konta.');
  if(body.operation==='save'&&env.VERCEL_ENV==='preview')fail(403,'Wersja Preview nie zmienia układu.');
  if(body.operation==='save'&&!['mobile','desktop'].includes(body.device))fail(400,'Nieprawidłowy rodzaj ekranu.');
  const tiles=body.operation==='save'?validateHomeLayout(body.tiles):null;
  const ref=context.db.collection('_homeLayouts').doc(context.uid);
  return context.db.runTransaction(async tx=>{
    const [member,snapshot]=await Promise.all([tx.get(context.db.collection('members').doc(context.uid)),tx.get(ref)]);
    if(!active(member.data()))fail(403,'Brak aktywnego konta.');
    const value=snapshot.data()||{},layouts={};
    for(const device of ['mobile','desktop'])if(Array.isArray(value[device]))layouts[device]=validateHomeLayout(value[device]);
    if(tiles){layouts[body.device]=tiles;tx.set(ref,{...layouts,updatedAt:new Date().toISOString()});}
    return {layouts};
  });
}
