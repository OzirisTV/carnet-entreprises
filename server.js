const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

let createClient = null;

try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch (error) {
  createClient = null;
}

const ROOT_DIR = __dirname;
const DATA_FILE = path.join(ROOT_DIR, "data.json");
const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = "2026.07.10-local-save-1";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const LEGACY_ROUTE_NAMES = Array.from({ length: 26 }, (_, index) => `NPX${String.fromCharCode(65 + index)}`);
const WEEK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};
const sessions = new Map();
const supabase = process.env.SUPABASE_KEY && createClient
  ? createClient("https://qqugqimhzileswjrqcju.supabase.co", process.env.SUPABASE_KEY)
  : null;

const server = http.createServer(async (request, response) => {
  try {
    setCommonHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, { status: "ok", version: APP_VERSION });
      return;
    }

    if (pathname === "/api/state" && request.method === "GET") {
      const database = await readDatabase();
      sendJson(response, 200, { routes: getDirectRoutes(database) });
      return;
    }

    if (pathname === "/api/state" && request.method === "PUT") {
      const body = await readJsonBody(request);
      const database = await readDatabase();
      database.directRoutes = normalizeRoutes(body.routes);
      await writeDatabase(database);
      sendJson(response, 200, { routes: database.directRoutes });
      return;
    }

    if (pathname === "/api/agencies" && request.method === "GET") {
      const database = await readDatabase();
      const agencies = database.agencies
        .map((agency) => ({ id: agency.id, name: agency.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));
      sendJson(response, 200, { agencies });
      return;
    }

    if (pathname === "/api/agencies" && request.method === "POST") {
      const body = await readJsonBody(request);
      const database = await readDatabase();
      const name = normalizeAgencyName(body.name);
      const password = validatePassword(body.password);

      if (!name) throw httpError(400, "Le nom de l'agence est obligatoire.");
      if (database.agencies.some((agency) => agency.name.toLocaleLowerCase("fr-FR") === name.toLocaleLowerCase("fr-FR"))) {
        throw httpError(409, "Cette agence existe deja.");
      }

      const salt = crypto.randomBytes(16).toString("hex");
      const agency = {
        id: createId(),
        name,
        passwordSalt: salt,
        passwordHash: hashPassword(password, salt),
        createdAt: new Date().toISOString(),
        routes: database.agencies.length === 0 && database.legacyRoutes.length
          ? database.legacyRoutes
          : createDefaultRoutes()
      };

      database.agencies.push(agency);
      database.legacyRoutes = [];
      await writeDatabase(database);

      const token = createSession(agency.id);
      sendJson(response, 201, {
        agency: publicAgency(agency),
        token,
        state: { routes: agency.routes }
      });
      return;
    }

    const loginMatch = pathname.match(/^\/api\/agencies\/([^/]+)\/login$/);
    if (loginMatch && request.method === "POST") {
      const database = await readDatabase();
      const agency = database.agencies.find((item) => item.id === decodeURIComponent(loginMatch[1]));
      if (!agency) throw httpError(404, "Agence introuvable.");

      const body = await readJsonBody(request);
      if (!verifyPassword(String(body.password || ""), agency.passwordSalt, agency.passwordHash)) {
        throw httpError(401, "Mot de passe incorrect.");
      }

      const token = createSession(agency.id);
      sendJson(response, 200, {
        agency: publicAgency(agency),
        token,
        state: { routes: agency.routes }
      });
      return;
    }

    const agencyMatch = pathname.match(/^\/api\/agencies\/([^/]+)$/);
    if (agencyMatch && request.method === "DELETE") {
      const agencyId = decodeURIComponent(agencyMatch[1]);
      const database = await readDatabase();
      const agencyIndex = database.agencies.findIndex((item) => item.id === agencyId);
      if (agencyIndex === -1) throw httpError(404, "Agence introuvable.");

      const body = await readJsonBody(request);
      const agency = database.agencies[agencyIndex];
      if (!verifyPassword(String(body.password || ""), agency.passwordSalt, agency.passwordHash)) {
        throw httpError(401, "Mot de passe incorrect.");
      }

      database.agencies.splice(agencyIndex, 1);
      await writeDatabase(database);
      revokeAgencySessions(agencyId);
      sendJson(response, 200, { deleted: true });
      return;
    }

    const stateMatch = pathname.match(/^\/api\/agencies\/([^/]+)\/state$/);
    if (stateMatch && request.method === "GET") {
      const agencyId = decodeURIComponent(stateMatch[1]);
      requireSession(request, agencyId);
      const database = await readDatabase();
      const agency = database.agencies.find((item) => item.id === agencyId);
      if (!agency) throw httpError(404, "Agence introuvable.");

      sendJson(response, 200, {
        agency: publicAgency(agency),
        routes: agency.routes
      });
      return;
    }

    if (stateMatch && request.method === "PUT") {
      const agencyId = decodeURIComponent(stateMatch[1]);
      requireSession(request, agencyId);
      const body = await readJsonBody(request);
      const database = await readDatabase();
      const agency = database.agencies.find((item) => item.id === agencyId);
      if (!agency) throw httpError(404, "Agence introuvable.");

      agency.routes = normalizeRoutes(body.routes);
      await writeDatabase(database);
      sendJson(response, 200, {
        agency: publicAgency(agency),
        routes: agency.routes
      });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      throw httpError(405, "Methode non autorisee.");
    }

    await serveStaticFile(pathname, response, request.method === "HEAD");
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.statusCode ? error.message : "Erreur serveur",
      detail: error.statusCode ? undefined : error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DHL carnet entreprises : http://localhost:${PORT}`);
  console.log(`Sauvegarde : ${supabase ? "Supabase" : "data.json local"}`);
});

