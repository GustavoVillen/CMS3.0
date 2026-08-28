// Envio de correo del sistema (SMTP).
//
// Unica salida de mails de la API. Hoy la usa el envio de la Solicitud de
// Servicio al proveedor; cualquier otro modulo que necesite mandar un correo
// entra por aca y no arma su propio transporte.
//
// Se configura por variables de entorno (.env de la API):
//
//   SMTP_HOST=smtp.office365.com      # Outlook 365. Gmail: smtp.gmail.com
//   SMTP_PORT=587
//   SMTP_SECURE=false                 # true solo para el puerto 465
//   SMTP_USER=solicitudes@mercuriogroup.com.py
//   SMTP_PASS=<clave de aplicacion>   # NO la clave de la persona
//   SMTP_FROM="Mercurio Naviera <solicitudes@mercuriogroup.com.py>"   # opcional
//
// Sin SMTP_HOST/USER/PASS el envio queda APAGADO: `isMailConfigured()` da false
// y quien llama sigue con su camino manual (ver el envio al proveedor de la SS).
// Fail-closed a proposito: nunca hay que dar por enviado un correo que no salio.

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { log } from "./logger";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailInput {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  /** Cuerpo en texto plano (los correos del sistema no usan HTML). */
  text: string;
  attachments?: MailAttachment[];
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function readSmtpConfig(): SmtpConfig | null {
  const host = (process.env.SMTP_HOST || "").trim();
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  if (!host || !user || !pass) return null;
  const port = Number.parseInt((process.env.SMTP_PORT || "587").trim(), 10) || 587;
  return {
    host,
    port,
    // El 465 es el unico que arranca cifrado de entrada; 587 sube a TLS con STARTTLS.
    secure: (process.env.SMTP_SECURE || "").trim().toLowerCase() === "true" || port === 465,
    user,
    pass,
    from: (process.env.SMTP_FROM || "").trim() || user,
  };
}

/** ¿Hay casilla configurada? Si no, el sistema no manda correos. */
export function isMailConfigured(): boolean {
  return readSmtpConfig() !== null;
}

let transporter: Transporter | null = null;
let transporterKey = "";

function getTransporter(cfg: SmtpConfig): Transporter {
  // Se reusa mientras la config no cambie (el pool evita reabrir la conexion
  // SMTP en cada envio).
  const key = `${cfg.host}:${cfg.port}:${cfg.user}:${cfg.secure}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      pool: true,
    });
    transporterKey = key;
  }
  return transporter;
}

export interface SendMailResult {
  sent: boolean;
  /** Direcciones a las que se mandó (para dejarlo asentado en el registro). */
  to: string[];
  cc: string[];
  /** Motivo, cuando no salió. */
  reason?: "NOT_CONFIGURED" | "SEND_FAILED";
  error?: string;
}

const asList = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map(s => s.trim()).filter(Boolean);

/**
 * Manda el correo. NUNCA tira: devuelve `sent:false` con el motivo, porque el
 * que llama tiene que poder decidir que hacer (avisar, dejarlo para mandar a
 * mano, no avanzar el estado).
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const to = asList(input.to);
  const cc = asList(input.cc);
  const cfg = readSmtpConfig();
  if (!cfg) return { sent: false, to, cc, reason: "NOT_CONFIGURED" };
  if (to.length === 0) return { sent: false, to, cc, reason: "SEND_FAILED", error: "Sin destinatario." };

  try {
    await getTransporter(cfg).sendMail({
      from: cfg.from,
      to,
      cc: cc.length ? cc : undefined,
      subject: input.subject,
      text: input.text,
      attachments: input.attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return { sent: true, to, cc };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // El detalle va al log del servidor; al usuario se le devuelve el motivo.
    log.error("mail.send_failed", { host: cfg.host, to: to.length, error });
    return { sent: false, to, cc, reason: "SEND_FAILED", error };
  }
}
