import { addDoc, collection, db, deleteDoc, doc, EmptyState, errorMessage, isAdultMember, isParent, type Member, Modal, ModuleHeader, notify, onSnapshot, type QuickProduct, React, setDoc, type ShoppingCategory, type ShoppingItem, storage, storageRef, Timestamp, updateDoc, uploadBytes, useEffect, useMemo, type User, useRef, useState, writeBatch } from "../app-shared";
import { onSnapshot as subscribe, query, where } from 'firebase/firestore';
import { normalizeShopIds, productsForStore, remainingForStore, shoppingStores, type ShoppingStore } from './shopping-stores';
import { ShoppingStorePicker } from './ShoppingStorePicker';
import { assertFamilyV2WriteAllowed, familyAction } from '../family-v2-client';
import { householdFamilyId, requireHouseholdFamilyId } from '../household-scope';
import { productStoragePath, publicProductImage, usePrivateProductImages } from '../usePrivateProductImages';
import './shopping-cards.css';


export const SHOPPING_META: Record<ShoppingCategory, { label: string; icon: string }> = {
  owoce: { label: 'Owoce', icon: '🍎' }, warzywa: { label: 'Warzywa', icon: '🥕' }, nabial: { label: 'Nabiał', icon: '🥛' },
  pieczywo: { label: 'Pieczywo', icon: '🥖' }, mieso: { label: 'Mięso i wędliny', icon: '🥩' }, mrozonki: { label: 'Mrożonki', icon: '🧊' },
  napoje: { label: 'Napoje', icon: '🥤' }, chemia: { label: 'Chemia i dom', icon: '🧴' }, zwierzeta: { label: 'Dla psa', icon: '🐶' },
  dzieci: { label: 'Dzieci', icon: '👶' }, szkola: { label: 'Szkoła i biuro', icon: '✏️' }, inne: { label: 'Inne', icon: '📦' },
};

