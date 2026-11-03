import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { DEFAULT_HOME_LAYOUT, moveHomeTile, reconcileHomeLayout, type HomeTileId, type HomeTileLayout, type HomeTileSize } from './home-dashboard-layout';
import { useHomeDashboardLayout } from './useHomeDashboardLayout';
import './family-dashboard-layout.css';

export type FamilyDashboardTile = {id:HomeTileId;label:string;content:ReactNode|((size:HomeTileSize)=>ReactNode)};
function DragPreview({node}:{node:HTMLElement}) {
  const ref=useRef<HTMLDivElement|null>(null);
  useLayoutEffect(()=>{
    ref.current?.replaceChildren(node);
    node.querySelectorAll<HTMLElement>('[data-held-scroll]').forEach(element=>{
      const [top,left]=element.dataset.heldScroll!.split(',').map(Number);element.scrollTop=top;element.scrollLeft=left;delete element.dataset.heldScroll;
    });
  },[node]);
  return <div ref={ref} className="home-drag-preview" aria-hidden="true" inert/>;
}
function DashboardTile({tile,size,editing,loaded,busy,index,total,move,resize,suppressClick,children}:{tile:FamilyDashboardTile;size:HomeTileSize;editing:boolean;loaded:boolean;busy:boolean;index:number;total:number;move:(direction:number)=>void;resize:(size:HomeTileSize)=>void;suppressClick:()=>boolean;children:ReactNode}) {
  const drag=useDraggable({id:tile.id,disabled:!loaded||busy}),drop=useDroppable({id:tile.id});
  const root=useRef<HTMLDivElement|null>(null),inner=useRef<HTMLDivElement|null>(null);
  useLayoutEffect(()=>{
    const node=inner.current;if(!node)return;
    const measure=()=>{if(root.current&&!drag.isDragging)root.current.style.gridRowEnd=`span ${Math.max(1,Math.ceil(node.getBoundingClientRect().height+18))}`;};
    measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();
  },[drag.isDragging]);
  const blocked=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('.home-tile-controls,input,textarea,select,[contenteditable="true"]');
  return <div ref={node=>{root.current=node;drag.setNodeRef(node);drop.setNodeRef(node);}} {...drag.attributes} role="group" aria-label={`Kafelek: ${tile.label}. Przytrzymaj 2 sekundy, aby przesunąć; klawiaturą naciśnij spację.`} tabIndex={loaded&&!busy?0:-1}
    className={`home-layout-tile home-layout-${size}${drag.isDragging?' is-dragging':''}`} data-home-tile={tile.id} data-size={size}
    onMouseDown={event=>{if(!blocked(event.target))drag.listeners?.onMouseDown?.(event);}}
    onTouchStart={event=>{if(!blocked(event.target))drag.listeners?.onTouchStart?.(event);}}
    onKeyDown={event=>{if(event.target===event.currentTarget)drag.listeners?.onKeyDown?.(event);}}
    onContextMenu={event=>{if(!blocked(event.target))event.preventDefault();}}
    onClickCapture={event=>{if(suppressClick()){event.preventDefault();event.stopPropagation();}}}>
    <div ref={inner} className="home-layout-inner">
      {editing && <div className="home-tile-controls">
        <button type="button" {...drag.attributes} {...drag.listeners} className="home-tile-handle" disabled={busy} aria-label={`Przeciągnij: ${tile.label}`}>⠿ Przesuń</button>
        <button type="button" disabled={busy||index===0} onClick={()=>move(-1)} aria-label={`Przesuń wcześniej: ${tile.label}`}>↑</button>
        <button type="button" disabled={busy||index===total-1} onClick={()=>move(1)} aria-label={`Przesuń dalej: ${tile.label}`}>↓</button>
        <label>Rozmiar<select aria-label={`Rozmiar: ${tile.label}`} disabled={busy} value={size} onChange={event=>resize(event.target.value as HomeTileSize)}><option value="small">Mały kwadrat</option><option value="rectangle">Prostokąt</option><option value="large">Duży</option></select></label>
      </div>}
      <div className="home-tile-content" inert={editing} tabIndex={size==='small'&&!editing?0:undefined} role={size==='small'?'region':undefined} aria-label={size==='small'?tile.label:undefined}>{children}</div>
      {editing&&tile.id==='parcels'&&<p className="home-parcels-edit-note">Kafelek pojawia się, gdy śledzicie paczki.</p>}
    </div>
  </div>;
}
function DashboardEditor({uid,tiles,defaults,device}:{uid:string;tiles:readonly FamilyDashboardTile[];defaults:readonly HomeTileLayout[];device:'mobile'|'desktop'}) {
  const saved=useHomeDashboardLayout(uid);
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState<HomeTileLayout[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[announcement,setAnnouncement]=useState('');
  const [active,setActive]=useState<HomeTileId|null>(null);
  const [controlsReady,setControlsReady]=useState(false),[preview,setPreview]=useState<HTMLElement|null>(null);
  const suppressClickUntil=useRef(0);
  const layout=reconcileHomeLayout(editing?draft:saved.layouts[device],defaults);
  const latest=useRef(layout);latest.current=layout;
  const keyboardTarget=useRef<HomeTileId|null>(null);
  function move(id:HomeTileId,target:HomeTileId){setDraft(current=>moveHomeTile(reconcileHomeLayout(current,defaults),id,target));}
  const coordinates:KeyboardCoordinateGetter=(event,{active:dragging,currentCoordinates,context})=>{
    const direction=['ArrowDown','ArrowRight'].includes(event.code)?1:['ArrowUp','ArrowLeft'].includes(event.code)?-1:0;if(!direction)return;
    event.preventDefault();const list=latest.current,index=list.findIndex(t=>t.id===(keyboardTarget.current||dragging)),target=list[index+direction];
    if(target){keyboardTarget.current=target.id;setAnnouncement(`Wybrane miejsce: ${tiles.find(t=>t.id===target.id)?.label || target.id}.`);}
    const next=target&&context.droppableRects.get(target.id),current=context.collisionRect||context.draggingNodeRect;
    return next&&current?{x:currentCoordinates.x+next.left+next.width/2-current.left-current.width/2,y:currentCoordinates.y+next.top+next.height/2-current.top-current.height/2}:currentCoordinates;
  };
  const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{delay:2000,tolerance:8}}),useSensor(TouchSensor,{activationConstraint:{delay:2000,tolerance:8}}),useSensor(KeyboardSensor,{coordinateGetter:coordinates}));
  function stopDrag(){keyboardTarget.current=null;setActive(null);setPreview(null);setControlsReady(true);suppressClickUntil.current=Date.now()+400;}
  async function save(){setBusy(true);setError('');try{await saved.save(device,layout);setEditing(false);setAnnouncement('Układ pulpitu zapisano.');}catch(e){setError(e instanceof Error?e.message:'Nie udało się zapisać układu.');}finally{setBusy(false);}}
  return <div className={`family-dashboard-customizer${editing?' is-editing':''}`}>
    {editing&&createPortal(<div className="home-layout-toolbar home-layout-toolbar-floating" aria-label="Edycja pulpitu"><button type="button" className="secondary-button" aria-expanded={controlsReady} disabled={busy||!!active} onClick={()=>setControlsReady(value=>!value)}>Dostosuj pulpit</button><button type="button" className="primary-button" disabled={busy||!!active} onClick={()=>void save()}>{busy?'Zapisuję…':'Gotowe'}</button><button type="button" className="secondary-button" disabled={busy||!!active} onClick={()=>{setDraft(DEFAULT_HOME_LAYOUT.map(t=>({...t})));setAnnouncement('Przywrócono domyślny układ. Naciśnij Gotowe, aby zapisać.');}}>Przywróć domyślny układ</button><button type="button" className="secondary-button" disabled={busy||!!active} onClick={()=>{setEditing(false);setControlsReady(false);setError('');}}>Anuluj</button><p>Przytrzymaj dowolne miejsce kafelka przez 2 sekundy i przeciągnij. Zapisz zmiany przyciskiem Gotowe.</p><small>Układ zapisuje się na Twoim koncie, osobno dla telefonu i większego ekranu.</small></div>,document.body)}
    {(error||saved.error)&&<p role="alert" className="home-layout-error">{error||saved.error}</p>}<p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    <DndContext sensors={sensors} collisionDetection={args=>{
      const options={...args,droppableContainers:args.droppableContainers.filter(container=>container.id!==args.active.id)};
      return args.pointerCoordinates?pointerWithin(options):closestCenter(options);
    }} onDragStart={event=>{
      const id=event.active.id as HomeTileId;
      const node=document.querySelector<HTMLElement>(`[data-home-tile="${id}"] .home-layout-inner`);
      if(node){
        const clone=node.cloneNode(true) as HTMLElement;clone.classList.add(`home-layout-${layout.find(tile=>tile.id===id)?.size||'rectangle'}`);
        // Keep the same appearance outside the page's responsive container.
        const originals=[node,...node.querySelectorAll<HTMLElement>('*')],copies=[clone,...clone.querySelectorAll<HTMLElement>('*')];
        const properties=['display','padding','margin','gap','grid-template-columns','grid-template-rows','flex-direction','align-items','justify-content','font-size','font-weight','line-height','color','border-radius','box-sizing'];
        originals.forEach((element,index)=>{
          const style=getComputedStyle(element);for(const property of properties)copies[index].style.setProperty(property,style.getPropertyValue(property));
          if(element.scrollTop||element.scrollLeft)copies[index].dataset.heldScroll=`${element.scrollTop},${element.scrollLeft}`;
        });
        clone.style.width='100%';clone.style.height=`${node.getBoundingClientRect().height}px`;
        clone.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));clone.inert=true;setPreview(clone);
      }
      if(!editing){setDraft(layout);setError('');setControlsReady(false);setEditing(true);}
      keyboardTarget.current=null;suppressClickUntil.current=Infinity;setActive(id);
      setAnnouncement('Kafelek podniesiony. Przeciągnij go w nowe miejsce.');
    }} onDragCancel={stopDrag} onDragEnd={({active:dragged,over})=>{const target=keyboardTarget.current||over?.id;stopDrag();if(target&&dragged.id!==target)move(dragged.id as HomeTileId,target as HomeTileId);}} accessibility={{screenReaderInstructions:{draggable:'Naciśnij spację na kafelku lub uchwycie. Strzałkami wybierz miejsce, spacją upuść. Escape anuluje.'}}}>
      <div className="home-sections family-dashboard-grid" data-layout-ready={saved.loaded} data-order={layout.map(t=>t.id).join(',')} data-device={device} data-dragging={active||undefined}>{layout.map((item,index)=>{
        const tile=tiles.find(t=>t.id===item.id);if(!tile)return null;
        return <DashboardTile key={item.id} tile={tile} size={item.size} editing={editing&&controlsReady} loaded={saved.loaded} busy={busy} index={index} total={layout.length} suppressClick={()=>Date.now()<suppressClickUntil.current} move={direction=>{const target=layout[index+direction];if(target)move(item.id,target.id);}} resize={size=>setDraft(layout.map(t=>t.id===item.id?{...t,size}:t))}>{typeof tile.content==='function'?tile.content(item.size):tile.content}</DashboardTile>;
      })}</div>
      {createPortal(<DragOverlay dropAnimation={null} zIndex={1600}>{active&&preview?<DragPreview node={preview}/>:null}</DragOverlay>,document.body)}
    </DndContext>
  </div>;
}
export function FamilyDashboardLayout(props:{uid:string;tiles:readonly FamilyDashboardTile[];defaults:readonly HomeTileLayout[]}){
  const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width:767px)').matches);
  useEffect(()=>{const query=window.matchMedia('(max-width:767px)');const change=()=>setMobile(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
  const device=mobile?'mobile':'desktop';return <DashboardEditor key={`${props.uid}:${device}`} {...props} device={device}/>;
}
