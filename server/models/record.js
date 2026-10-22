/**
 * WA DNR fire-occurrence ESRI record schema.
 *
 * Mirrors the source feature-layer fields. We keep the original field names so
 * callers can POST raw ESRI attribute objects without remapping, and we expose
 * light normalization helpers that turn ESRI's date/time conventions into
 * JS Date objects.
 */

/** Canonical list of fields and their logical types, from the source layer. */
export const FIELDS = {
  OBJECTID: 'oid',
  FIREEVENT_ID: 'integer',
  INCIDENT_NO: 'integer',
  INCIDENT_NM: 'string',
  INCIDENT_ID: 'integer',
  COUNTY_LABEL_NM: 'string',
  FIRE_TWP_WHOLE_NO: 'smallint',
  FIRE_TWP_FRACT_NO: 'smallint',
  FIRE_RGE_WHOLE_NO: 'smallint',
  FIRE_RGE_FRACT_NO: 'smallint',
  FIRE_RGE_DIR_FLG: 'string',
  FIRE_SECT_NO: 'smallint',
  SITE_ELEV: 'smallint',
  FIREGCAUSE_LABEL_NM: 'string',
  FIRESCAUSE_LABEL_NM: 'string',
  BURNESCAPE_RSN_LABEL_NM: 'string',
  ACRES_BURNED: 'double',
  DSCVR_DT: 'date',
  DSCVR_TM: 'string',
  CONTROL_DT: 'date',
  CONTROL_TM: 'string',
  FIRE_OUT_DT: 'date',
  FIRE_OUT_TM: 'string',
  BURN_MERCH_AREA: 'double',
  BURN_REPROD_AREA: 'double',
  BURN_NONSTOCK_AREA: 'double',
  FIREEVNT_CLASS_CD: 'integer',
  FIREEVNT_CLASS_LABEL_NM: 'string',
  SECTION_SUBDIV_PTS_ID: 'integer',
  LAT_COORD: 'double',
  LON_COORD: 'double',
  RES_ORDER_NO: 'string',
  NON_DNR_RES_ORDER_NO: 'string',
  START_OWNER_AGENCY_NM: 'string',
  START_JURISDICTION_AGENCY_NM: 'string',
  PROTECTION_TYPE: 'string',
  REGION_NAME: 'string',
  SHAPE: 'geometry',
  DSCVR_MONTH: 'string',
};

/**
 * ESRI date fields may arrive as epoch milliseconds (feature service JSON),
 * ISO strings, or YYYYMMDD. ESRI time fields are "HHmm" strings. This combines
 * a date field and its matching time string into a single Date (UTC-naive).
 *
 * @param {number|string|null} dateVal
 * @param {string|null} timeVal  e.g. "1345"
 * @returns {Date|null}
 */
export function parseEsriDateTime(dateVal, timeVal) {
  if (dateVal === null || dateVal === undefined || dateVal === '') return null;

  let d;
  if (typeof dateVal === 'number') {
    d = new Date(dateVal); // epoch ms
  } else if (/^\d{8}$/.test(String(dateVal))) {
    const s = String(dateVal);
    d = new Date(
      Date.UTC(
        Number(s.slice(0, 4)),
        Number(s.slice(4, 6)) - 1,
        Number(s.slice(6, 8))
      )
    );
  } else {
    d = new Date(dateVal); // ISO or other parseable
  }
  if (Number.isNaN(d.getTime())) return null;

  if (timeVal != null && /^\d{3,4}$/.test(String(timeVal))) {
    const t = String(timeVal).padStart(4, '0');
    d.setUTCHours(Number(t.slice(0, 2)), Number(t.slice(2, 4)), 0, 0);
  }
  return d;
}

/**
 * Normalize a raw ESRI attribute object into a convenient internal shape while
 * preserving the original fields. Accepts either `{attributes: {...}}`
 * (feature JSON) or a flat attribute object.
 *
 * @param {object} raw
 * @returns {object} normalized record
 */
export function normalizeRecord(raw) {
  const a = raw && raw.attributes ? raw.attributes : raw || {};

  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  const discovered = parseEsriDateTime(a.DSCVR_DT, a.DSCVR_TM);
  const controlled = parseEsriDateTime(a.CONTROL_DT, a.CONTROL_TM);
  const out = parseEsriDateTime(a.FIRE_OUT_DT, a.FIRE_OUT_TM);

  return {
    id: num(a.OBJECTID),
    fireEventId: num(a.FIREEVENT_ID),
    incidentName: a.INCIDENT_NM ?? null,
    county: a.COUNTY_LABEL_NM ?? null,
    region: a.REGION_NAME ?? null,
    elevationFt: num(a.SITE_ELEV),
    generalCause: a.FIREGCAUSE_LABEL_NM ?? null,
    specificCause: a.FIRESCAUSE_LABEL_NM ?? null,
    escapeReason: a.BURNESCAPE_RSN_LABEL_NM ?? null,
    acresBurned: num(a.ACRES_BURNED),
    burnMerchArea: num(a.BURN_MERCH_AREA),
    burnReprodArea: num(a.BURN_REPROD_AREA),
    burnNonstockArea: num(a.BURN_NONSTOCK_AREA),
    eventClassCode: num(a.FIREEVNT_CLASS_CD),
    eventClassLabel: a.FIREEVNT_CLASS_LABEL_NM ?? null,
    lat: num(a.LAT_COORD),
    lon: num(a.LON_COORD),
    ownerAgency: a.START_OWNER_AGENCY_NM ?? null,
    jurisdictionAgency: a.START_JURISDICTION_AGENCY_NM ?? null,
    protectionType: a.PROTECTION_TYPE ?? null,
    discoveryMonth: a.DSCVR_MONTH ?? null,
    discovered,
    controlled,
    out,
    _raw: a,
  };
}

/**
 * Normalize a collection. Accepts an array of records, a `{features: [...]}`
 * feature set, or a `{records: [...]}` wrapper.
 *
 * @param {object|Array} payload
 * @returns {Array<object>}
 */
export function normalizeMany(payload) {
  let list = [];
  if (Array.isArray(payload)) list = payload;
  else if (payload && Array.isArray(payload.features)) list = payload.features;
  else if (payload && Array.isArray(payload.records)) list = payload.records;
  else if (payload && payload.attributes) list = [payload];
  return list.map(normalizeRecord);
}
