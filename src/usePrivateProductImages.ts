import { useEffect, useState } from 'react';
import { auth, storage } from './firebase';
import { ref } from 'firebase/storage';
import { getPrivateStorageBlob } from './private-storage-blob';
import type { QuickProduct } from './app-shared';

export function productStoragePath(product: QuickProduct): string | null {
  if (product.imagePath?.startsWith('quick-products/')) return product.imagePath;
  if (!product.imageURL) return null;
  try {
    const url = new URL(product.imageURL);
    const match = url.hostname === 'firebasestorage.googleapis.com' ? /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname)
      : ['storage.googleapis.com','storage.cloud.google.com'].includes(url.hostname) ? /^\/([^/]+)\/(.+)$/.exec(url.pathname) : null;
    return url.protocol === 'https:' && match
      && decodeURIComponent(match[1]) === storage.app.options.storageBucket
      && decodeURIComponent(match[2]).startsWith('quick-products/') ? decodeURIComponent(match[2]) : null;
  } catch { return null; }
}
export function publicProductImage(product: QuickProduct): string | undefined {
  if (product.imagePath || productStoragePath(product)) return undefined;
  try {
    if (product.imageURL && ['firebasestorage.googleapis.com','storage.googleapis.com','storage.cloud.google.com'].includes(new URL(product.imageURL).hostname)) return undefined;
  } catch { /* Bundled application assets are allowed. */ }
  return product.imageURL;
}
/** Storage SDK authorization replaces public bearer links; URLs live in memory only. */
export function usePrivateProductImages(uid: string, products: QuickProduct[]) {
  const [state, setState] = useState<{ uid: string; values: Record<string, string> }>({ uid, values: {} });
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setState({ uid, values: {} });
    for (const product of products) {
      const path = productStoragePath(product);
      if (!path) continue;
      getPrivateStorageBlob(ref(storage, path), 5 * 1024 * 1024).then(blob => {
        if (!active || auth.currentUser?.uid !== uid) return;
        const url = URL.createObjectURL(blob); urls.push(url);
        setState(previous => previous.uid === uid ? { uid, values: { ...previous.values, [product.id]: url } } : previous);
      }).catch(() => { /* Never fall back to an unprotected token URL. */ });
    }
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [uid, products]);
  return state.uid === uid ? state.values : {};
}
