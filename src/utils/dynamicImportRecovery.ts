const RECOVERY_STORAGE_KEY = 'ibd:dynamic-import-recovery';
const RECOVERY_COOLDOWN_MS = 30_000;

function getErrorText(error: unknown) {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }
  return String(error).toLowerCase();
}

export function isDynamicImportError(error: unknown) {
  const text = getErrorText(error);
  return [
    'chunkloaderror',
    'failed to fetch dynamically imported module',
    'error loading dynamically imported module',
    'importing a module script failed',
    'loading chunk',
    'loading css chunk',
    'module script',
    'mime type',
  ].some(fragment => text.includes(fragment));
}

function readLastRecoveryTime() {
  try {
    return Number(window.sessionStorage.getItem(RECOVERY_STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function rememberRecoveryAttempt(timestamp: number) {
  try {
    window.sessionStorage.setItem(RECOVERY_STORAGE_KEY, String(timestamp));
  } catch {
    // sessionStorage may be unavailable in privacy-restricted browser contexts.
  }
}

export async function loadPageWithRecovery<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isDynamicImportError(error)) {
      const now = Date.now();
      if (now - readLastRecoveryTime() > RECOVERY_COOLDOWN_MS) {
        rememberRecoveryAttempt(now);
        window.location.reload();
        return new Promise<T>(() => undefined);
      }
    }
    throw error;
  }
}