async function serveStaticFile(pathname, response, headOnly) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT_DIR, safePath);
  const relativePath = path.relative(ROOT_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw httpError(403, "Acces interdit.");
  }

  try {
    const bytes = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(headOnly ? undefined : bytes);
  } catch (error) {
    if (error.code === "ENOENT") throw httpError(404, "Fichier introuvable.");
    throw error;
  }
}

async function readDatabase() {
  const raw = supabase ? await readSupabaseData() : await readLocalData();
  return normalizeDatabase(raw);
}

async function writeDatabase(database) {
  const normalized = normalizeDatabase(database);
  if (supabase) await writeSupabaseData(normalized);
  else await writeLocalData(normalized);
}

async function readSupabaseData() {
  const { data, error } = await supabase
    .from("shared_state")
    .select("data")
    .eq("id", 1)
    .single();

  if (error) throw error;
  return data.data;
}

async function writeSupabaseData(value) {
  const { error } = await supabase
    .from("shared_state")
    .upsert({ id: 1, data: value, updated_at: new Date().toISOString() });

  if (error) throw error;
}

async function readLocalData() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 2, agencies: [], legacyRoutes: [] };
  }
}

async function writeLocalData(value) {
  const tempFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempFile, DATA_FILE);
}

function normalizeDatabase(value) {
  if (value && Array.isArray(value.agencies)) {
    return {
      version: 2,
      directRoutes: Array.isArray(value.directRoutes) ? normalizeRoutes(value.directRoutes) : [],
      agencies: value.agencies.map(normalizeAgency),
      legacyRoutes: normalizeRoutes(value.legacyRoutes)
    };
  }

  return {
    version: 2,
    directRoutes: [],
    agencies: [],
    legacyRoutes: tabsToRoutes(value && value.tabs)
  };
}

function getDirectRoutes(database) {
  if (Array.isArray(database.directRoutes) && database.directRoutes.length) return database.directRoutes;
  if (database.agencies[0] && Array.isArray(database.agencies[0].routes) && database.agencies[0].routes.length) {
    return database.agencies[0].routes;
  }
  if (Array.isArray(database.legacyRoutes) && database.legacyRoutes.length) return database.legacyRoutes;
  return createDefaultRoutes();
}

