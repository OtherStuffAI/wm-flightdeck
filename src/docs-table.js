const DOC_TABLE_SORT_FIELDS = new Set(['name', 'created_at', 'updated_at']);

export function normalizeDocTableSortField(value) {
  return DOC_TABLE_SORT_FIELDS.has(value) ? value : 'name';
}

export function normalizeDocTableSortDirection(value) {
  return value === 'desc' ? 'desc' : 'asc';
}

export function initialDocTableSortDirection(field) {
  return normalizeDocTableSortField(field) === 'name' ? 'asc' : 'desc';
}

export function nextDocTableSort(currentField, currentDirection, selectedField) {
  const field = normalizeDocTableSortField(selectedField);
  if (field !== normalizeDocTableSortField(currentField)) {
    return { field, direction: initialDocTableSortDirection(field) };
  }
  return {
    field,
    direction: normalizeDocTableSortDirection(currentDirection) === 'asc' ? 'desc' : 'asc',
  };
}

function rowName(row) {
  const fallback = row?.type === 'directory' ? 'Untitled folder' : 'Untitled document';
  return String(row?.item?.title || fallback);
}

function compareText(left, right) {
  const base = left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
  return base || left.localeCompare(right, undefined, { numeric: true });
}

function compareStableIdentity(left, right) {
  const typeDelta = String(left?.type || '').localeCompare(String(right?.type || ''));
  if (typeDelta) return typeDelta;
  return String(left?.item?.record_id || '').localeCompare(String(right?.item?.record_id || ''));
}

function timestampValue(row, field) {
  const value = Date.parse(row?.item?.[field] || '');
  return Number.isFinite(value) ? value : null;
}

export function compareDocBrowserRows(left, right, field = 'name', direction = 'asc') {
  const normalizedField = normalizeDocTableSortField(field);
  const directionFactor = normalizeDocTableSortDirection(direction) === 'desc' ? -1 : 1;

  if (normalizedField === 'name') {
    const nameDelta = compareText(rowName(left), rowName(right));
    if (nameDelta) return nameDelta * directionFactor;
    return compareStableIdentity(left, right);
  }

  const leftTimestamp = timestampValue(left, normalizedField);
  const rightTimestamp = timestampValue(right, normalizedField);
  if (leftTimestamp == null || rightTimestamp == null) {
    if (leftTimestamp == null && rightTimestamp != null) return 1;
    if (leftTimestamp != null && rightTimestamp == null) return -1;
  } else if (leftTimestamp !== rightTimestamp) {
    return (leftTimestamp - rightTimestamp) * directionFactor;
  }

  const nameDelta = compareText(rowName(left), rowName(right));
  return nameDelta || compareStableIdentity(left, right);
}

export function sortDocBrowserRows(rows = [], field = 'name', direction = 'asc') {
  return [...(Array.isArray(rows) ? rows : [])]
    .sort((left, right) => compareDocBrowserRows(left, right, field, direction));
}

export function normalizeDocTableTimestamp(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function formatDocTableDateTime(value, formatter = (date) => date.toLocaleString()) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '—';
  return formatter(new Date(timestamp));
}
