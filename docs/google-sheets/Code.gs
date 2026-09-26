/**
 * OmniSuite waitlist — Google Sheets receiver for MARY
 * =====================================================
 * Paste this whole file into Extensions → Apps Script of the Google Sheet that
 * should hold the waitlist, then deploy it as a Web app (see README.md).
 *
 * What it does
 *   • Waitlist tab   — one row per conversation, updated in place while the
 *                      conversation runs (session id = row key). Hands out the
 *                      real waitlist position when someone actually joins.
 *   • Experience tab — MARY's own field notes after each conversation. The app
 *                      reads these back so she improves across every visitor.
 *   • Activity tab   — a short log of every request, handy when debugging.
 *
 * Endpoints (all answer JSON)
 *   POST { action: "lead", ...fields }        upsert a conversation row
 *   POST { action: "experience", lessons }    append field notes
 *   GET  ?action=ping                         health + counts
 *   GET  ?action=experience&limit=400         recent field notes
 *
 * Optional: a confirmation email to the visitor the first time their row lands
 * on the waitlist. Off unless the script property CONFIRMATION_EMAIL is "on"
 * (Project Settings → Script properties). See README.md, "Confirmation email".
 */

// ---------------------------------------------------------------------------
// Settings you may change
// ---------------------------------------------------------------------------

/** Optional shared password. If set, it must match SHEETS_WEBAPP_SECRET in Lovable. */
var SHARED_SECRET = "";

/** The first waitlist position handed out (e.g. 1, or 101 if you seeded earlier sign-ups). */
var POSITION_START = 1;

/** Leave empty for the sheet this script is attached to; or paste a spreadsheet id. */
var SPREADSHEET_ID = "";

// ---------------------------------------------------------------------------
// Internals — no changes needed below
// ---------------------------------------------------------------------------

var VERSION = "2026-09-26";

var TABS = { leads: "Waitlist", experience: "Experience", activity: "Activity" };

/**
 * Script properties that switch the confirmation email on and shape it.
 * Set them under Project Settings → Script properties; none is required.
 */
var EMAIL_PROPS = {
  enabled: "CONFIRMATION_EMAIL", // "on" to send; anything else (or unset) sends nothing
  subject: "CONFIRMATION_SUBJECT", // optional; default below
  replyTo: "CONFIRMATION_REPLY_TO", // optional; where a visitor's reply should go
  fromName: "CONFIRMATION_FROM_NAME", // optional; the sender name shown in the inbox
};
var EMAIL_DEFAULT_SUBJECT = "You're on the OmniSuite early-access list";
var EMAIL_DEFAULT_FROM_NAME = "MARY at Omnikom";
/** Confirmations sent per row at most: the first address, plus one corrected address. */
var EMAIL_MAX_PER_ROW = 2;

var LEAD_COLUMNS = [
  "First seen",
  "Last updated",
  "Session",
  "Status",
  "Position",
  "Name",
  "Email",
  "Phone",
  "Business",
  "Industry",
  "Operations",
  "Callback requested",
  "How it ended",
  "Summary",
  "Objections",
  "What worked",
  "What stalled",
  "Mood",
  "Channel",
  "Turns",
  "Duration",
  "Started",
  "Language",
  "Timezone",
  "Page",
  "Referrer",
  "Device",
  "Transcript",
  "Confirmation sent",
];

var EXPERIENCE_COLUMNS = [
  "Written",
  "Session",
  "Category",
  "Lesson",
  "Evidence",
  "Industry",
  "Outcome",
  "Confidence",
];

var ACTIVITY_COLUMNS = ["Time", "Action", "Session", "Detail"];

/** Human-readable status per outcome, and how "final" it is (higher never gets overwritten by lower). */
var STATUS = {
  in_progress: { label: "In progress", rank: 0, ended: "" },
  abandoned: { label: "Left mid-conversation", rank: 0, ended: "Left before the end" },
  declined: { label: "Declined", rank: 2, ended: "Declined — MARY let them go" },
  callback: { label: "Callback requested", rank: 3, ended: "Asked to be called back" },
  signed_up: { label: "On the waitlist", rank: 3, ended: "MARY closed the sign-up" },
};

