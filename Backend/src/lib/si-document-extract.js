/**
 * Extract plain text from SI attachment (PDF with text layer, or raster image) and
 * heuristically parse common shipping-instruction fields. OCR quality depends on scan quality;
 * users should always review auto-filled values.
 */
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import { fileTypeFromBuffer } from 'file-type';

const MAX_TEXT_CHARS = 120_000;

/** Magic-byte allowlist aligned with upload-mime (PDF + common images). */
const SUPPORTED_FOR_EXTRACT = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function collapseWs(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/ +/g, ' ')
    .trim();
}

/** @param {string} line */
function lineAfterLabel(text, labelRe, maxLen = 400) {
  const re = new RegExp(`${labelRe}\\s*[\\s:.-]*([^\\n]+)`, 'i');
  const m = text.match(re);
  if (!m) return null;
  let v = m[1].trim();
  v = v.replace(/\s{2,}/g, ' ');
  if (v.length > maxLen) v = v.slice(0, maxLen).trim();
  return v || null;
}

/**
 * @param {string} raw
 * @returns {string|null} YYYY-MM-DD
 */
export function parseLooseDateToYmd(raw) {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    let day = a;
    let month = b;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      day = b;
      month = a;
    } else {
      day = a;
      month = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && y >= 1990 && y <= 2100) {
      return `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = String(parseInt(m[2], 10)).padStart(2, '0');
    const d = String(parseInt(m[3], 10)).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  const monthNames =
    /\b(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\s+(\d{4})\b/i;
  const mm = s.match(monthNames);
  if (mm) {
    const months = {
      JANUARY: 1,
      JAN: 1,
      FEBRUARY: 2,
      FEB: 2,
      MARCH: 3,
      MAR: 3,
      APRIL: 4,
      APR: 4,
      MAY: 5,
      JUNE: 6,
      JUN: 6,
      JULY: 7,
      JUL: 7,
      AUGUST: 8,
      AUG: 8,
      SEPTEMBER: 9,
      SEP: 9,
      SEPT: 9,
      OCTOBER: 10,
      OCT: 10,
      NOVEMBER: 11,
      NOV: 11,
      DECEMBER: 12,
      DEC: 12,
    };
    const day = parseInt(mm[1], 10);
    const mo = months[mm[2].toUpperCase()];
    const y = parseInt(mm[3], 10);
    if (mo && day >= 1 && day <= 31) {
      return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

/**
 * Scan full text for document / SI dates (supports Indonesian labels).
 */
function extractDocumentDateYmd(text) {
  const candidates = [];
  const patterns = [
    /(?:document|Tanggal\s+dokumen|tgl\.?\s*dokumen)\s*(?:date)?\s*[:\s]+(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})/gi,
    /(?:date\s*of\s*document|issued?\s*(?:date|on)?)\s*[:\s]+(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})/gi,
  ];
  for (const re of patterns) {
    let mm;
    const r = new RegExp(re.source, re.flags);
    while ((mm = r.exec(text)) !== null) {
      const ymd = parseLooseDateToYmd(mm[1]);
      if (ymd) candidates.push(ymd);
    }
  }
  if (candidates.length) return candidates[0];
  const lineHit = lineAfterLabel(
    text,
    '(?:Document date|Tanggal dokumen|Issue date|Tgl\\. dokumen)',
    24
  );
  if (lineHit) return parseLooseDateToYmd(lineHit);

  const monthRe =
    /\b(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{4})\b/gi;
  let md;
  const monthCandidates = [];
  while ((md = monthRe.exec(text)) !== null) {
    const ymd = parseLooseDateToYmd(`${md[1]} ${md[2]} ${md[3]}`);
    if (ymd) monthCandidates.push(ymd);
  }
  if (monthCandidates.length) return monthCandidates[monthCandidates.length - 1];

  return null;
}

function extractReferenceNumber(text) {
  const patterns = [
    /(?:^|\n)\s*No\.?\s*[:\s]+([A-Za-z0-9][A-Za-z0-9/.-]{2,48})/im,
    /(?:shipping\s*instructions?\s*(?:no\.?|number|#)?|SI\s*N(?:O|o\.?)?|ref(?:erence)?\s*(?:no\.?|#)?)\s*[:\s]+([A-Za-z0-9][A-Za-z0-9/.-]{2,40})/i,
    /(?:^|\n)\s*SI\s*[#:\s]+([A-Za-z0-9][A-Za-z0-9/.-]{2,40})/im,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractFreightTerms(text) {
  const u = text.toUpperCase();
  if (/\bFREIGHT\s+PREPAID\b/.test(u) || /\bPREPAID\b/.test(u)) return 'PREPAID';
  if (/\bFREIGHT\s+COLLECT\b/.test(u) || /\bCOLLECT\b/.test(u)) return 'COLLECT';
  if (/\bAS\s+PER\s+CHARTER\s+PARTY\b/.test(u)) return 'AS_PER_CHARTER_PARTY';
  return null;
}

function extractPartyFields(text) {
  const shipper =
    lineAfterLabel(text, '(?:Shipper|Penjual|Seller|Pengirim)\\b', 200) ||
    lineAfterLabel(text, 'From\\s*(?:Party)?', 120);
  const loadingPort =
    lineAfterLabel(
      text,
      '(?:Port\\s*of\\s*Loading|Loading\\s*port|Shipment\\s*from|Pelabuhan\\s*muat|Port\\s*muat)',
      160
    ) || lineAfterLabel(text, '(?:POL|P\\.O\\.L\\.)', 120);
  const surveyor =
    lineAfterLabel(text, '(?:Surveyor|Surveyor\\s*\\(on\\s*behalf)', 160) ||
    lineAfterLabel(text, 'Cargo\\s*survey', 120);
  return {
    shipper: shipper ? clipPartyLine(shipper) : null,
    loadingPort: loadingPort ? clipPartyLine(loadingPort) : null,
    surveyor: surveyor ? clipPartyLine(surveyor) : null,
  };
}

function clipPartyLine(s) {
  const first = String(s).split(/\n/)[0].trim().replace(/\s+/g, ' ');
  return first.length > 200 ? first.slice(0, 200) : first;
}

function extractBlockAfterLabel(text, labelRe, maxLen = 1200) {
  const re = new RegExp(`${labelRe}\\s*[\\s:.-]*\\n?([\\s\\S]{0,${maxLen}}?)(?=\\n\\s*[A-Z][A-Z0-9 /]{2,40}\\s*[:.]|\n\\s*\\n|$)`, 'i');
  const m = text.match(re);
  if (!m?.[1]) return null;
  const v = collapseWs(m[1]);
  return v.length > 8 ? v : null;
}

function extractLongTextFields(text) {
  const destinationText =
    lineAfterLabel(text, '(?:Destination|Final\\s*destination|Pelabuhan\\s*tujuan|Tujuan)', 400) || null;
  const consigneeText =
    extractBlockAfterLabel(text, 'CONSIGNEE') ||
    lineAfterLabel(text, '(?:Consignee|Penerima)', 800) ||
    null;
  const notifyPartyText =
    extractBlockAfterLabel(text, 'NOTIFY\\s*PARTY') ||
    lineAfterLabel(text, '(?:Notify\\s*party|Pihak\\s*yang\\s*diberitahu)', 800) ||
    null;
  const blSplitText =
    lineAfterLabel(text, '(?:BL\\s*SPLIT|B/L\\s*SPLIT)', 200) ||
    lineAfterLabel(text, 'SPLIT', 120);
  const billOfLadingClause =
    extractBlockAfterLabel(text, 'BILL\\s*OF\\s*LADING', 600) ||
    lineAfterLabel(text, 'B/L\\s*CLAUSE', 400);
  const blIndicated =
    lineAfterLabel(text, '(?:BL\\s*INDICATED|B/L\\s*INDICATED)', 400) ||
    lineAfterLabel(text, 'B/L\\s*INDICATION', 400);
  return { destinationText, consigneeText, notifyPartyText, blSplitText, billOfLadingClause, blIndicated };
}

function extractVesselName(text) {
  return (
    lineAfterLabel(text, '(?:VESSEL\\s*NAME|NAME\\s*OF\\s*VESSEL|MV|MT)', 120) ||
    (() => {
      const m = text.match(/\b(?:MV|MT|M\/V|M\.V\.)\s+([A-Z0-9][A-Z0-9 .\-]{2,60})/i);
      return m?.[1]?.trim() || null;
    })()
  );
}

function extractAgent(text) {
  return (
    lineAfterLabel(text, '(?:MESSRS|MESSRS\\.|M/S|AGENT)', 200) ||
    lineAfterLabel(text, 'FOR\\s*AND\\s*ON\\s*BEHALF', 160)
  );
}

function extractEtaHint(text) {
  const hit = lineAfterLabel(text, '(?:ETA|ESTIMATED\\s*TIME\\s*OF\\s*ARRIVAL)', 40);
  if (hit) return parseLooseDateToYmd(hit) || hit.trim();
  const m = text.match(/\bETA\s*[:\s]+(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
  if (m?.[1]) return parseLooseDateToYmd(m[1]) || m[1].trim();
  return null;
}

function extractPrimaryQuantityRow(text) {
  const qtyLine =
    lineAfterLabel(text, '(?:QUANTITY|QTY|Q\\.?TY)', 120) ||
    lineAfterLabel(text, 'DESCR\\.?\\s*OF\\s*GOOD', 200);
  const commodityHint =
    lineAfterLabel(text, '(?:DESCR\\.?\\s*OF\\s*GOOD|DESCRIPTION\\s*OF\\s*GOODS|COMMODITY)', 200) ||
    null;
  let qty = null;
  let metricCode = null;
  if (qtyLine) {
    const qm = qtyLine.match(/(\d+(?:[.,]\d+)?)\s*(MTS?|MT|KL|TON|TNE|L)\b/i);
    if (qm) {
      qty = qm[1].replace(',', '.');
      metricCode = qm[2].toUpperCase();
      if (metricCode === 'MTS') metricCode = 'MT';
    } else {
      const qOnly = qtyLine.match(/(\d+(?:[.,]\d+)?)/);
      if (qOnly) qty = qOnly[1].replace(',', '.');
    }
  }
  return { qty, metricCode, commodityHint: commodityHint ? clipPartyLine(commodityHint) : null };
}

/**
 * Pull likely contract/PO lines from messy text (best-effort).
 */
function extractBreakdownLines(text) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const seen = new Set();

  const tryRow = (line) => {
    const contract =
      line.match(/(?:contract|kontrak)\s*(?:no\.?|#)?\s*[:\s]+([A-Za-z0-9][A-Za-z0-9/.-]{1,40})/i) ||
      line.match(/\b(?:C\/|C-|CRT|CONT\.?)\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,32})/i);
    const po =
      line.match(/P\.?\s*O\.?\s*(?:NO\.?|NUMBER|#)?\s*[:\s]+([A-Za-z0-9][A-Za-z0-9/.-]{1,40})/i) ||
      line.match(/\bPO[\s#:]+([A-Za-z0-9][A-Za-z0-9/.-]{1,32})/i);
    const so =
      line.match(/S\.?\s*O\.?\s*(?:NO\.?|NUMBER|#)?\s*[:\s]+([A-Za-z0-9][A-Za-z0-9/.-]{1,40})/i) ||
      line.match(/\bSO[\s#:]+([A-Za-z0-9][A-Za-z0-9/.-]{1,32})/i);
    const qtyM = line.match(/(\d+(?:[.,]\d+)?)\s*(MT|KL|TON|TNE|L)\b/i);
    const commHint = line.match(
      /(?:MFO|LSFO|HSFO|VLSFO|GASOIL|DIESEL|GAS\s*OIL|BITUMEN|LUBRICANT|CRUDE|CONDESATE|NAPHTHA|GASOLINE|PROPYLENE|ETHYLENE|ETC)/i
    );
    if (contract?.[1] || po?.[1] || so?.[1] || (qtyM && commHint)) {
      const key = `${contract?.[1] || ''}|${po?.[1] || ''}|${so?.[1] || ''}|${line.slice(0, 80)}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        contractNo: contract?.[1]?.trim() || null,
        poNo: po?.[1]?.trim() || null,
        soNo: so?.[1]?.trim() || null,
        qty: qtyM ? qtyM[1].replace(',', '.') : null,
        metricCode: qtyM ? qtyM[2].toUpperCase() : null,
        commodityHint: commHint ? commHint[0].trim() : null,
        remarks: line.length > 180 ? `${line.slice(0, 177)}...` : line,
      });
    }
  };

  for (const line of lines) tryRow(line);

  /* Join long broken lines: look for PO/Contract tokens */
  const blob = collapseWs(text);
  const globalRe =
    /P\.?\s*O\.?\s*(?:NO\.?)?\s*[:\s]+([A-Za-z0-9][A-Za-z0-9/.-]{2,32}).{0,120}?(?:contract|kontrak)\s*(?:no\.?)?\s*[:\s]+([A-Za-z0-9][A-Za-z0-9/.-]{2,32})/gi;
  let gm;
  while ((gm = globalRe.exec(blob)) !== null) {
    const key = `${gm[2]}|${gm[1]}|g`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      contractNo: gm[2].trim(),
      poNo: gm[1].trim(),
      qty: null,
      metricCode: null,
      commodityHint: null,
      remarks: null,
    });
  }

  return rows.slice(0, 12);
}

