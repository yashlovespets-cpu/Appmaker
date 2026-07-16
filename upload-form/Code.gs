/**
 * Appmaker Image Intake — Google Apps Script backend.
 *
 * Stores uploaded images in a Drive folder and their metadata (Page ID,
 * Block Label, etc.) in a companion Spreadsheet, so uploads are shared
 * across every browser that hits the deployed web app URL instead of
 * living in one browser's local storage.
 */

const FOLDER_NAME = 'Appmaker Uploads';
const SHEET_NAME = 'Uploads';
const PROP_FOLDER_ID = 'UPLOAD_FOLDER_ID';
const PROP_SHEET_ID = 'UPLOAD_SHEET_ID';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB
const HEADERS = ['id', 'pageId', 'blockLabel', 'fileName', 'mimeType', 'byteLength', 'driveFileId', 'createdAt', 'uploadedBy'];

function doGet(e) {
  const params = (e && e.parameter) || {};
  const template = HtmlService.createTemplateFromFile('Index');
  template.initialPageIdJson = safeJson_(params.pageId || '');
  template.initialBlockLabelJson = safeJson_(params.blockLabel || '');
  return template.evaluate()
    .setTitle('Appmaker Image Intake')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** JSON-encode a value for safe embedding inside an inline <script> block. */
function safeJson_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function getUploadFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(PROP_FOLDER_ID);
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (err) {
      // Stored id no longer resolves; fall through and recreate below.
    }
  }
  const existing = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty(PROP_FOLDER_ID, folder.getId());
  return folder;
}

function getSheet_() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty(PROP_SHEET_ID);
  let ss = null;
  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (err) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(FOLDER_NAME + ' Data');
    const file = DriveApp.getFileById(ss.getId());
    getUploadFolder_().addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    props.setProperty(PROP_SHEET_ID, ss.getId());
  }
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

/**
 * Called from the client via google.script.run to store a new upload.
 * payload: { pageId, blockLabel, fileName, mimeType, base64Data }
 */
function submitUpload(payload) {
  const pageId = String((payload && payload.pageId) || '').trim();
  const blockLabel = String((payload && payload.blockLabel) || '').trim();
  const fileName = String((payload && payload.fileName) || 'upload').trim();
  const mimeType = String((payload && payload.mimeType) || 'application/octet-stream');
  const base64Data = payload && payload.base64Data;

  if (!pageId || !blockLabel || !base64Data) {
    throw new Error('pageId, blockLabel, and an image file are all required.');
  }

  const bytes = Utilities.base64Decode(base64Data);
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large (max ' + (MAX_IMAGE_BYTES / (1024 * 1024)) + 'MB).');
  }

  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = getUploadFolder_().createFile(blob);

  const id = Utilities.getUuid();
  const createdAt = new Date().toISOString();
  const uploadedBy = Session.getActiveUser().getEmail() || 'unknown';

  getSheet_().appendRow([id, pageId, blockLabel, fileName, mimeType, bytes.length, file.getId(), createdAt, uploadedBy]);

  return {
    id: id,
    pageId: pageId,
    blockLabel: blockLabel,
    fileName: fileName,
    mimeType: mimeType,
    byteLength: bytes.length,
    createdAt: createdAt,
    uploadedBy: uploadedBy,
    imageDataUrl: 'data:' + mimeType + ';base64,' + base64Data,
  };
}

function rowsToRecords_(values) {
  const headers = values[0];
  const idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });
  return values.slice(1).map(function (row) {
    return {
      id: row[idx.id],
      pageId: row[idx.pageId],
      blockLabel: row[idx.blockLabel],
      fileName: row[idx.fileName],
      mimeType: row[idx.mimeType],
      byteLength: row[idx.byteLength],
      driveFileId: row[idx.driveFileId],
      createdAt: row[idx.createdAt],
      uploadedBy: row[idx.uploadedBy],
    };
  });
}

/**
 * Called from the client via google.script.run to list uploads, optionally
 * filtered by (substring, case-insensitive) pageId / blockLabel.
 * filter: { pageId, blockLabel, limit }
 */
function listUploads(filter) {
  filter = filter || {};
  const pageIdFilter = String(filter.pageId || '').trim().toLowerCase();
  const blockLabelFilter = String(filter.blockLabel || '').trim().toLowerCase();
  const limit = Number(filter.limit) > 0 ? Number(filter.limit) : 100;

  const values = getSheet_().getDataRange().getValues();
  if (values.length <= 1) return [];

  let records = rowsToRecords_(values);
  records = records.filter(function (r) {
    if (pageIdFilter && String(r.pageId).toLowerCase().indexOf(pageIdFilter) === -1) return false;
    if (blockLabelFilter && String(r.blockLabel).toLowerCase().indexOf(blockLabelFilter) === -1) return false;
    return true;
  });
  records.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  records = records.slice(0, limit);

  return records.map(function (r) {
    let imageDataUrl = null;
    try {
      const bytes = DriveApp.getFileById(r.driveFileId).getBlob().getBytes();
      imageDataUrl = 'data:' + r.mimeType + ';base64,' + Utilities.base64Encode(bytes);
    } catch (err) {
      imageDataUrl = null; // underlying Drive file was removed out-of-band
    }
    r.imageDataUrl = imageDataUrl;
    return r;
  });
}

/** Called from the client via google.script.run to delete one upload. */
function deleteUpload(id) {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('id');
  const fileIdCol = headers.indexOf('driveFileId');

  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] === id) {
      const driveFileId = values[i][fileIdCol];
      try {
        DriveApp.getFileById(driveFileId).setTrashed(true);
      } catch (err) {
        // Drive file already gone; still remove the metadata row.
      }
      sheet.deleteRow(i + 1);
      return { deleted: true };
    }
  }
  return { deleted: false };
}