export const DEFAULT_QUICK_PRODUCTS: QuickProduct[] = [
  { id:'truskawki', title:'Truskawki', category:'owoce', icon:'🍓', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'maliny', title:'Maliny', category:'owoce', icon:'🫐', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'mandarynki', title:'Mandarynki', category:'owoce', icon:'🍊', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'jablka', title:'Jabłka', category:'owoce', icon:'🍎', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'banany', title:'Banany', category:'owoce', icon:'🍌', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'winogrona', title:'Winogrona', category:'owoce', icon:'🍇', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'salata', title:'Sałata', category:'warzywa', icon:'🥬', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'pomidory', title:'Pomidory', category:'warzywa', icon:'🍅', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'ogorki', title:'Ogórki', category:'warzywa', icon:'🥒', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'marchew', title:'Marchew', category:'warzywa', icon:'🥕', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'ziemniaki', title:'Ziemniaki', category:'warzywa', icon:'🥔', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'papryka', title:'Papryka', category:'warzywa', icon:'🫑', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'cebula', title:'Cebula', category:'warzywa', icon:'🧅', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'czosnek', title:'Czosnek', category:'warzywa', icon:'🧄', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'brokul', title:'Brokuł', category:'warzywa', icon:'🥦', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'kalafior', title:'Kalafior', category:'warzywa', icon:'🥦', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'pieczarki', title:'Pieczarki', category:'warzywa', icon:'🍄', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'cukinia', title:'Cukinia', category:'warzywa', icon:'🥒', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'rzodkiewka', title:'Rzodkiewka', category:'warzywa', icon:'🔴', defaultQuantity:'1', defaultUnit:'pęczek' },
  { id:'pietruszka', title:'Pietruszka', category:'warzywa', icon:'🌿', defaultQuantity:'1', defaultUnit:'pęczek' },
  { id:'koper', title:'Koper', category:'warzywa', icon:'🌿', defaultQuantity:'1', defaultUnit:'pęczek' },
  { id:'kukurydza', title:'Kukurydza', category:'warzywa', icon:'🌽', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'mleko', title:'Mleko', category:'nabial', icon:'🥛', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'jajka', title:'Jajka', category:'nabial', icon:'🥚', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'jogurt', title:'Jogurt', category:'nabial', icon:'🥣', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'smietana', title:'Śmietana', category:'nabial', icon:'🥛', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'maslo', title:'Masło', category:'nabial', icon:'🧈', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'ser', title:'Ser', category:'nabial', icon:'🧀', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'chleb', title:'Chleb', category:'pieczywo', icon:'🍞', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'bulki', title:'Bułki', category:'pieczywo', icon:'🥯', defaultQuantity:'4', defaultUnit:'szt.' },
  { id:'tortilla', title:'Tortilla', category:'pieczywo', icon:'🫓', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'wedlina', title:'Wędlina', category:'mieso', icon:'🥓', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'platki', title:'Płatki śniadaniowe', category:'inne', icon:'🥣', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'wojanek-napoj', title:'Wojanek napój', category:'napoje', imageURL:'/wojanek-napoj.png', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'wojanek-mus', title:'Wojanek mus', category:'dzieci', imageURL:'/wojanek-mus.png', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'sok', title:'Sok', category:'napoje', icon:'🧃', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'cola', title:'Napój gazowany', category:'napoje', icon:'🥤', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'woda', title:'Woda', category:'napoje', icon:'💧', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'chipsy', title:'Chipsy', category:'inne', icon:'🥔', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'ciastka', title:'Ciastka', category:'inne', icon:'🍪', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'slodycze', title:'Słodycze', category:'inne', icon:'🍫', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'kawa', title:'Kawa', category:'napoje', icon:'☕', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'herbata', title:'Herbata', category:'napoje', icon:'🍵', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'cukier', title:'Cukier', category:'inne', icon:'🧂', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'sol', title:'Sól', category:'inne', icon:'🧂', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'pieprz', title:'Pieprz', category:'inne', icon:'⚫', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'olej', title:'Olej', category:'inne', icon:'🫗', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'ocet', title:'Ocet', category:'inne', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'makaron', title:'Makaron', category:'inne', icon:'🍝', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'ryz', title:'Ryż', category:'inne', icon:'🍚', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'maka', title:'Mąka', category:'inne', icon:'🌾', defaultQuantity:'1', defaultUnit:'kg' },
  { id:'kasza', title:'Kasza', category:'inne', icon:'🌾', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'ketchup', title:'Ketchup', category:'inne', icon:'🍅', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'majonez', title:'Majonez', category:'inne', icon:'🥫', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'musztarda', title:'Musztarda', category:'inne', icon:'🟡', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'papier', title:'Papier toaletowy', category:'chemia', icon:'🧻', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'reczniki', title:'Ręczniki papierowe', category:'chemia', icon:'🧻', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'worki', title:'Worki na śmieci', category:'chemia', icon:'🗑️', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'plyn-naczynia', title:'Płyn do naczyń', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'tabletki-zmywarka', title:'Tabletki do zmywarki', category:'chemia', icon:'🧊', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'sol-zmywarka', title:'Sól do zmywarki', category:'chemia', icon:'🧂', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'nablyszczacz', title:'Nabłyszczacz do zmywarki', category:'chemia', icon:'✨', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'proszek', title:'Proszek do prania', category:'chemia', icon:'🧺', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'zel-pranie', title:'Żel do prania', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'kapsulki-pranie', title:'Kapsułki do prania', category:'chemia', icon:'🟢', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'chusteczki-pranie', title:'Chusteczki do prania', category:'chemia', imageURL:'/oxy-chusteczki.png', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'plyn-plukanie', title:'Płyn do płukania', category:'chemia', icon:'🌸', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'szampon', title:'Szampon', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'odzywka', title:'Odżywka', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'zel-prysznic', title:'Żel pod prysznic', category:'chemia', icon:'🧼', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'dezodorant', title:'Dezodorant', category:'chemia', icon:'🧴', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'pasta', title:'Pasta do zębów', category:'chemia', icon:'🪥', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'szczoteczka', title:'Szczoteczka do zębów', category:'chemia', icon:'🪥', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'pieluchy', title:'Pieluchy', category:'dzieci', icon:'👶', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'chusteczki-dzieci', title:'Chusteczki dla dzieci', category:'dzieci', icon:'🧻', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'karma-pies', title:'Karma dla psa', category:'zwierzeta', icon:'🐶', defaultQuantity:'1', defaultUnit:'opak.' },
  { id:'dlugopis', title:'Długopis', category:'szkola', icon:'🖊️', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'gumka', title:'Gumka', category:'szkola', icon:'🩷', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'zeszyt', title:'Zeszyt', category:'szkola', icon:'📓', defaultQuantity:'1', defaultUnit:'szt.' },
  { id:'wodka', title:'Wódka', category:'napoje', icon:'🍾', adultOnly:true, defaultQuantity:'1', defaultUnit:'szt.' },
];

export function isShoppingCategory(value: unknown): value is ShoppingCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHOPPING_META, value);
}