export function parseShippingInstructionText(rawText) {
  const text = collapseWs(rawText);
  if (!text) {
    return emptyParsedFields();
  }

  const ref = extractReferenceNumber(text);
  const docDate = extractDocumentDateYmd(text);
  const parties = extractPartyFields(text);
  const longs = extractLongTextFields(text);
  const freightTerms = extractFreightTerms(text);
  const voyageM =
    text.match(/(?:voyage|vyg\.?)\s*(?:no\.?|#)?\s*[:\s]+([A-Za-z0-9][A-Za-z0-9/.-]{1,32})/i) ||
    text.match(/\bV\.?\s*([0-9]{3,5}[A-Z]?)\b/i);
  let breakdown = extractBreakdownLines(rawText);
  const primaryQty = extractPrimaryQuantityRow(text);
  if (breakdown.length === 0 && (primaryQty.qty || primaryQty.commodityHint)) {
    breakdown = [
      {
        contractNo: null,
        poNo: null,
        soNo: null,
        qty: primaryQty.qty,
        metricCode: primaryQty.metricCode,
        commodityHint: primaryQty.commodityHint,
        remarks: null,
      },
    ];
  } else if (breakdown.length > 0 && primaryQty.commodityHint && !breakdown[0].commodityHint) {
    breakdown[0] = { ...breakdown[0], commodityHint: primaryQty.commodityHint };
  }

  const noteParts = [];
  if (freightTerms) noteParts.push(`Freight: ${freightTerms}`);
  const misc = lineAfterLabel(text, '(?:REMARKS?|NOTE|CATATAN)', 500);
  if (misc) noteParts.push(misc);

  return {
    vesselName: extractVesselName(text),
    etaHint: extractEtaHint(text),
    voyageNo: voyageM?.[1]?.trim() || null,
    agent: extractAgent(text),
    referenceNumber: ref,
    documentDate: docDate,
    shipper: parties.shipper,
    loadingPort: parties.loadingPort,
    surveyor: parties.surveyor,
    destinationText: longs.destinationText,
    freightTerms,
    consigneeText: longs.consigneeText,
    notifyPartyText: longs.notifyPartyText,
    blSplitText: longs.blSplitText,
    billOfLadingClause: longs.billOfLadingClause,
    blIndicated: longs.blIndicated,
    note: noteParts.length ? noteParts.join('\n') : null,
    breakdown,
  };
}

function emptyParsedFields() {
  return {
    vesselName: null,
    etaHint: null,
    voyageNo: null,
    agent: null,
    referenceNumber: null,
    documentDate: null,
    shipper: null,
    loadingPort: null,
    surveyor: null,
    destinationText: null,
    freightTerms: null,
    consigneeText: null,
    notifyPartyText: null,
    blSplitText: null,
    billOfLadingClause: null,
    blIndicated: null,
    note: null,
    breakdown: [],
  };
}

async function pdfTextFromBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    return (text || '').trim();
  } finally {
    await parser.destroy();
  }
}

