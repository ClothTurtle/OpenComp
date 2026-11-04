// A tiny IndexedDB key-value store. Used for the autosave, which can outgrow localStorage's ~5 MB
// once tracked AI masks are involved.
const DB_NAME = 'opencomp'
const STORE = 'kv'

let db: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return db
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (d) =>
      new Promise((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const idbGet = <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key)).catch(() => undefined)
export const idbSet = (key: string, value: unknown) => run<void>('readwrite', (s) => s.put(value, key))
