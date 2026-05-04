import { log } from "../../common/logger";

// Mail provider abstraction. Currently implements Resend (https://resend.com).
// Used by the weekly backup runner and any future transactional mail flows.
//
// Configuration via env vars:
//   MAIL_PROVIDER  = "resend"  (anything else → disabled)
//   MAIL_API_KEY   = Resend API key (re_...)
//   MAIL_FROM      = "Name <noreply@yourdomain>" — must be a verified sender
//
// If MAIL_PROVIDER !== "resend" or MAIL_API_KEY is missing, isMailConfigured()
// returns false and callers should fail-closed (e.g. respond 503 instead of
// silently dropping mail).

export interface MailAttachment {
  filename: string;
  contentBase64: string; // base64-encoded bytes
}

export interface SendMailRequest {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  id: string;
}

export function isMailConfigured(): boolean {
  return (
    String(process.env.MAIL_PROVIDER || "").trim().toLowerCase() === "resend" &&
    !!String(process.env.MAIL_API_KEY || "").trim() &&
    !!String(process.env.MAIL_FROM || "").trim()
  );
}

export async function sendMail(request: SendMailRequest): Promise<SendMailResult> {
  if (!isMailConfigured()) {
    throw new Error("MAIL_NOT_CONFIGURED");
  }

  const apiKey = String(process.env.MAIL_API_KEY).trim();
  const from = String(process.env.MAIL_FROM).trim();

  const payload: Record<string, unknown> = {
    from,
    to: [request.to],
    subject: request.subject,
    html: request.html,
  };

  if (request.attachments && request.attachments.length > 0) {
    payload.attachments = request.attachments.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
    }));
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    log.error("[mail-service] Resend API error", response.status, bodyText.slice(0, 500));
    throw new Error(`MAIL_PROVIDER_ERROR_${response.status}`);
  }

  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { id: String(data.id || "") };
}