var CELL_LIMIT = 49000; // Google Sheets caps a cell at 50,000 characters.

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!authorized(params.secret)) return json({ ok: false, error: "unauthorized" });
  try {
    var action = params.action || "ping";
    if (action === "ping") return json(ping());
    if (action === "experience") return json({ ok: true, lessons: readLessons(Number(params.limit) || 400) });
    if (action === "stats") return json(ping());
    return json({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json({ ok: false, error: "body is not JSON" });
  }
  if (!authorized(body.secret)) return json({ ok: false, error: "unauthorized" });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json({ ok: false, error: "busy — try again" });
  }
  try {
    var action = body.action || "lead";
    if (action === "lead") return json(upsertLead(body));
    if (action === "experience") return json(appendLessons(body));
    return json({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    logActivity("error", body && body.sessionId, String(err && err.message ? err.message : err));
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function ping() {
  var leads = ensureSheet(TABS.leads, LEAD_COLUMNS);
  var experience = ensureSheet(TABS.experience, EXPERIENCE_COLUMNS);
  return {
    ok: true,
    version: VERSION,
    leads: Math.max(0, leads.getLastRow() - 1),
    lessons: Math.max(0, experience.getLastRow() - 1),
    positionStart: POSITION_START,
    confirmationEmail: confirmationEnabled(),
  };
}

/**
 * One row per session. Non-empty incoming values overwrite; empty ones never
 * blank an existing cell. Status only moves "forward" (a finished conversation
 * is never downgraded by a late checkpoint). Position is handed out once, the
 * first time the status becomes a real place on the list.
 */
function upsertLead(body) {
  var sheet = ensureSheet(TABS.leads, LEAD_COLUMNS);
  var col = columnIndex(sheet, LEAD_COLUMNS);
  var sessionId = String(body.sessionId || "").trim();
  if (!sessionId) return { ok: false, error: "sessionId is required" };

  var now = new Date();
  var rowNumber = findRowBySession(sheet, col["Session"], sessionId);
  var existing = rowNumber ? sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0] : null;
  var row = existing ? existing.slice() : blankRow(sheet.getLastColumn());

  var incomingOutcome = body.outcome && STATUS[body.outcome] ? body.outcome : null;
  var currentStatusLabel = existing ? String(row[col["Status"] - 1] || "") : "";
  var currentRank = rankOfLabel(currentStatusLabel);
  var applyStatus = incomingOutcome && (!existing || STATUS[incomingOutcome].rank >= currentRank);

  if (!existing) row[col["First seen"] - 1] = now;
  row[col["Last updated"] - 1] = now;
  row[col["Session"] - 1] = sessionId;

  if (applyStatus) {
    row[col["Status"] - 1] = STATUS[incomingOutcome].label;
    if (STATUS[incomingOutcome].ended) row[col["How it ended"] - 1] = STATUS[incomingOutcome].ended;
    else if (incomingOutcome === "in_progress") row[col["How it ended"] - 1] = "";
  }

  // Plain text fields: overwrite only with something.
  setIf(row, col, "Name", body.name);
  setIf(row, col, "Email", body.email);
  setIf(row, col, "Phone", body.phone);
  setIf(row, col, "Business", body.business);
  setIf(row, col, "Industry", body.industry);
  setIf(row, col, "Operations", body.operations);
  setIf(row, col, "Summary", body.summary);
  setIf(row, col, "Objections", body.objections);
  setIf(row, col, "What worked", body.whatWorked);
  setIf(row, col, "What stalled", body.whatStalled);
  setIf(row, col, "Mood", body.mode);
  setIf(row, col, "Channel", channelLabel(body.source));
  setIf(row, col, "Language", body.language);
  setIf(row, col, "Timezone", body.timezone);
  setIf(row, col, "Page", body.page);
  setIf(row, col, "Referrer", body.referrer);
  setIf(row, col, "Device", body.userAgent);
  setIf(row, col, "Started", body.startedAt ? new Date(body.startedAt) : "");
  if (typeof body.turns === "number" && body.turns > 0) row[col["Turns"] - 1] = body.turns;
  if (typeof body.durationSec === "number" && body.durationSec > 0)
    row[col["Duration"] - 1] = formatDuration(body.durationSec);
  if (typeof body.callbackRequested === "boolean" && (body.callbackRequested || !existing))
    row[col["Callback requested"] - 1] = body.callbackRequested ? "Yes" : "No";
  if (body.transcript) row[col["Transcript"] - 1] = String(body.transcript).slice(0, CELL_LIMIT);

  // A real place on the list, handed out once.
  var position = row[col["Position"] - 1];
  var onList = applyStatus && (incomingOutcome === "signed_up" || incomingOutcome === "callback");
  if (onList && !(typeof position === "number" && position > 0)) {
    position = nextPosition(sheet, col["Position"]);
    row[col["Position"] - 1] = position;
  }

  // The row is written first: an email problem must never cost the lead.
  var emailed = false;
  if (String(row[col["Status"] - 1] || "") === STATUS.signed_up.label) {
    emailed = sendConfirmation(row, col, position);
  }

  if (existing) {
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    rowNumber = sheet.getLastRow();
  }

  logActivity(
    "lead",
    sessionId,
    (applyStatus ? STATUS[incomingOutcome].label : "update") +
      (position ? " · #" + position : "") +
      (emailed ? " · emailed" : "")
  );
  return {
    ok: true,
    row: rowNumber,
    status: String(row[col["Status"] - 1] || ""),
    position: typeof position === "number" && position > 0 ? position : null,
    emailed: emailed,
  };
}

// ---------------------------------------------------------------------------
// Confirmation email (optional)
// ---------------------------------------------------------------------------

function scriptProperty(name) {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(name) || "").trim();
  } catch (err) {
    return "";
  }
}

function confirmationEnabled() {
  var value = scriptProperty(EMAIL_PROPS.enabled).toLowerCase();
  return value === "on" || value === "true" || value === "yes" || value === "1";
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
}

/**
 * Sends the confirmation once per address, to at most two addresses per row
 * (the one first heard, and one correction). The "Confirmation sent" cell keeps
 * "address @ time" per send, so a replayed row never mails twice. Returns
 * whether a mail went out on this call; never throws.
 */
function sendConfirmation(row, col, position) {
  if (!confirmationEnabled()) return false;
  var email = String(row[col["Email"] - 1] || "").trim();
  if (!looksLikeEmail(email)) return false;
  var sentCell = String(row[col["Confirmation sent"] - 1] || "");
  var sent = sentCell ? sentCell.split("\n").filter(function (line) { return line.trim() !== ""; }) : [];
  if (sent.length >= EMAIL_MAX_PER_ROW) return false;
  for (var i = 0; i < sent.length; i++) {
    if (sent[i].toLowerCase().indexOf(email.toLowerCase()) === 0) return false;
  }
  try {
    var message = {
      to: email,
      subject: scriptProperty(EMAIL_PROPS.subject) || EMAIL_DEFAULT_SUBJECT,
      body: confirmationBody(row, col, position),
      name: scriptProperty(EMAIL_PROPS.fromName) || EMAIL_DEFAULT_FROM_NAME,
    };
    var replyTo = scriptProperty(EMAIL_PROPS.replyTo);
    if (replyTo) message.replyTo = replyTo;
    MailApp.sendEmail(message);
    sent.push(email + " @ " + new Date().toISOString());
    row[col["Confirmation sent"] - 1] = sent.join("\n");
    return true;
  } catch (err) {
    logActivity("email-failed", row[col["Session"] - 1], String(err && err.message ? err.message : err));
    return false;
  }
}

/** Plain text, plain promises: only what the sheet actually holds. */
function confirmationBody(row, col, position) {
  var name = String(row[col["Name"] - 1] || "").trim();
  var first = name.split(/\s+/)[0] || "";
  var lines = [];
  lines.push("Hi" + (first ? " " + first : "") + ",");
  lines.push("");
  lines.push(
    "You're on the OmniSuite early-access list" +
      (typeof position === "number" && position > 0 ? " — position #" + position + "." : ".")
  );
  lines.push("We'll write to this address the moment early access opens. Nothing to do until then.");
  lines.push("");
  lines.push("Here's what MARY noted:");
  var fields = [
    ["Name", name],
    ["Email", String(row[col["Email"] - 1] || "")],
    ["Phone", String(row[col["Phone"] - 1] || "")],
    ["Business", String(row[col["Business"] - 1] || "")],
    ["Industry", String(row[col["Industry"] - 1] || "")],
  ];
  for (var i = 0; i < fields.length; i++) {
    if (String(fields[i][1]).trim()) lines.push("  " + fields[i][0] + ": " + String(fields[i][1]).trim());
  }
  lines.push("");
  lines.push("If anything above is wrong, reply to this email and we'll fix it.");
  lines.push("");
  lines.push("— The Omnikom team");
  lines.push("OmniSuite · AI + human revenue infrastructure · a product by Omnikom");
  return lines.join("\n");
}

/** Field notes MARY wrote after a conversation. */
function appendLessons(body) {
  var sheet = ensureSheet(TABS.experience, EXPERIENCE_COLUMNS);
  var lessons = Array.isArray(body.lessons) ? body.lessons : [];
  var now = new Date();
  var rows = [];
  for (var i = 0; i < lessons.length; i++) {
    var lesson = lessons[i] || {};
    var text = String(lesson.lesson || "").trim();
    if (!text) continue;
    rows.push([
      now,
      String(body.sessionId || ""),
      String(lesson.category || "discovery"),
      text.slice(0, 500),
      String(lesson.evidence || "").slice(0, 300),
      String(lesson.industry || ""),
      String(lesson.outcome || ""),
      Number(lesson.confidence) || 3,
    ]);
  }
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, EXPERIENCE_COLUMNS.length).setValues(rows);
  }
  logActivity("experience", body.sessionId, rows.length + " lesson(s)");
  return { ok: true, added: rows.length };
}

