// Read-only physical count from 26 Sep 2026. Never imported automatically.
// Locations, prices and unknown specifications intentionally remain blank.
export const lampInventoryDraft = [
  { type: 'H4', brand: 'OSRAM', quantity: 2 },
  { type: 'H4', brand: 'HELLA', manufacturerNumber: '22-64193', quantity: 3 },
  { type: 'H11', brand: 'LiMASTAR', manufacturerNumber: 'GE-1112055', ean: '6970057144252', quantity: 8 },
  { type: 'H7', brand: 'OSRAM', ean: '4050300332185', quantity: 18 },
  { type: 'P21W', brand: 'OSRAM', ean: '4050300524849', quantity: 10 },
  { type: 'W5W', brand: 'OSRAM', ean: '4050300524801', quantity: 28 },
  { type: 'WY21W', brand: 'OSRAM', ean: '4008321165480', quantity: 15 },
  { type: 'W21/5W', brand: 'OSRAM', ean: '4052899324329', quantity: 6 },
  { type: 'W16W', brand: 'OSRAM', ean: '4008321100955', quantity: 8 },
  { type: 'P21/4W', brand: 'OSRAM', ean: '4050300891521', quantity: 21 },
  { type: 'R10W', brand: 'OSRAM', ean: '4050300525464', quantity: 17 },
  { type: 'Night Breaker Unlimited H1', brand: 'OSRAM', quantity: 10 },
  { type: 'T10', brand: 'LiMASTAR', manufacturerNumber: '242555 / 12866', ean: '6970057146874', quantity: 20 },
  { type: 'WY5W/T10', brand: 'LiMASTAR', manufacturerNumber: '242557 / 12396A', ean: '6970057146157', quantity: 10 },
  { type: 'C5W', brand: 'LiMASTAR', manufacturerNumber: '12860', ean: '6970057146256', voltage: '12V', wattage: '5W', color: 'clear', quantity: 10 },
  { type: 'W5W T10', brand: '', ean: '6970057144696', voltage: '12V', wattage: '5W', color: 'clear', quantity: 2 },
  { type: 'T5', brand: '', ean: '6941581442282', voltage: '12V', wattage: '2.3W', color: 'clear', quantity: 20 },
];

export const draftTotal = lampInventoryDraft.reduce((total, item) => total + item.quantity, 0);
