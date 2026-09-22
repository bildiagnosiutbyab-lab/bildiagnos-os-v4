const HOUR_FIELDS = ['hours', 'laborHours', 'labourHours', 'workHours', 'estimatedHours', 'repairHours', 'timeHours'];
const MINUTE_FIELDS = ['minutes', 'laborMinutes', 'labourMinutes', 'workMinutes', 'estimatedMinutes', 'repairMinutes', 'durationMinutes'];
const FLEXIBLE_FIELDS = ['time', 'laborTime', 'labourTime', 'workTime', 'estimatedTime', 'repairTime', 'duration'];

function decimal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationText(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;

  const iso = text.match(/^pt(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+(?:[.,]\d+)?)m)?$/i);
  if (iso) return (decimal(iso[1]) || 0) + (decimal(iso[2]) || 0) / 60;

  const clock = text.match(/^(\d{1,3}):([0-5]\d)(?::[0-5]\d)?$/);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;

  const hours = text.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours|tim|timmar)\b/);
  const minutes = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minute|minutes|minuter)\b/);
  if (hours || minutes) return (decimal(hours?.[1]) || 0) + (decimal(minutes?.[1]) || 0) / 60;

  return decimal(text.replace(/[^0-9,.-]/g, ''));
}

export function parseCatalogLaborHours(item) {
  for (const field of HOUR_FIELDS) {
    const value = decimal(item?.[field]);
    if (value !== null) return value;
  }
  for (const field of MINUTE_FIELDS) {
    const value = decimal(item?.[field]);
    if (value !== null) return value / 60;
  }
  for (const field of FLEXIBLE_FIELDS) {
    const value = durationText(item?.[field]);
    if (value !== null) return value;
  }
  return null;
}
