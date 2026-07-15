'use strict';

// Minimal RFC 4180 CSV reader. The PDDIKTI export quotes fields containing
// commas (institution names often do), so a naive split is not enough.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1);
}

function toObjects(rows) {
  const header = rows[0];
  return rows.slice(1).map(r =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))
  );
}

module.exports = { parseCSV, toObjects };
