// Cliente mínimo de Google Drive para el archivo automático de PDFs.
//
// El admin de la empresa conecta su cuenta con un botón (OAuth). Pedimos el
// permiso `drive.file`: la app sólo ve y toca lo que ella misma crea. Es un
// permiso "no sensible", así que Google no exige verificación ni muestra la
// pantalla de "app no verificada", y CMS3 no puede leer el resto del Drive.
//
// Sin dependencias nuevas: OAuth y Drive v3 se hablan con `fetch` (el repo no
// tiene googleapis ni librerías de OAuth, y para esto no hacen falta).

import { randomBytes } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const ABOUT_URL = "https://www.googleapis.com/drive/v3/about";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const TIMEOUT_MS = 60_000;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** Fail-closed como `mailer.ts`: sin credenciales cargadas, la función no existe. */
export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function buildAuthUrl(config: GoogleOAuthConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    // offline + consent: necesitamos el refresh token, y Google sólo lo manda
    // la primera vez salvo que se fuerce el consentimiento.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* abajo */ }
  if (!res.ok) {
    const detail = String(data.error_description ?? data.error ?? text.slice(0, 200) ?? "");
    throw new Error(`Google respondió ${res.status}: ${detail}`);
  }
  return data;
}

/** Canje del código del callback. Devuelve el refresh token, que es lo que se guarda. */
export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const data = await postForm(TOKEN_URL, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const refreshToken = String(data.refresh_token ?? "");
  const accessToken = String(data.access_token ?? "");
  if (!refreshToken || !accessToken) {
    throw new Error("Google no devolvió el permiso permanente. Volvé a conectar la cuenta.");
  }
  return { refreshToken, accessToken };
}

// El access token dura una hora: se cachea en memoria por refresh token para no
// pedir uno nuevo en cada PDF. Si el proceso reinicia, se vuelve a pedir y listo.
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(config: GoogleOAuthConfig, refreshToken: string): Promise<string> {
  const cached = accessTokens.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const data = await postForm(TOKEN_URL, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const token = String(data.access_token ?? "");
  if (!token) throw new Error("Google no devolvió el permiso de acceso.");
  const expiresIn = Number(data.expires_in ?? 3600);
  accessTokens.set(refreshToken, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

/** Desconectar: el permiso deja de existir del lado de Google, no sólo en CMS3. */
export async function revokeToken(refreshToken: string): Promise<void> {
  accessTokens.delete(refreshToken);
  await postForm(REVOKE_URL, { token: refreshToken });
}

async function driveFetch(
  accessToken: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
    body: init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* abajo */ }
  if (!res.ok) {
    const error = data.error as { message?: string } | undefined;
    throw new Error(`Drive respondió ${res.status}: ${error?.message ?? text.slice(0, 200)}`);
  }
  return data;
}

/** Mail de la cuenta conectada, sólo para mostrarlo en Configuración. */
export async function getAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const data = await driveFetch(accessToken, `${ABOUT_URL}?fields=user(emailAddress)`);
    const user = data.user as { emailAddress?: string } | undefined;
    return user?.emailAddress ?? null;
  } catch {
    // El mail es un detalle de pantalla: si Google no lo da, la conexión igual sirve.
    return null;
  }
}

/** Escapa el nombre para la query `q` de Drive (las comillas simples la cortan). */
function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Devuelve el id de la carpeta, creándola si no está. Con drive.file sólo ve las suyas. */
export async function ensureFolder(accessToken: string, name: string, parentId: string | null): Promise<string> {
  const clauses = [
    `name = ${quote(name)}`,
    `mimeType = ${quote(FOLDER_MIME)}`,
    "trashed = false",
    parentId ? `${quote(parentId)} in parents` : "'root' in parents",
  ];
  const params = new URLSearchParams({ q: clauses.join(" and "), fields: "files(id)", pageSize: "1" });
  const found = await driveFetch(accessToken, `${FILES_URL}?${params.toString()}`);
  const files = (found.files as Array<{ id?: string }> | undefined) ?? [];
  if (files[0]?.id) return files[0].id;

  const created = await driveFetch(accessToken, `${FILES_URL}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  const id = String(created.id ?? "");
  if (!id) throw new Error(`No se pudo crear la carpeta "${name}".`);
  return id;
}

/** Manda a la papelera los archivos con ese nombre en la carpeta (reemplazo de una versión previa). */
export async function trashByName(accessToken: string, folderId: string, fileName: string): Promise<void> {
  const params = new URLSearchParams({
    q: `name = ${quote(fileName)} and ${quote(folderId)} in parents and trashed = false`,
    fields: "files(id)",
    pageSize: "20",
  });
  const found = await driveFetch(accessToken, `${FILES_URL}?${params.toString()}`);
  const files = (found.files as Array<{ id?: string }> | undefined) ?? [];
  for (const file of files) {
    if (!file.id) continue;
    await driveFetch(accessToken, `${FILES_URL}/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }
}

/**
 * Nombres de los archivos de la carpeta que empiezan con ese texto. Se usa para
 * saber en qué número de adjunto (Att1, Att2…) va un documento.
 */
export async function listFileNames(accessToken: string, folderId: string, startsWith: string): Promise<string[]> {
  const params = new URLSearchParams({
    q: `${quote(folderId)} in parents and name contains ${quote(startsWith)} and trashed = false`,
    fields: "files(name)",
    pageSize: "200",
  });
  const found = await driveFetch(accessToken, `${FILES_URL}?${params.toString()}`);
  const files = (found.files as Array<{ name?: string }> | undefined) ?? [];
  return files.map(f => f.name ?? "").filter(Boolean);
}

/**
 * Busca en la carpeta un archivo que CMS3 haya subido con esa marca interna
 * (`appProperties`, privadas de la app). Sirve para reconocer que un archivo ya
 * está archivado y no volver a subirlo con otro número.
 */
export async function findByAppProperty(
  accessToken: string,
  folderId: string,
  key: string,
  value: string,
): Promise<{ id: string; name: string } | null> {
  const params = new URLSearchParams({
    q: `${quote(folderId)} in parents and trashed = false and appProperties has { key=${quote(key)} and value=${quote(value)} }`,
    fields: "files(id,name)",
    pageSize: "1",
  });
  const found = await driveFetch(accessToken, `${FILES_URL}?${params.toString()}`);
  const file = ((found.files as Array<{ id?: string; name?: string }> | undefined) ?? [])[0];
  return file?.id ? { id: file.id, name: file.name ?? "" } : null;
}

/** Sube un archivo a la carpeta. `mimeType` porque no todo es PDF: el remito puede ser una foto. */
export async function uploadFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  content: Buffer,
  appProperties?: Record<string, string>,
): Promise<string> {
  const boundary = `cms3-${randomBytes(12).toString("hex")}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType,
    ...(appProperties ? { appProperties } : {}),
  });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, content, tail]);

  const data = await driveFetch(accessToken, `${UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  return String(data.id ?? "");
}

export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
