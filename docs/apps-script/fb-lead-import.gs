/**
 * Albadi — FB Lead Ads → CRM (Google Apps Script, lives INSIDE the lead sheet)
 *
 * Paste this over the existing script when the Instant Form changes.
 *
 * WHY IT WAS REWRITTEN: the old version addressed columns by fixed position
 * (name = 13, phone = 14, SENT = 19 …, 1-based). Adding a question to the form
 * inserts a column and shifts everything after it — the script would then POST
 * an answer as the phone number, and leads would stop entering WhatsApp with
 * no error anywhere. This version finds every column by its HEADER NAME.
 *
 * The three CRM columns are named on first run (crm_sent / crm_status /
 * crm_sid) and reused by name afterwards, so they can never collide with a
 * new question column either. Existing values are preserved — the script only
 * writes the header text onto the columns already in use.
 *
 * SETUP (once):
 *   Extensions → Apps Script → paste → Save
 *   Project Settings → Script Properties → add  FB_IMPORT_SECRET = <the secret>
 *   Triggers → Add trigger → onNewLead → Time-driven → every 5 minutes
 * Never paste the secret into this file.
 */

var CRM_URL = 'https://albadi-crm.vercel.app/api/leads/facebook-import';

// Header aliases, in priority order. Meta localises these per form language.
var HEADERS = {
  name:  ['full_name', 'שם_מלא', 'שם מלא'],
  phone: ['phone_number', 'phone', 'מספר_טלפון', 'טלפון'],
  email: ['email', 'דוא"ל', 'דואל'],
  leadgen: ['id', 'lead_id'],
  adId: ['ad_id'],
  adName: ['ad_name'],
  campaignId: ['campaign_id'],
  campaignName: ['campaign_name']
};
// Our own columns. Created at the end of the sheet if they don't exist yet.
var CRM_COLS = { sent: 'crm_sent', status: 'crm_status', sid: 'crm_sid' };
// Where those columns historically lived (1-based), for the first run only.
var LEGACY = { sent: 19, status: 20, sid: 21 };

function norm_(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '_');
}

/** 1-based column index for a logical field, or 0 when absent. */
function findCol_(header, aliases) {
  var wanted = aliases.map(norm_);
  for (var i = 0; i < header.length; i++) {
    if (wanted.indexOf(norm_(header[i])) !== -1) return i + 1;
  }
  return 0;
}

/**
 * Locate our three columns by name; on the first run, label the legacy ones so
 * their existing SENT markers keep counting. Only ever appends if the legacy
 * position is already occupied by a form question.
 */
function crmCols_(sheet, header) {
  var out = {};
  var keys = ['sent', 'status', 'sid'];
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var col = findCol_(header, [CRM_COLS[key]]);
    if (!col) {
      var legacy = LEGACY[key];
      var legacyHeader = norm_(header[legacy - 1]);
      // Free (blank header) → adopt it, so existing SENT values still apply.
      if (!legacyHeader) {
        col = legacy;
      } else {
        col = header.length + 1;
        header.push(CRM_COLS[key]);
      }
      sheet.getRange(1, col).setValue(CRM_COLS[key]);
    }
    out[key] = col;
  }
  return out;
}

/**
 * "p:+9725…" / "0501234567" / "050-123-4567" → "+9725…", or '' when unusable.
 *
 * Kept from Eli's version, including the guard below: a 9-digit local number
 * with no leading zero normalises to "+501234567", which LOOKS like E.164 and
 * is a different country. The length test is what catches it, so both halves
 * must stay together.
 */
function fixPhone_(raw) {
  var phone = String(raw == null ? '' : raw).replace(/^p:/i, '').trim();
  var hasPlus = phone.charAt(0) === '+';
  phone = phone.replace(/[^\d]/g, '');
  if (!phone) return '';
  if (phone.charAt(0) === '0' && phone.length === 10) return '+972' + phone.substring(1);
  if (hasPlus) return '+' + phone;
  return '+' + phone;
}

/** Plausible E.164 only: '+' then 10-15 digits, and never a '+0' country. */
function phoneLooksValid_(p) {
  return /^\+\d{10,15}$/.test(p) && p.indexOf('+0') !== 0;
}

