// Outgoing email through SMTP (Hostinger by default; any SMTP provider works).
//
// Behaviour:
//   MAIL_MODE=off                 → nothing is sent; the email is written to the log.
//                                   Outside production the log includes the body (so dev can read codes).
//   MAIL_MODE=live + SMTP keys    → sent through SMTP.
//   MAIL_MODE=live, keys missing  → not sent; logged as an error so it is noticed.
// Going live = fill SMTP_USER / SMTP_PASS (and MAIL_FROM) in .env and set MAIL_MODE=live.
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Short label for logs, e.g. "auth-code:email-verification". Never put secrets here. */
  tag: string;
}

export type MailResult = { status: "sent"; messageId: string } | { status: "logged" } | { status: "failed"; error: string };

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: { user: config.mail.user, pass: config.mail.pass },
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const live = config.mail.mode === "live";

  if (!live || !config.mail.isConfigured) {
    if (live) {
      logger.error("mail: MAIL_MODE=live but SMTP_USER/SMTP_PASS are empty; email not sent", { tag: msg.tag, to: msg.to });
    } else {
      logger.info("mail: not sent (MAIL_MODE=off)", {
        tag: msg.tag,
        to: msg.to,
        subject: msg.subject,
        // Bodies can contain sign-in codes: only show them outside production.
        ...(config.isProduction ? {} : { text: msg.text }),
      });
    }
    return { status: "logged" };
  }

  try {
    const info = await getTransporter().sendMail({
      from: config.mail.from,
      replyTo: config.mail.replyTo,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    logger.info("mail: sent", { tag: msg.tag, to: msg.to, messageId: info.messageId });
    return { status: "sent", messageId: info.messageId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("mail: send failed", {
      tag: msg.tag,
      to: msg.to,
      error,
      // Outside production, keep the body (e.g. the sign-up code) in the log so development
      // can continue while SMTP is broken. Never in production: bodies can hold sign-in codes.
      ...(config.isProduction ? {} : { text: msg.text }),
    });
    return { status: "failed", error };
  }
}

/** Health check helper: true when SMTP accepts our login (only used when MAIL_MODE=live). */
export async function verifySmtp(): Promise<number> {
  const started = Date.now();
  await getTransporter().verify();
  return Date.now() - started;
}
