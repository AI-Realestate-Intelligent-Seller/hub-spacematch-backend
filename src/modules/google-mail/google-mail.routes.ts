import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../../config/index.js";
import { requireAuth } from "../../middlewares/auth.js";
import { badRequest, serviceUnavailable } from "../../utils/http-error.js";
import { manageableListing } from "../listings/listing.service.js";
import { getSetting, setSetting } from "../settings/setting.service.js";

const callbackPath = "/api/v1/google-mail/callback";
const cookieName = "hub_google_mail_state";
const ttl = 10 * 60 * 1000;
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const pendingSchema = z.object({
  userId: z.string(), listingId: idSchema, state: z.string(), verifier: z.string(), expires: z.number(),
});
const profileSchema = z.object({ email: z.email(), email_verified: z.literal(true) });
const settingsKey = (userId: string) => `googleMail.user.${userId}`;
const cookieOptions = () => ({
  httpOnly: true, sameSite: "lax" as const, path: callbackPath,
  secure: new URL(config.appUrl).protocol === "https:",
});

function oauthConfig() {
  const { clientId, clientSecret, redirectUri } = config.googleMail;
  if (!clientId || !clientSecret || !config.auth.secret) return null;
  return { clientId, clientSecret, secret: config.auth.secret, redirectUri: redirectUri ?? `${config.appUrl}${callbackPath}` };
}

function pendingCookie(value: string, secret: string) {
  return createHmac("sha256", secret).update("google-mail:v1:").update(value).digest("base64url");
}

function readPending(header: string | undefined, secret: string) {
  const cookie = header?.split(";").map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`));
  const [payload, signature] = (cookie?.slice(cookieName.length + 1) ?? "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(pendingCookie(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const value = pendingSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  return value.success && value.data.expires >= Date.now() ? value.data : null;
}

function composeUrl(email: string, listing: { address: string; token: string; sellerName: string; sellerEmail: string | null }) {
  if (!listing.sellerEmail) throw badRequest("Add the seller’s email address first.");
  const address = listing.address.split(",")[0];
  const firstName = listing.sellerName.trim().split(/\s+/)[0];
  const sellerUrl = `${config.appUrl}/s/${encodeURIComponent(listing.token)}`;
  const message = new URLSearchParams({
    subject: `Your listing page · ${address}`,
    body: `Hi ${firstName}! Here's your private SpaceMatch page for ${address}. It updates live as we launch and market your home: ${sellerUrl}`,
  });
  const mailto = `mailto:${encodeURIComponent(listing.sellerEmail)}?${message.toString().replaceAll("+", "%20")}`;
  const gmail = new URL("https://mail.google.com/mail/");
  gmail.search = new URLSearchParams({ authuser: email, extsrc: "mailto", url: mailto }).toString();
  return gmail.toString();
}

export const googleMailRoutes = Router();
googleMailRoutes.use(requireAuth);
googleMailRoutes.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

googleMailRoutes.get("/", async (req, res) => {
  const configured = !!oauthConfig();
  const email = configured ? await getSetting<string | null>(settingsKey(req.user!.id), null) : null;
  res.json({ configured, email });
});

googleMailRoutes.get("/callback", async (req, res) => {
  const oauth = oauthConfig();
  if (!oauth) throw serviceUnavailable("Google Mail is not configured.");
  const pending = readPending(req.headers.cookie, oauth.secret);
  if (!pending || pending.userId !== req.user!.id || pending.state !== req.query.state) {
    throw badRequest("The Google connection expired. Return to the listing and try again.");
  }
  res.clearCookie(cookieName, cookieOptions());
  const { listing } = await manageableListing(req.user!, pending.listingId);
  const back = `${config.appUrl}/listings/${pending.listingId}?googleMail=`;
  if (req.query.error === "access_denied") { res.redirect(`${back}cancelled`); return; }
  if (typeof req.query.code !== "string") { res.redirect(`${back}failed`); return; }

  let email: string;
  try {
    const tokens = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        code: req.query.code, client_id: oauth.clientId, client_secret: oauth.clientSecret,
        code_verifier: pending.verifier, grant_type: "authorization_code", redirect_uri: oauth.redirectUri,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokens.ok) throw new Error("Google token exchange failed");
    const { access_token } = z.object({ access_token: z.string().min(1) }).parse(await tokens.json());
    const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000),
    });
    if (!profile.ok) throw new Error("Google profile lookup failed");
    email = profileSchema.parse(await profile.json()).email;
  } catch {
    res.redirect(`${back}failed`);
    return;
  }
  await setSetting(settingsKey(req.user!.id), email, req.user!.email);
  res.redirect(listing.sellerEmail ? composeUrl(email, listing) : `${back}missing-seller`);
});

googleMailRoutes.get("/seller/:listingId", async (req, res) => {
  const oauth = oauthConfig();
  if (!oauth) throw serviceUnavailable("Google Mail is not configured.");
  const listingId = idSchema.parse(req.params.listingId);
  const { listing } = await manageableListing(req.user!, listingId);
  if (!listing.sellerEmail) throw badRequest("Add the seller’s email address first.");
  const email = await getSetting<string | null>(settingsKey(req.user!.id), null);
  if (email && req.query.switch !== "1") { res.redirect(composeUrl(email, listing)); return; }

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ userId: req.user!.id, listingId, state, verifier, expires: Date.now() + ttl })).toString("base64url");
  res.cookie(cookieName, `${payload}.${pendingCookie(payload, oauth.secret)}`, { ...cookieOptions(), maxAge: ttl });
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: oauth.clientId, redirect_uri: oauth.redirectUri, response_type: "code",
    scope: "openid email", prompt: "select_account", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  }).toString();
  res.redirect(authorization.toString());
});
