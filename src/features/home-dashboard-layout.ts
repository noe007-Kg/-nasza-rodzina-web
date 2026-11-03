export const HOME_TILE_IDS = ['family','parcels','calendar','tasks','shortcuts','school'] as const;
export type HomeTileId = typeof HOME_TILE_IDS[number];
export type HomeTileSize = 'small' | 'rectangle' | 'large';
export type HomeTileLayout = { id:HomeTileId; size:HomeTileSize };
export type HomeDevice = 'mobile' | 'desktop';
export type HomeLayouts = Partial<Record<HomeDevice, HomeTileLayout[]>>;
export const DEFAULT_HOME_LAYOUT: readonly HomeTileLayout[] = HOME_TILE_IDS.map(id=>({id,size:id==='family'?'large':id==='parcels'?'small':'rectangle'}));
export function reconcileHomeLayout(value:unknown, defaults:readonly HomeTileLayout[]=DEFAULT_HOME_LAYOUT): HomeTileLayout[] {
  const result:HomeTileLayout[]=[];
  if(Array.isArray(value))for(const tile of value){
    if(tile && typeof tile==='object' && HOME_TILE_IDS.includes(tile.id) && ['small','rectangle','large'].includes(tile.size) && !result.some(t=>t.id===tile.id))result.push({id:tile.id,size:tile.size});
  }
  for(const tile of defaults)if(!result.some(t=>t.id===tile.id))result.push({...tile});
  return result;
}
export function moveHomeTile(value:readonly HomeTileLayout[], id:HomeTileId, target:HomeTileId):HomeTileLayout[] {
  const result=value.map(tile=>({...tile}));const from=result.findIndex(t=>t.id===id),to=result.findIndex(t=>t.id===target);
  if(from<0||to<0||from===to)return result;
  result.splice(to,0,result.splice(from,1)[0]);return result;
}
export const homeLayoutCacheKey=(uid:string)=>`nr-home-layout:v1:${encodeURIComponent(uid)}`;