async function imageOcrBuffer(buffer) {
  const worker = await createWorker('eng+ind', undefined, { logger: () => {} });
  try {
    const r = await worker.recognize(buffer);
    return (r?.data?.text || '').trim();
  } finally {
    await worker.terminate();
  }
}

/**
 * @param {Buffer} buffer
 * @param {string} mime from magic bytes
 */
export async function extractRawTextFromBuffer(buffer, mime) {
  if (mime === 'application/pdf') {
    const txt = await pdfTextFromBuffer(buffer);
    if (txt && txt.length >= 20) return txt.slice(0, MAX_TEXT_CHARS);
    return '';
  }
  if (mime.startsWith('image/')) {
    return (await imageOcrBuffer(buffer)).slice(0, MAX_TEXT_CHARS);
  }
  return '';
}

/**
 * @param {Buffer} buffer
 */
export async function runShippingInstructionDocumentExtract(buffer) {
  const ft = await fileTypeFromBuffer(buffer);
  const mime = ft?.mime;
  if (!mime || !SUPPORTED_FOR_EXTRACT.has(mime)) {
    const err = new Error('Unsupported file type for extraction (use PDF or image).');
    err.statusCode = 400;
    throw err;
  }
  let rawText = await extractRawTextFromBuffer(buffer, mime);
  const source = mime === 'application/pdf' ? 'pdf_text' : 'ocr_image';
  if (mime === 'application/pdf' && (!rawText || rawText.length < 12)) {
    const err = new Error(
      'This PDF has very little selectable text (it may be a scan). Upload PNG/JPEG scans or use a text-based PDF.'
    );
    err.statusCode = 422;
    throw err;
  }
  if (!rawText || rawText.length < 4) {
    const err = new Error(
      'Could not read enough text from this file. Try a clearer scan, a PDF with selectable text, or export the document as an image.'
    );
    err.statusCode = 422;
    throw err;
  }
  const fields = parseShippingInstructionText(rawText);
  return {
    mime,
    source,
    rawText: rawText.length > 8000 ? `${rawText.slice(0, 8000)}…` : rawText,
    rawTextTruncated: rawText.length > 8000,
    fields,
  };
}

export { SUPPORTED_FOR_EXTRACT };