export function normalizeProduct(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function categorizeProduct(title: string): ShoppingCategory {
  const text = normalizeProduct(title);
  const tests: Array<[ShoppingCategory, string[]]> = [
    ['owoce', ['jabl', 'banan', 'gruszk', 'pomarancz', 'mandaryn', 'winogron', 'truskaw', 'malin', 'cytryn', 'kiwi', 'arbuz', 'brzoskw']],
    ['warzywa', ['marchew', 'ziemni', 'pomidor', 'ogorek', 'papryk', 'cebula', 'salat', 'brokul', 'kalafior', 'cukini', 'burak', 'kapust', 'koper', 'pietrusz', 'rzodkiew', 'kukurydz', 'czosn', 'pieczark']],
    ['nabial', ['mleko', 'jogurt', 'ser', 'smietan', 'maslo', 'kefir', 'serek']],
    ['pieczywo', ['chleb', 'bulka', 'bagiet', 'kajzer', 'pieczyw', 'tost', 'tortill']],
    ['mieso', ['kurcz', 'mieso', 'szynk', 'kielbas', 'parow', 'boczek', 'wolow', 'wieprz', 'wedlin']],
    ['mrozonki', ['mrozon', 'lody', 'pizza mroz', 'frytki']],
    ['napoje', ['woda', 'sok', 'cola', 'napoj', 'wojanek napoj', 'kawa', 'herbat', 'wodka']],
    ['chemia', ['domestos', 'plyn do', 'proszek', 'kapsulki', 'papier toalet', 'recznik papier', 'mydlo', 'szampon', 'pasta do zeb', 'worki na smieci', 'tabletki do zmywarki', 'sol do zmywarki', 'nablyszczacz', 'chusteczki do prania']],
    ['zwierzeta', ['karma', 'pies', 'przysmak dla psa']],
    ['dzieci', ['pieluch', 'chusteczk dla dzieci', 'bebilon', 'mleko modyfik', 'smoczek', 'wojanek mus']],
    ['szkola', ['dlugopis', 'gumka', 'zeszyt', 'kredk', 'klej', 'teczk', 'olowek', 'pisak']],
  ];
  for (const [category, words] of tests) if (words.some((word) => text.includes(word))) return category;
  return 'inne';
}

export function ShoppingPage({ user, member }: { user: User; member: Member | null }) {
  type StoreShoppingItem = ShoppingItem & { shopIds: string[] };
  const [items, setItems] = useState<StoreShoppingItem[]>([]);
  const [customStores, setCustomStores] = useState<ShoppingStore[]>([]);
  const [selectedStore, setSelectedStore] = useState('all');
  const [draftShopIds, setDraftShopIds] = useState<string[]>([]);
  const [storesOpen, setStoresOpen] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [editingStore, setEditingStore] = useState<ShoppingStore | null>(null);
  const [savingStore, setSavingStore] = useState(false);
  const storeSavingRef = useRef(false);
  const [storesError, setStoresError] = useState('');
  const [editingItemStores, setEditingItemStores] = useState<StoreShoppingItem | null>(null);
  const [itemShopIds, setItemShopIds] = useState<string[]>([]);
  const [savingItemStores, setSavingItemStores] = useState(false);
  const [customQuick, setCustomQuick] = useState<QuickProduct[]>([]);
  const [title, setTitle] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('szt.');
  const [categoryChoice, setCategoryChoice] = useState<'auto' | ShoppingCategory>('auto');
  const [quickNote, setQuickNote] = useState('');
  const [quickCategory, setQuickCategory] = useState<ShoppingCategory | 'all'>('all');
  const [editingQuick, setEditingQuick] = useState<QuickProduct | null>(null);
  const [quickMenu, setQuickMenu] = useState<QuickProduct | null>(null);
  const [quickForm, setQuickForm] = useState({ title:'', category:'inne' as ShoppingCategory, quantity:'1', unit:'szt.', imageURL:'', imagePath:'', icon:'📦' });
  const previewProducts = useMemo<QuickProduct[]>(() => [{id:'draft-preview',title:'Podgląd',category:'inne',defaultQuantity:'1',defaultUnit:'szt.',
    imagePath:quickForm.imagePath,imageURL:quickForm.imageURL}], [quickForm.imagePath,quickForm.imageURL]);
  const previewImages = usePrivateProductImages(user.uid, previewProducts);
  const quickPreviewURL = productStoragePath(previewProducts[0]) ? previewImages['draft-preview'] : publicProductImage(previewProducts[0]);
  const familyId = householdFamilyId(member);
  const protectedImages = usePrivateProductImages(user.uid, customQuick);
  const holdTimer = useRef<number | null>(null);
  const holdOrigin = useRef<{ x: number; y: number } | null>(null);
  const holdOpened = useRef<string | null>(null);
  const adult = isAdultMember(member);
  const [addingShopping, setAddingShopping] = useState(false);
  const shoppingSavingRef = useRef(false);
  const quickSavingRef = useRef(false);
  const [savingQuick, setSavingQuick] = useState(false);
  const quickInflight = useRef(new Set<string>());

  useEffect(() => onSnapshot(collection(db, 'shoppingItems'), (snap) => {
    const next = snap.docs.map((d): StoreShoppingItem => {
      const x = d.data();
      const titleValue = String(x.title || '');
      return { id: d.id, title: titleValue, done: x.done === true, category: isShoppingCategory(x.category) ? x.category : categorizeProduct(titleValue), quantity: typeof x.quantity === 'string' ? x.quantity : '', unit: typeof x.unit === 'string' ? x.unit : '', shopIds: normalizeShopIds(x.shopIds), createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : undefined };
    });
    next.sort((a, b) => Number(a.done) - Number(b.done) || (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
    setItems(next);
  }), []);

  useEffect(() => subscribe(collection(db, 'shoppingStores'), snapshot => {
    setCustomStores(snapshot.docs.map(row => {
      const value = row.data();
      return { id: row.id, name: String(value.name || 'Sklep'), createdBy: String(value.createdBy || ''), archived: value.archived === true };
    }).filter(store => normalizeShopIds([store.id]).length > 0).sort((a, b) => a.name.localeCompare(b.name, 'pl')));
    setStoresError('');
  }, () => setStoresError('Własne sklepy wymagają aktualnych reguł Firebase. Wspólna lista nadal działa.')), []);

  const allStores = useMemo(() => shoppingStores(customStores), [customStores]);
  const activeStores = allStores.filter(store => !store.archived);
  const visibleItems = productsForStore(items, selectedStore);
  const selectedStoreName = activeStores.find(store => store.id === selectedStore)?.name;
  useEffect(() => {
    if (selectedStore !== 'all' && !allStores.some(store => store.id === selectedStore && !store.archived)) setSelectedStore('all');
  }, [allStores, selectedStore]);

  useEffect(() => {
    setCustomQuick([]);
    if (!familyId) return;
    return onSnapshot(query(collection(db, 'quickProducts'), where('familyId', '==', familyId)), (snap) => {
    setCustomQuick(snap.docs.map((d) => {
      const x = d.data();
      return { id:typeof x.productKey === 'string' ? x.productKey : d.id, storageId:d.id, title:String(x.title || 'Produkt'), category:isShoppingCategory(x.category) ? x.category : 'inne', icon:typeof x.icon === 'string' ? x.icon : undefined, imagePath:typeof x.imagePath === 'string' ? x.imagePath : undefined, imageURL:typeof x.imageURL === 'string' ? x.imageURL : undefined, adultOnly:typeof x.adultOnly === 'boolean' ? x.adultOnly : undefined, defaultQuantity:String(x.defaultQuantity || '1'), defaultUnit:String(x.defaultUnit || 'szt.'), custom:x.custom === true, hidden:x.hidden === true };
    }));
    });
  }, [user.uid, familyId]);

  const quickProducts = useMemo(() => {
    const overrides = new Map(customQuick.map((x) => [x.id, x]));
    const merged = DEFAULT_QUICK_PRODUCTS.map((base) => overrides.has(base.id) ? { ...base, ...overrides.get(base.id) } as QuickProduct : base);
    for (const custom of customQuick) if (!DEFAULT_QUICK_PRODUCTS.some((b) => b.id === custom.id)) merged.push(custom);
    return merged.filter((p) => !p.hidden && (!p.adultOnly || adult) && (quickCategory === 'all' || p.category === quickCategory))
      .map(product => ({ ...product, imageURL: productStoragePath(product) ? protectedImages[product.id] : publicProductImage(product) }));
  }, [customQuick, adult, quickCategory, protectedImages]);

  async function addItem(productTitle: string, qty = '1', productUnit = 'szt.', category?: ShoppingCategory) {
    const clean = productTitle.trim(); if (!clean) return;
    if (draftShopIds.length) assertFamilyV2WriteAllowed();
    await addDoc(collection(db, 'shoppingItems'), { title: clean, done: false, category: category || categorizeProduct(clean), quantity: qty, unit: productUnit, ...(draftShopIds.length ? { shopIds: normalizeShopIds(draftShopIds) } : {}), createdBy: user.uid, createdAt: Timestamp.now() });
  }

  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim() || shoppingSavingRef.current) return;
    shoppingSavingRef.current = true; setAddingShopping(true);
    try { await addItem(title, quantity.trim(), unit, categoryChoice === 'auto' ? categorizeProduct(title) : categoryChoice); setTitle(''); setQuantity('1'); setUnit('szt.'); setCategoryChoice('auto'); }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { shoppingSavingRef.current = false; setAddingShopping(false); }
  }

  async function addQuick(product: QuickProduct) {
    if (quickInflight.current.has(product.id)) return;
    quickInflight.current.add(product.id);
    try { await addItem(product.title, product.defaultQuantity, product.defaultUnit, product.category); notify(`Dodano: ${product.title}`); }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { quickInflight.current.delete(product.id); }
  }

  function parseNote(value: string) {
    const trimmed = value.trim(); if (!trimmed) return [] as string[];
    if (/[\n,;]/.test(trimmed)) return trimmed.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    const known = quickProducts.map((p) => p.title).sort((a,b) => b.length-a.length);
    let work = ` ${trimmed} `;
    const result: string[] = [];
    for (const title of known) {
      const rx = new RegExp(`(^|\\s)${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
      if (rx.test(work.trim())) { result.push(title); work = work.replace(rx, ' '); }
    }
    result.push(...work.trim().split(/\s+/).filter(Boolean));
    return result;
  }

  async function addQuickNote() {
    const products = parseNote(quickNote);
    if (!products.length || shoppingSavingRef.current) return;
    if (products.length > 200) { notify('Dodaj maksymalnie 200 produktów naraz.', 'error'); return; }
    shoppingSavingRef.current = true; setAddingShopping(true);
    try {
      if (draftShopIds.length) assertFamilyV2WriteAllowed();
      const batch = writeBatch(db);
      for (const product of products) batch.set(doc(collection(db,'shoppingItems')), { title:product, done:false, category:categorizeProduct(product), quantity:'1', unit:'szt.', ...(draftShopIds.length ? { shopIds: normalizeShopIds(draftShopIds) } : {}), createdBy:user.uid, createdAt:Timestamp.now() });
      await batch.commit(); setQuickNote('');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { shoppingSavingRef.current = false; setAddingShopping(false); }
  }

  const grouped = useMemo(() => {
    const order = Object.keys(SHOPPING_META) as ShoppingCategory[];
    return order.map((category) => ({ category, items: productsForStore(items, selectedStore).filter((item) => item.category === category) })).filter((group) => group.items.length > 0);
  }, [items, selectedStore]);

  async function clearDone() {
    const done = visibleItems.filter((item) => item.done);
    if (done.length === 0) return;
    if (!window.confirm(`Usunąć kupione produkty (${done.length})?`)) return;
    for (let i=0; i<done.length; i+=400) { const batch = writeBatch(db); done.slice(i,i+400).forEach(item=>batch.delete(doc(db,'shoppingItems',item.id))); await batch.commit(); }
  }

  async function saveStore(event: React.FormEvent) {
    event.preventDefault();
    const name = storeName.trim();
    if (!name || name.length > 80 || storeSavingRef.current) return;
    if (activeStores.some(store => store.id !== editingStore?.id && store.name.toLocaleLowerCase('pl') === name.toLocaleLowerCase('pl'))) { notify('Sklep o tej nazwie jest już na liście.', 'error'); return; }
    storeSavingRef.current = true; setSavingStore(true);
    try {
      assertFamilyV2WriteAllowed();
      if (editingStore) await updateDoc(doc(db, 'shoppingStores', editingStore.id), { name, updatedAt: Timestamp.now() });
      else await setDoc(doc(db, 'shoppingStores', `store-${crypto.randomUUID()}`), { name, createdBy: user.uid, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), archived: false });
      setStoreName(''); setEditingStore(null);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { storeSavingRef.current = false; setSavingStore(false); }
  }

  async function archiveStore(store: ShoppingStore) {
    if (!store.archived && !window.confirm(`Usunąć sklep „${store.name}” z widoku? Produkty i ich historia pozostaną na wspólnej liście.`)) return;
    try {
      assertFamilyV2WriteAllowed();
      await updateDoc(doc(db, 'shoppingStores', store.id), { archived: !store.archived, updatedAt: Timestamp.now() });
      if (!store.archived) setDraftShopIds(previous => previous.filter(id => id !== store.id));
    } catch (error) { notify(errorMessage(error), 'error'); }
  }

  async function saveItemStores(event: React.FormEvent) {
    event.preventDefault();
    if (!editingItemStores || savingItemStores) return;
    setSavingItemStores(true);
    try {
      assertFamilyV2WriteAllowed();
      await updateDoc(doc(db, 'shoppingItems', editingItemStores.id), { shopIds: normalizeShopIds(itemShopIds), updatedAt: Timestamp.now() });
      setEditingItemStores(null);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setSavingItemStores(false); }
  }

  useEffect(() => () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }, []);

  function startHold(product: QuickProduct, event: React.PointerEvent) {
    if (event.button !== 0) return;
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    holdOpened.current = null;
    holdOrigin.current = { x: event.clientX, y: event.clientY };
    holdTimer.current = window.setTimeout(() => { holdOpened.current = product.id; setQuickMenu(product); }, 550);
  }
  function cancelHold() { if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = null; holdOrigin.current = null; }
  function moveHold(event: React.PointerEvent) {
    if (holdOrigin.current && Math.hypot(event.clientX - holdOrigin.current.x, event.clientY - holdOrigin.current.y) > 8) cancelHold();
  }

  function openQuickEditor(product?: QuickProduct) {
    const item = product || { id:`custom-${Date.now()}`, title:'', category:'inne' as ShoppingCategory, icon:'📦', defaultQuantity:'1', defaultUnit:'szt.', custom:true };
    setEditingQuick(item);
    const saved = customQuick.find(row => row.id === item.id) || item;
    setQuickForm({ title:item.title, category:item.category, quantity:item.defaultQuantity, unit:item.defaultUnit, imageURL:saved.imagePath ? '' : saved.imageURL || '', imagePath:productStoragePath(saved) || '', icon:item.icon || '📦' });
    setQuickMenu(null);
  }

  async function uploadQuickImage(file: File) {
    if (file.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { notify('Wybierz zdjęcie JPG, PNG, WebP lub GIF do 5 MB.', 'error'); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const target = storageRef(storage, `quick-products/${user.uid}/${Date.now()}-${safeName}`);
    requireHouseholdFamilyId(member);
    assertFamilyV2WriteAllowed();
    await uploadBytes(target, file);
    await familyAction('storage', { operation:'finalizeProductImage', path:target.fullPath });
    setQuickForm((f) => ({ ...f, imageURL:'', imagePath:target.fullPath }));
  }

  async function saveQuick(e: React.FormEvent) {
    e.preventDefault(); if (!editingQuick || !quickForm.title.trim() || quickSavingRef.current) return;
    quickSavingRef.current = true; setSavingQuick(true);
    try {
    const familyId = requireHouseholdFamilyId(member);
    await setDoc(doc(db, 'quickProducts', editingQuick.storageId || `${familyId}--${editingQuick.id}`), { productKey:editingQuick.id, familyId, ...(!editingQuick.storageId ? { createdBy:user.uid } : {}), title:quickForm.title.trim(), category:quickForm.category, defaultQuantity:quickForm.quantity || '1', defaultUnit:quickForm.unit || 'szt.', imageURL:quickForm.imageURL, imagePath:quickForm.imagePath, icon:quickForm.icon || '📦', adultOnly:editingQuick.adultOnly === true, custom:editingQuick.custom === true || !DEFAULT_QUICK_PRODUCTS.some((p) => p.id === editingQuick.id), hidden:false, updatedAt:Timestamp.now() }, { merge:true });
    setEditingQuick(null);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { quickSavingRef.current = false; setSavingQuick(false); }
  }

  async function removeQuick(product: QuickProduct) {
    if (!window.confirm(`Usunąć kafelek „${product.title}” z szybkich zakupów?`)) return;
    if (DEFAULT_QUICK_PRODUCTS.some((p) => p.id === product.id)) {
      const familyId = requireHouseholdFamilyId(member);
      await setDoc(doc(db, 'quickProducts', product.storageId || `${familyId}--${product.id}`), { familyId, ...(!product.storageId ? {createdBy:user.uid} : {}), productKey:product.id, title:product.title, hidden:true, updatedAt:Timestamp.now() }, { merge:true });
    } else {
      await deleteDoc(doc(db, 'quickProducts', product.storageId || `${requireHouseholdFamilyId(member)}--${product.id}`));
    }
    setQuickMenu(null);
  }

  return (
    <div className="page-content compact-page shopping-v130">
      <ModuleHeader icon="🛒" title="Zakupy" text="Szybkie kafelki, notatka wielu produktów i jedna wspólna lista." action={visibleItems.some((i) => i.done) ? <button className="secondary-button" onClick={() => void clearDone().catch(error => notify(errorMessage(error), 'error'))}>🧹 Usuń kupione</button> : undefined} />

      <section className="shopping-stores" aria-label="Lista według sklepu">
        <div className="shopping-store-tabs" role="group" aria-label="Wybierz sklep">
          <button type="button" aria-pressed={selectedStore === 'all'} onClick={() => setSelectedStore('all')}><span>Wszystkie</span><strong>{remainingForStore(items, 'all')}</strong></button>
          {activeStores.map(store => <button key={store.id} type="button" aria-pressed={selectedStore === store.id} onClick={() => setSelectedStore(store.id)}><span>{store.name}</span><strong>{remainingForStore(items, store.id)}</strong></button>)}
        </div>
        <button className="secondary-button shopping-stores-manage" type="button" onClick={() => setStoresOpen(true)}>＋ Własne sklepy</button>
      </section>

      <form className="shopping-bar" onSubmit={add}>
        <input className="shopping-product" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Np. jabłka, mleko, bułki…" />
        <input className="shopping-quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Ilość" />
        <select aria-label="Jednostka" value={unit} onChange={(e) => setUnit(e.target.value)}><option>szt.</option><option>kg</option><option>g</option><option>l</option><option>ml</option><option>opak.</option><option>pęczek</option></select>
        <select aria-label="Kategoria produktu" value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value as 'auto' | ShoppingCategory)}><option value="auto">✨ Kategoria auto</option>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((category) => <option key={category} value={category}>{SHOPPING_META[category].icon} {SHOPPING_META[category].label}</option>)}</select>
        <button className="primary-button" disabled={addingShopping}>{addingShopping ? "Zapisuję…" : "＋ Dodaj"}</button>
      </form>

      <section className="quick-note-card"><header><strong>📝 Szybka notatka zakupowa</strong><small>Wpisz kilka rzeczy naraz — rozdzielimy je i dodamy do jednej listy.</small></header>
        <ShoppingStorePicker stores={activeStores} value={draftShopIds} onChange={setDraftShopIds} legend="Sklepy dla nowych produktów (opcjonalnie)"/>
        <div><textarea rows={2} value={quickNote} onChange={(e) => setQuickNote(e.target.value)} placeholder="Np. długopis, gumka, zeszyt, lampka, zegarek…" /><button className="primary-button" disabled={addingShopping} onClick={() => void addQuickNote()}>✨ Dodaj wszystkie</button></div>
      </section>

      <section className="quick-products-card">
        <header><div><strong>⭐ Szybkie zakupy</strong><small>Długie przytrzymanie: zmień ikonkę lub edytuj produkt.</small></div><button onClick={() => openQuickEditor()}>＋ Własny produkt</button></header>
        <div className="shopping-category-chips"><button className={quickCategory === 'all' ? 'active' : ''} onClick={() => setQuickCategory('all')}>Wszystkie</button>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((cat) => <button key={cat} className={quickCategory === cat ? 'active' : ''} onClick={() => setQuickCategory(cat)}>{SHOPPING_META[cat].icon} {SHOPPING_META[cat].label}</button>)}</div>
        <div className="quick-products-grid">{quickProducts.map((product) => <button type="button" key={product.id} className="quick-product-tile" aria-label={product.title} data-product-id={product.id} onClick={() => { if (holdOpened.current !== product.id) void addQuick(product); }} onPointerDown={(event) => startHold(product, event)} onPointerMove={moveHold} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onContextMenu={(event) => { event.preventDefault(); holdOpened.current = product.id; setQuickMenu(product); }}><span className="quick-product-visual" aria-hidden="true">{product.imageURL ? <img src={product.imageURL} alt="" loading="lazy" draggable={false} /> : product.icon}</span><strong>{product.title}</strong>{product.adultOnly && <em>18+</em>}<i aria-hidden="true" onClick={(event) => { event.stopPropagation(); setQuickMenu(product); }}>⋯</i></button>)}</div>
      </section>

      <section className="shopping-list-title"><div><strong>🛒 {selectedStoreName ? `Lista: ${selectedStoreName}` : 'Lista zakupów'}</strong><small>{visibleItems.filter((i) => !i.done).length} do kupienia</small></div></section>
      <section className="shopping-groups">
        {grouped.length === 0 ? <EmptyState icon="🛍️" text={selectedStoreName ? 'W tym sklepie nie ma przypisanych produktów.' : 'Lista zakupów jest pusta.'} /> : grouped.map((group) => (
          <article className="shopping-group" key={group.category}>
            <header><div><span>{SHOPPING_META[group.category].icon}</span><strong>{SHOPPING_META[group.category].label}</strong></div><small>{group.items.filter((i) => !i.done).length} do kupienia</small></header>
            <div>{group.items.map((item) => (
              <div className={`shopping-row ${item.done ? 'done' : ''}`} key={item.id}>
                <button className="check-button" aria-label={`${item.done ? 'Przywróć' : 'Oznacz jako kupione'}: ${item.title}`} onClick={() => void updateDoc(doc(db, 'shoppingItems', item.id), { done: !item.done, updatedAt: Timestamp.now() }).catch(error => notify(errorMessage(error), 'error'))}>{item.done ? '✓' : '○'}</button>
                <strong>{item.title}</strong><span>{[item.quantity, item.unit].filter(Boolean).join(' ')}</span><small>{item.done ? 'Kupione' : 'Do kupienia'}</small>
                <button className="shopping-item-stores" type="button" aria-label={`Zmień sklepy: ${item.title}`} onClick={() => { setEditingItemStores(item); setItemShopIds(item.shopIds); }}>{item.shopIds.length ? item.shopIds.map(id => allStores.find(store => store.id === id)?.name || 'Sklep').join(', ') : 'Sklepy'}</button>
                <button className="icon-danger" onClick={() => deleteDoc(doc(db, 'shoppingItems', item.id))}>🗑️</button>
              </div>
            ))}</div>
          </article>
        ))}
      </section>

      {storesOpen && <Modal title="Własne sklepy" onClose={() => { setStoresOpen(false); setEditingStore(null); setStoreName(''); }}>
        <div className="shopping-custom-stores">
          <p>Każdy produkt jest jeden, nawet gdy wybierzesz kilka sklepów.</p>
          {storesError && <p className="shopping-stores-status" role="status">{storesError}</p>}
          <form onSubmit={saveStore} className="shopping-store-form">
            <label className="field"><span>Nazwa sklepu</span><input required maxLength={80} value={storeName} onChange={event => setStoreName(event.target.value)} placeholder="Np. sklep osiedlowy"/></label>
            <button className="primary-button" disabled={savingStore || !storeName.trim()}>{savingStore ? 'Zapisuję…' : editingStore ? 'Zapisz sklep' : 'Dodaj sklep'}</button>
            {editingStore && <button type="button" className="secondary-button" onClick={() => { setEditingStore(null); setStoreName(''); }}>Anuluj edycję</button>}
          </form>
          {customStores.length === 0 ? <p className="muted-text">Nie dodano własnych sklepów.</p> : customStores.map(store => <div key={store.id} className="shopping-custom-store-row">
            <strong>{store.name}{store.archived && <small> · Ukryty</small>}</strong>
            {(store.createdBy === user.uid || isParent(member)) && <><button type="button" className="secondary-button" onClick={() => { setEditingStore(store); setStoreName(store.name); }}>Edytuj</button><button type="button" className="secondary-button" onClick={() => void archiveStore(store)}>{store.archived ? 'Przywróć' : 'Usuń sklep'}</button></>}
          </div>)}
        </div>
      </Modal>}

      {editingItemStores && <Modal title={`Sklepy: ${editingItemStores.title}`} onClose={() => setEditingItemStores(null)}>
        <form onSubmit={saveItemStores} className="shopping-item-stores-form">
          <ShoppingStorePicker stores={allStores} value={itemShopIds} onChange={setItemShopIds}/>
          <p>Odhaczenie zakupu dotyczy wszystkich wybranych sklepów.</p>
          <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditingItemStores(null)}>Anuluj</button><button className="primary-button" disabled={savingItemStores}>{savingItemStores ? 'Zapisuję…' : 'Zapisz sklepy'}</button></div>
        </form>
      </Modal>}

      {quickMenu && <div className="quick-product-menu-backdrop" onClick={() => setQuickMenu(null)}><div className="quick-product-menu" onClick={(e) => e.stopPropagation()}><strong>{quickMenu.title}</strong><button onClick={() => openQuickEditor(quickMenu)}>🖼️ Zmień ikonkę / Edytuj</button><button className="danger" onClick={() => void removeQuick(quickMenu)}>🗑️ Usuń</button><button onClick={() => setQuickMenu(null)}>Anuluj</button></div></div>}

      {editingQuick && <Modal title={editingQuick.custom ? '➕ Własny produkt' : `🖼️ ${editingQuick.title}`} onClose={() => setEditingQuick(null)}>
        <form className="form-grid" onSubmit={saveQuick}>
          <label className="field field-wide"><span>Nazwa</span><input value={quickForm.title} onChange={(e) => setQuickForm((f) => ({ ...f, title:e.target.value }))} required /></label>
          <label className="field"><span>Kategoria</span><select aria-label="Kategoria" value={quickForm.category} onChange={(e) => setQuickForm((f) => ({ ...f, category:e.target.value as ShoppingCategory }))}>{(Object.keys(SHOPPING_META) as ShoppingCategory[]).map((cat) => <option key={cat} value={cat}>{SHOPPING_META[cat].label}</option>)}</select></label>
          <label className="field"><span>Emoji awaryjne</span><input value={quickForm.icon} onChange={(e) => setQuickForm((f) => ({ ...f, icon:e.target.value }))} /></label>
          <label className="field"><span>Domyślna ilość</span><input value={quickForm.quantity} onChange={(e) => setQuickForm((f) => ({ ...f, quantity:e.target.value }))} /></label>
          <label className="field"><span>Jednostka</span><select aria-label="Jednostka" value={quickForm.unit} onChange={(e) => setQuickForm((f) => ({ ...f, unit:e.target.value }))}><option>szt.</option><option>kg</option><option>g</option><option>l</option><option>ml</option><option>opak.</option><option>pęczek</option></select></label>
          <label className="field field-wide"><span>Własne zdjęcie / ikonka</span><input type="file" accept="image/*" onChange={(e) => { const file=e.target.files?.[0]; if (file) void uploadQuickImage(file).catch(() => alert('Nie udało się wysłać zdjęcia. Sprawdź Firebase Storage.')); }} />{quickPreviewURL && <img className="quick-image-preview" src={quickPreviewURL} alt="Podgląd" />}</label>
          <div className="form-actions field-wide"><button type="button" className="secondary-button" onClick={() => setEditingQuick(null)}>Anuluj</button><button className="primary-button">✓ Zapisz</button></div>
        </form>
      </Modal>}
    </div>
  );
}
