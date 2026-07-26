// Encrypts small secrets (like the GenAI.mil STARK key) at rest in localStorage.
//
// The AES-GCM key is generated once per browser profile and stored as a
// non-extractable CryptoKey in IndexedDB — JS code can use it to encrypt/decrypt,
// but can never read out its raw bytes. This blocks casual inspection of
// localStorage/devtools; it does not protect against someone with full access
// to this OS user account (they could still call the same encrypt/decrypt code).

const DB_NAME = 'odyssey-key-vault';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const VAULT_KEY_ID = 'vault-aes-key-v1';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local key vault.'));
  });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error('Local key vault read failed.'));
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Local key vault write failed.'));
  });
}

async function getOrCreateVaultKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(VAULT_KEY_ID);
  if (existing) return existing;
  const key = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idbSet(VAULT_KEY_ID, key);
  return key;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function encryptForLocalStorage(plaintext: string): Promise<string> {
  const key = await getOrCreateVaultKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptFromLocalStorage(stored: string): Promise<string | null> {
  const [ivPart, dataPart] = stored.split('.');
  if (!ivPart || !dataPart) return null;
  try {
    const key = await getOrCreateVaultKey();
    const plaintext = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivPart) },
      key,
      fromBase64(dataPart),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
