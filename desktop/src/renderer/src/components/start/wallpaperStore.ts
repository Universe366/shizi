const DB_NAME = 'shizi-start-wallpaper';
const STORE_NAME = 'files';
const RECORD_KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB 操作失败'));
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'));
      })
  );
}

/** 自定义壁纸（GIF / 视频）体积大，放 IndexedDB，不塞进 settings.json。 */
export function saveWallpaperBlob(blob: Blob): Promise<void> {
  return run('readwrite', (store) => store.put(blob, RECORD_KEY)).then(() => undefined);
}

export function loadWallpaperBlob(): Promise<Blob | null> {
  return run<Blob | undefined>('readonly', (store) => store.get(RECORD_KEY)).then(
    (value) => value || null
  );
}

export function clearWallpaperBlob(): Promise<void> {
  return run('readwrite', (store) => store.delete(RECORD_KEY)).then(() => undefined);
}