/** The most recent field notes, newest last, as objects the app understands. */
function readLessons(limit) {
  var sheet = ensureSheet(TABS.experience, EXPERIENCE_COLUMNS);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var count = Math.min(Math.max(1, limit || 400), last - 1);
  var values = sheet.getRange(last - count + 1, 1, count, EXPERIENCE_COLUMNS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (!v[3]) continue;
    out.push({
      at: v[0] instanceof Date ? v[0].toISOString() : String(v[0] || ""),
      session: String(v[1] || ""),
      category: String(v[2] || "discovery"),
      lesson: String(v[3]),
      evidence: v[4] ? String(v[4]) : null,
      industry: v[5] ? String(v[5]) : null,
      outcome: String(v[6] || ""),
      confidence: Number(v[7]) || 3,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spreadsheet() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Creates the tab with its header row if missing; appends any new columns on upgrade. */
function ensureSheet(name, columns) {
  var ss = spreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, columns.length).setFontWeight("bold");
    return sheet;
  }
  var lastCol = Math.max(1, sheet.getLastColumn());
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var missing = [];
  for (var i = 0; i < columns.length; i++) {
    if (header.indexOf(columns[i]) === -1) missing.push(columns[i]);
  }
  if (missing.length) {
    var start = header.filter(function (h) { return h !== ""; }).length + 1;
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
    sheet.getRange(1, start, 1, missing.length).setFontWeight("bold");
  }
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  return sheet;
}

/** Column name → 1-based index, read from the live header so reordering is safe. */
function columnIndex(sheet, columns) {
  var header = sheet.getRange(1, 1, 1, Math.max(columns.length, sheet.getLastColumn())).getValues()[0];
  var map = {};
  for (var i = 0; i < header.length; i++) {
    if (header[i] !== "") map[header[i]] = i + 1;
  }
  for (var j = 0; j < columns.length; j++) {
    if (!map[columns[j]]) throw new Error("Column missing: " + columns[j] + " — run setup()");
  }
  return map;
}

function findRowBySession(sheet, sessionCol, sessionId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var values = sheet.getRange(2, sessionCol, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === sessionId) return i + 2;
  }
  return 0;
}

function nextPosition(sheet, positionCol) {
  var last = sheet.getLastRow();
  var max = POSITION_START - 1;
  if (last >= 2) {
    var values = sheet.getRange(2, positionCol, last - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      var n = Number(values[i][0]);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

function blankRow(width) {
  var row = [];
  for (var i = 0; i < Math.max(width, LEAD_COLUMNS.length); i++) row.push("");
  return row;
}

function setIf(row, col, name, value) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim() === "") return;
  if (value === "") return;
  row[col[name] - 1] = typeof value === "string" ? value.slice(0, CELL_LIMIT) : value;
}

function rankOfLabel(label) {
  for (var key in STATUS) {
    if (STATUS[key].label === label) return STATUS[key].rank;
  }
  return -1;
}

function channelLabel(source) {
  if (source === "voice") return "Voice";
  if (source === "text") return "Typed";
  if (source === "mixed") return "Voice + typed";
  return "";
}

function formatDuration(seconds) {
  var s = Math.max(0, Math.round(seconds));
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ":" + (r < 10 ? "0" : "") + r;
}

function authorized(secret) {
  if (!SHARED_SECRET) return true;
  return String(secret || "") === SHARED_SECRET;
}

function logActivity(action, sessionId, detail) {
  try {
    var sheet = ensureSheet(TABS.activity, ACTIVITY_COLUMNS);
    sheet.appendRow([new Date(), action, String(sessionId || ""), String(detail || "").slice(0, 500)]);
    // Keep the log short: trim to the latest 2,000 lines.
    var extra = sheet.getLastRow() - 1 - 2000;
    if (extra > 0) sheet.deleteRows(2, extra);
  } catch (err) {
    // Logging must never break a save.
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Run these once from the editor (Run ▸ select function ▸ Run)
// ---------------------------------------------------------------------------

/** Creates the three tabs with their headers. Safe to run again at any time. */
function setup() {
  var leads = ensureSheet(TABS.leads, LEAD_COLUMNS);
  ensureSheet(TABS.experience, EXPERIENCE_COLUMNS);
  ensureSheet(TABS.activity, ACTIVITY_COLUMNS);
  var col = columnIndex(leads, LEAD_COLUMNS);
  leads.setColumnWidth(col["Transcript"], 420);
  leads.setColumnWidth(col["Summary"], 320);
  leads.setColumnWidth(col["Operations"], 260);
  leads
    .getRange(2, col["Transcript"], Math.max(1, leads.getMaxRows() - 1), 1)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  Logger.log("Ready. Tabs: " + TABS.leads + ", " + TABS.experience + ", " + TABS.activity);
}

/** Writes a sample conversation so you can see a row appear, then reports the result. */
function selfTest() {
  var id = "test_" + new Date().getTime();
  var first = upsertLead({
    sessionId: id,
    outcome: "in_progress",
    name: "Test Person",
    business: "Sample Realty",
    industry: "Real estate",
    transcript: "MARY: Hi there.\nGuest: Hello, testing.",
    turns: 1,
    durationSec: 20,
    source: "text",
  });
  var second = upsertLead({
    sessionId: id,
    outcome: "signed_up",
    email: "test@example.com",
    operations: "Two agents, follow-ups by hand",
    transcript: "MARY: Hi there.\nGuest: Hello, testing.\nMARY: Thanks for signing up.",
    turns: 3,
    durationSec: 95,
    source: "text",
  });
  appendLessons({
    sessionId: id,
    lessons: [
      {
        category: "opening",
        lesson: "Self-test lesson — safe to delete.",
        evidence: "testing",
        industry: null,
        outcome: "signed_up",
        confidence: 1,
      },
    ],
  });
  Logger.log(JSON.stringify({ first: first, second: second, ping: ping() }));
}

/**
 * Sends the confirmation template to yourself, so you can read it and grant the
 * script permission to send mail. Run this once before switching
 * CONFIRMATION_EMAIL on (see README.md). It writes nothing to the sheet.
 */
function testConfirmationEmail() {
  var me = Session.getEffectiveUser().getEmail();
  var leads = ensureSheet(TABS.leads, LEAD_COLUMNS);
  var col = columnIndex(leads, LEAD_COLUMNS);
  var row = blankRow(leads.getLastColumn());
  row[col["Session"] - 1] = "test_email";
  row[col["Name"] - 1] = "Test Person";
  row[col["Email"] - 1] = me;
  row[col["Business"] - 1] = "Sample Realty";
  row[col["Industry"] - 1] = "Real estate";
  var message = {
    to: me,
    subject: scriptProperty(EMAIL_PROPS.subject) || EMAIL_DEFAULT_SUBJECT,
    body: confirmationBody(row, col, POSITION_START),
    name: scriptProperty(EMAIL_PROPS.fromName) || EMAIL_DEFAULT_FROM_NAME,
  };
  var replyTo = scriptProperty(EMAIL_PROPS.replyTo);
  if (replyTo) message.replyTo = replyTo;
  MailApp.sendEmail(message);
  Logger.log(
    "Sent to " + me + ". CONFIRMATION_EMAIL is " + (confirmationEnabled() ? "on" : "off") +
      "; remaining daily quota: " + MailApp.getRemainingDailyQuota()
  );
}
