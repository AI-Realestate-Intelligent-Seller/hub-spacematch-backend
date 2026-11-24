// Email with a one-time code: verify a new account, sign in by code, reset a password.
import type { MailMessage } from "../mailer.js";

export type AuthCodeType = "email-verification" | "sign-in" | "forget-password" | "change-email";

const COPY: Record<AuthCodeType, { subject: string; heading: string; line: string }> = {
  "email-verification": {
    subject: "Your SpaceMatch Hub verification code",
    heading: "Confirm your email",
    line: "Enter this code in the Hub to finish creating your account.",
  },
  "sign-in": {
    subject: "Your SpaceMatch Hub sign-in code",
    heading: "Sign in to the Hub",
    line: "Enter this code in the Hub to sign in.",
  },
  "forget-password": {
    subject: "Reset your SpaceMatch Hub password",
    heading: "Reset your password",
    line: "Enter this code in the Hub to choose a new password.",
  },
  "change-email": {
    subject: "Confirm your new email for SpaceMatch Hub",
    heading: "Confirm your new email",
    line: "Enter this code in the Hub to confirm this email address.",
  },
};

export function authCodeEmail(to: string, code: string, type: AuthCodeType, expiresInMinutes: number): MailMessage {
  const c = COPY[type];
  const footer = "If you didn't ask for this, you can ignore this email. Your account is safe.";
  const text = `${c.heading}\n\n${c.line}\n\n${code}\n\nThe code expires in ${expiresInMinutes} minutes.\n\n${footer}\n\nSpaceMatch Inc.`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:#0a0a0a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px">
    <tr><td style="padding:28px 28px 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9c7434">SpaceMatch Hub</td></tr>
    <tr><td style="padding:0 28px;font-size:22px;font-weight:bold">${c.heading}</td></tr>
    <tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.5">${c.line}</td></tr>
    <tr><td style="padding:20px 28px">
      <div style="font-size:32px;font-weight:bold;letter-spacing:.3em;font-family:'Courier New',monospace;background:#f4f4f2;border-radius:6px;padding:14px 0;text-align:center">${code}</div>
    </td></tr>
    <tr><td style="padding:0 28px;font-size:13px;color:#555">The code expires in ${expiresInMinutes} minutes.</td></tr>
    <tr><td style="padding:20px 28px 28px;font-size:12px;color:#777">${footer}<br>SpaceMatch Inc.</td></tr>
  </table>
</body></html>`;
  return { to, subject: c.subject, text, html, tag: `auth-code:${type}` };
}
