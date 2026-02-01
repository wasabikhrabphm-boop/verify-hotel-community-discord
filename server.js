import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());

// capture raw body for webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); }
}));

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const PROVIDER_MODE = (process.env.PROVIDER_MODE || "demo").toLowerCase();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "dev_secret_change_me";

// In-memory store (use DB in production)
const results = new Map(); // sessionId -> {status, decision, age, dob, updatedAt, vendorData, refCode}

// Helpers
function calcAge(dob) {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  const birth = new Date(y, m - 1, d);
  let age = now.getFullYear() - birth.getFullYear();
  const md = now.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function makeId(prefix="sess") {
  const rnd = crypto.randomBytes(10).toString("hex");
  return `${prefix}_${Date.now()}_${rnd}`;
}

function makeRefCode() {
  return "VHC-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function signToken(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function getTokenFromReq(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/admin_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function requireAdmin(req, res, next) {
  const token = getTokenFromReq(req);
  const decoded = verifyToken(token);
  if (!decoded || !decoded.email) return res.status(401).json({ error: "Unauthorized" });
  if (ADMIN_EMAIL && decoded.email.toLowerCase() !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
  const now = Date.now();
  if (decoded.iat && (now - decoded.iat) > 12 * 60 * 60 * 1000) return res.status(401).json({ error: "Session expired" });
  req.adminEmail = decoded.email.toLowerCase();
  next();
}

app.use(express.static(path.join(__dirname, "public")));

/**
 * Create verification session (DEMO or VERIFF)
 */
app.post("/api/create-session", async (req, res) => {
  try {
    const personId = (req.body?.personId || "discord_user").toString().slice(0, 80);
    const refCode = makeRefCode();

    if (PROVIDER_MODE === "veriff") {
      const payload = {
        verification: {
          callback: `${PUBLIC_BASE_URL}/api/provider/webhook`,
          person: { id: personId },
          vendorData: `${personId}|${refCode}`,
          timestamp: new Date().toISOString(),
        },
      };

      const r = await fetch(`${process.env.VERIFF_BASE_URL || "https://stationapi.veriff.com"}/v1/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AUTH-CLIENT": process.env.VERIFF_API_KEY || "",
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const t = await r.text();
        return res.status(500).json({ error: "Create session failed", detail: t });
      }

      const data = await r.json();
      const sessionId = data?.verification?.id;
      const url = data?.verification?.url;

      if (!sessionId || !url) return res.status(500).json({ error: "Invalid provider response" });

      results.set(sessionId, {
        status: "pending",
        decision: "pending",
        age: null,
        dob: null,
        updatedAt: new Date().toISOString(),
        vendorData: personId,
        refCode
      });

      return res.json({ sessionId, url, mode: "veriff", refCode });
    }

    // DEMO mode: redirect to local simulated provider page
    const sessionId = makeId("demo");
    results.set(sessionId, {
      status: "pending",
      decision: "pending",
      age: null,
      dob: null,
      updatedAt: new Date().toISOString(),
      vendorData: personId,
      refCode
    });

    const url = `${PUBLIC_BASE_URL}/provider-demo.html?sessionId=${encodeURIComponent(sessionId)}&ref=${encodeURIComponent(refCode)}`;
    return res.json({ sessionId, url, mode: "demo", refCode });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

/**
 * Provider webhook endpoint (VERIFF or others)
 * IMPORTANT: implement provider-specific signature verification before production.
 */
app.post("/api/provider/webhook", async (req, res) => {
  try {
    const verification = req.body?.verification || {};
    const sessionId = verification?.id;

    // Signature check placeholder (provider-specific)
    // Example idea:
    // const got = (req.headers["x-hmac-signature"] || "").toString();
    // const expected = crypto.createHmac("sha256", process.env.VERIFF_SHARED_SECRET || "").update(req.rawBody || "").digest("hex");
    // if (got && expected && got !== expected) return res.status(401).send("Invalid signature");

    const decision = verification?.decision || "unknown";
    const dob = verification?.person?.dateOfBirth || null;

    const age = calcAge(dob);
    const passed = decision === "approved" || decision === "accept";

    if (sessionId) {
      const old = results.get(sessionId) || {};
      results.set(sessionId, {
        ...old,
        status: passed ? "passed" : "failed",
        decision,
        dob: dob ? dob : (old.dob || null),
        age: (age ?? old.age ?? null),
        updatedAt: new Date().toISOString(),
      });
    }

    res.status(200).send("ok");
  } catch (e) {
    res.status(500).send("error");
  }
});

/**
 * DEMO provider callback (stores LIMITED data only)
 */
app.post("/api/provider/demo-submit", (req, res) => {
  const { sessionId, decision, dob } = req.body || {};
  if (!sessionId || !results.has(sessionId)) return res.status(400).json({ error: "Bad session" });

  const age = calcAge(dob);
  const passed = decision === "approved";

  const old = results.get(sessionId) || {};
  results.set(sessionId, {
    ...old,
    status: passed ? "passed" : "failed",
    decision: passed ? "approved" : "rejected",
    dob: dob || null,
    age: (age ?? null),
    updatedAt: new Date().toISOString(),
  });

  return res.json({ ok: true });
});

/**
 * Public result for a single session (limited fields)
 */
app.get("/api/result/:sessionId", (req, res) => {
  const r = results.get(req.params.sessionId);
  if (!r) return res.status(404).json({ error: "Not found" });

  res.json({
    status: r.status,
    decision: r.decision,
    age: r.age,
    dob: r.dob,
    updatedAt: r.updatedAt,
    refCode: r.refCode,
  });
});

/**
 * ADMIN AUTH (no auto-login/backdoor)
 */
app.post("/api/admin/login", (req, res) => {
  const email = (req.body?.email || "").toString().toLowerCase().trim();
  const password = (req.body?.password || "").toString();

  if (!email || !password) return res.status(400).json({ error: "Missing credentials" });
  if (ADMIN_EMAIL && email !== ADMIN_EMAIL) return res.status(403).json({ error: "Not allowed" });
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken({ email, iat: Date.now() });
  res.setHeader("Set-Cookie", `admin_token=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax`);
  return res.json({ ok: true, token });
});

app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", `admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  return res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  return res.json({ email: req.adminEmail });
});

app.get("/api/admin/results", requireAdmin, (req, res) => {
  const all = [];
  for (const [sessionId, r] of results.entries()) {
    all.push({
      sessionId,
      status: r.status,
      decision: r.decision,
      age: r.age,
      dob: r.dob,
      updatedAt: r.updatedAt,
      vendorData: r.vendorData,
      refCode: r.refCode,
    });
  }
  all.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  res.json({ count: all.length, items: all });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Mode: ${PROVIDER_MODE} | Public: ${PUBLIC_BASE_URL}`);
});