function normalizeAgency(agency) {
  return {
    id: String(agency.id || createId()),
    name: normalizeAgencyName(agency.name) || "AGENCE",
    passwordSalt: String(agency.passwordSalt || ""),
    passwordHash: String(agency.passwordHash || ""),
    createdAt: String(agency.createdAt || new Date().toISOString()),
    routes: normalizeRoutes(agency.routes)
  };
}

function normalizeRoutes(routes) {
  if (!Array.isArray(routes)) return [];

  const seenNames = new Set();
  return routes.flatMap((route) => {
    const name = normalizeRouteName(route && route.name);
    const key = name.toLocaleLowerCase("fr-FR");
    if (!name || seenNames.has(key)) return [];
    seenNames.add(key);

    return [{
      id: String(route.id || createId()),
      name,
      companies: Array.isArray(route.companies) ? route.companies.map(normalizeCompany) : []
    }];
  });
}

function tabsToRoutes(tabs) {
  if (!tabs || typeof tabs !== "object") return [];
  return LEGACY_ROUTE_NAMES.map((name) => ({
    id: `legacy-${name.toLowerCase()}`,
    name,
    companies: Array.isArray(tabs[name]) ? tabs[name].map(normalizeCompany) : []
  }));
}

function createDefaultRoutes() {
  return [{ id: createId(), name: "NPXA", companies: [] }];
}

function normalizeCompany(company) {
  return {
    id: String(company && company.id || createId()),
    name: normalizeCompanyName(company && company.name),
    schedule: normalizeSchedule(company && company.schedule),
    closureException: normalizeClosureException(company && company.closureException),
    notes: String(company && company.notes || ""),
    closedMonday: Boolean(company && company.closedMonday),
    closedFriday: Boolean(company && company.closedFriday),
    updatedAt: normalizeTimestamp(company && company.updatedAt),
    open: false
  };
}

function normalizeSchedule(schedule) {
  if (typeof schedule === "string") {
    return Object.fromEntries(WEEK_DAYS.map((day) => [day, schedule]));
  }
  return Object.fromEntries(WEEK_DAYS.map((day) => [day, String(schedule && schedule[day] || "")]));
}

function normalizeClosureException(value) {
  return {
    enabled: Boolean(value && value.enabled),
    start: normalizeDateValue(value && value.start),
    end: normalizeDateValue(value && value.end)
  };
}

function normalizeDateValue(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeAgencyName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeRouteName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleUpperCase("fr-FR").slice(0, 30);
}

function normalizeCompanyName(value) {
  return String(value || "").trim().toLocaleUpperCase("fr-FR");
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 4) throw httpError(400, "Le mot de passe doit contenir au moins 4 caracteres.");
  if (password.length > 128) throw httpError(400, "Le mot de passe est trop long.");
  return password;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createSession(agencyId) {
  cleanupSessions();
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { agencyId, expiresAt: Date.now() + SESSION_DURATION_MS });
  return token;
}

function requireSession(request, agencyId) {
  cleanupSessions();
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const session = sessions.get(token);
  if (!session || session.agencyId !== agencyId) throw httpError(401, "Session expiree. Reconnectez-vous.");
  session.expiresAt = Date.now() + SESSION_DURATION_MS;
}

function cleanupSessions() {
  const now = Date.now();
  sessions.forEach((session, token) => {
    if (session.expiresAt <= now) sessions.delete(token);
  });
}

function revokeAgencySessions(agencyId) {
  sessions.forEach((session, token) => {
    if (session.agencyId === agencyId) sessions.delete(token);
  });
}

function publicAgency(agency) {
  return { id: agency.id, name: agency.name };
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

async function readJsonBody(request) {
  const body = await readRequestBody(request);
  try {
    return JSON.parse(body || "{}");
  } catch (error) {
    throw httpError(400, "JSON invalide.");
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(httpError(413, "Requete trop grande."));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function setCommonHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
