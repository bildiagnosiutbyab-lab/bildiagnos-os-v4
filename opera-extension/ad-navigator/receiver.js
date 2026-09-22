(() => {
  const STORAGE_KEY = 'bildiagnosCatalogTransfer';

  function deliver() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) return;
      const transfer = result[STORAGE_KEY];
      if (!transfer?.payload) return;
      window.dispatchEvent(new CustomEvent('BILDIAGNOS_CATALOG_TRANSFER', {
        detail: JSON.stringify(transfer.payload),
      }));
    });
  }

  window.addEventListener('BILDIAGNOS_REQUEST_CATALOG_TRANSFER', deliver);
  window.addEventListener('BILDIAGNOS_CATALOG_TRANSFER_CONSUMED', () => {
    chrome.storage.local.remove(STORAGE_KEY);
  });

  window.setTimeout(deliver, 800);
})();
