/**
 * CMS3 — Archivo de PDFs en Google Drive.
 *
 * Se pega en script.google.com con la cuenta dueña de la carpeta (ver GUIA.md).
 * Recibe los PDF que manda CMS3 y los guarda así:
 *   <CARPETA RAÍZ>/<tipo>/Borrador/<código>.pdf   mientras el documento está abierto
 *   <CARPETA RAÍZ>/<tipo>/<código>.pdf            cuando queda cerrado/aprobado
 *
 * Sólo hay que completar las dos líneas de abajo.
 */

// ID de la carpeta raíz: lo que sigue a /folders/ en el enlace de Drive.
const ROOT_FOLDER_ID = 'PEGAR_ACA_EL_ID_DE_LA_CARPETA';

// Clave que muestra CMS3 en Configuración → Archivo de PDFs en Google Drive.
const SECRET = 'PEGAR_ACA_LA_CLAVE_DE_CMS3';

const DRAFT_FOLDER = 'Borrador';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!req || req.secret !== SECRET) return reply({ ok: false, error: 'clave incorrecta' });

    const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    if (req.action === 'ping') return reply({ ok: true, folder: root.getName() });
    if (req.action !== 'upload') return reply({ ok: false, error: 'acción desconocida' });

    const fileName = String(req.fileName || '').trim();
    const folderName = String(req.folder || '').trim();
    if (!fileName || !folderName || !req.base64) return reply({ ok: false, error: 'faltan datos' });

    const typeFolder = childFolder(root, folderName);
    const target = req.final ? typeFolder : childFolder(typeFolder, DRAFT_FOLDER);

    trashByName(target, fileName);
    const blob = Utilities.newBlob(Utilities.base64Decode(req.base64), 'application/pdf', fileName);
    const file = target.createFile(blob);

    // Quedó el registro final: el borrador ya no hace falta.
    if (req.final) {
      const drafts = typeFolder.getFoldersByName(DRAFT_FOLDER);
      if (drafts.hasNext()) trashByName(drafts.next(), fileName);
    }
    return reply({ ok: true, fileId: file.getId() });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

function childFolder(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function trashByName(folder, name) {
  const files = folder.getFilesByName(name);
  while (files.hasNext()) files.next().setTrashed(true);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
