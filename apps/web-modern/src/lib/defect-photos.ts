/**
 * Helpers de fotos para defectos:
 *  - resizeImage(file, maxPx, quality) — compresión genérica vía canvas
 *  - toBase64DataUrl(file) — base64 para mandar a la IA
 *  - analyzePhotoForDefect(file) — manda foto a /analyze-photo y devuelve descripción
 *  - uploadDefectPhoto(defectId, file) — comprime y sube a /attachments/upload
 *  - listDefectPhotos(defectId) — lista del backend
 *
 * Compresión:
 *  - Para análisis IA: 1920px máx, calidad 0.9 (alta).
 *  - Para storage: 1280px máx, calidad 0.75 (idéntico a ProgressNoteSheet).
 */

import { api } from "./api";

const ANALYSIS_MAX = 1920;
const ANALYSIS_QUALITY = 0.9;
const STORAGE_MAX = 1280;
const STORAGE_QUALITY = 0.75;

async function resizeImage(file: File, maxPx: number, quality: number): Promise<File> {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxPx || h > maxPx) {
        if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) { resolve(file); return; }
        const name = file.name.replace(/\.[^.]+$/, ".jpg");
        resolve(new File([blob], name, { type: "image/jpeg" }));
      }, "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

export interface AnalyzePhotoInput {
  file: File;
  existingDescription?: string;
  assetLabel?: string | null;
}

/**
 * Analiza una foto con IA visión ANTES de comprimirla al tamaño de storage.
 * Internamente reduce a 1920px alta calidad para no enviar imágenes enormes
 * (Claude Vision tiene límite de ~5MB), pero esto es más resolución que la
 * versión final que se guarda.
 */
export async function analyzePhotoForDefect(input: AnalyzePhotoInput): Promise<{ text: string }> {
  const resized = await resizeImage(input.file, ANALYSIS_MAX, ANALYSIS_QUALITY);
  const dataUrl = await fileToBase64(resized);
  return api.post<{ text: string }>("/app/pms/defects/analyze-photo", {
    imageBase64: dataUrl,
    existingDescription: input.existingDescription,
    assetLabel: input.assetLabel,
  });
}

/**
 * Sube la foto al endpoint genérico de attachments después de comprimirla a
 * la resolución de storage. El backend crea el registro Attachment con
 * targetType=DEFECT cuando recibe entityType=Defect+entityId, así después se
 * puede listar.
 */
export async function uploadDefectPhoto(defectId: string, file: File): Promise<{ url: string; name: string; attachmentId: string | null }> {
  const compressed = await resizeImage(file, STORAGE_MAX, STORAGE_QUALITY);
  return api.upload<{ url: string; name: string; attachmentId: string | null }>(
    `/app/attachments/upload?entityType=Defect&entityId=${defectId}`,
    compressed,
  );
}

export interface DefectPhotoRecord {
  id: string;
  filename: string;
  description: string | null; // backend usa este campo para guardar la URL
  uploadedAt: string;
  mimeType: string;
}

export async function listDefectPhotos(defectId: string): Promise<DefectPhotoRecord[]> {
  const res = await api.get<{ items: DefectPhotoRecord[] }>(
    `/app/attachments?targetType=DEFECT&targetId=${encodeURIComponent(defectId)}`,
  );
  return res.items ?? [];
}

export async function deleteDefectPhoto(attachmentId: string): Promise<void> {
  await api.delete(`/app/attachments/${attachmentId}`);
}