function onNewLead() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;

  var header = values[0].slice();
  var col = {
    name: findCol_(header, HEADERS.name),
    phone: findCol_(header, HEADERS.phone),
    email: findCol_(header, HEADERS.email),
    leadgen: findCol_(header, HEADERS.leadgen),
    adId: findCol_(header, HEADERS.adId),
    adName: findCol_(header, HEADERS.adName),
    campaignId: findCol_(header, HEADERS.campaignId),
    campaignName: findCol_(header, HEADERS.campaignName)
  };
  // Refuse to guess. A missing phone column means the form changed in a way
  // this script doesn't understand — better to stop loudly than to POST an
  // answer as a phone number and corrupt the CRM.
  if (!col.phone || !col.name) {
    throw new Error('Cannot find the name/phone columns by header — check the sheet headers.');
  }
  var crm = crmCols_(sheet, header);

  var secret = PropertiesService.getScriptProperties().getProperty('FB_IMPORT_SECRET');
  if (!secret) throw new Error('FB_IMPORT_SECRET is not set in Script Properties.');

  var get = function (row, c) { return c ? String(row[c - 1] == null ? '' : row[c - 1]).trim() : ''; };

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var rowNum = i + 1;

    if (get(row, crm.sent)) continue;                       // already processed
    var rawPhone = get(row, col.phone);
    var name = get(row, col.name);
    // Same three skips as the previous script, in the same order: no phone,
    // Meta's own test row, no name. A nameless row is left untouched and
    // unmarked so it can be fixed by hand and picked up on the next run.
    if (!rawPhone) continue;
    if (rawPhone.toLowerCase().indexOf('test lead') !== -1) continue;
    if (!name) continue;

    var phone = fixPhone_(rawPhone);
    if (!phoneLooksValid_(phone)) {
      // Status but NOT the SENT marker — a hand-fixed phone retries next run.
      sheet.getRange(rowNum, crm.status).setValue('BAD_PHONE: ' + phone);
      Logger.log('BAD_PHONE: ' + name + ' | raw=' + rawPhone + ' | normalized=' + phone);
      continue;
    }

    var payload = {
      phone: phone,
      fullName: name,
      email: get(row, col.email),
      leadgenId: get(row, col.leadgen).replace(/^\s*l:/i, ''),
      adId: get(row, col.adId),
      adName: get(row, col.adName),
      campaignId: get(row, col.campaignId),
      campaignName: get(row, col.campaignName)
    };

    var status, sid = '';
    try {
      var resp = UrlFetchApp.fetch(CRM_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + secret },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      var body = {};
      try { body = JSON.parse(resp.getContentText()); } catch (e) {}
      if (code >= 200 && code < 300) {
        status = body.status || 'sent';
        sid = body.sid || '';
      } else if (body && body.status) {
        status = body.status;
        sid = body.sid || '';
      } else {
        // Keep the CRM's error text — it is what makes a failed row triageable.
        status = 'http_' + code + '_' + ((body && body.error) || 'unknown');
      }
    } catch (err) {
      status = 'exception_' + String(err).substring(0, 60);
    }

    sheet.getRange(rowNum, crm.status).setValue(status);
    if (sid) sheet.getRange(rowNum, crm.sid).setValue(sid);
    // SENT gates re-processing. A created-but-unsent lead is NOT marked, so a
    // retry can finish the job; a bad phone isn't marked either.
    if (status === 'sent' || status === 'tagged_only') {
      sheet.getRange(rowNum, crm.sent).setValue('SENT');
      Logger.log(status + ': ' + name + ' | ' + phone);
    } else {
      // lead_created_send_failed → the lead exists but the opening didn't go
      // out. Deliberately NOT marked SENT, so the row stays a retry candidate.
      Logger.log('FAILED: ' + name + ' | ' + phone + ' | ' + status);
    }
    Utilities.sleep(500);
  }
}

/** Manual entry point — same pass, run by hand over the whole sheet. */
function importAllExistingLeads() {
  onNewLead();
}
