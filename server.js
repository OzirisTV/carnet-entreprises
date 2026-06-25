const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
let createClient = null;

try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch (error) {
  createClient = null;
}

const ROOT_DIR = __dirname;
const DATA_FILE = path.join(ROOT_DIR, "data.json");
const supabase = process.env.SUPABASE_KEY && createClient
  ? createClient("https://qqugqimhzileswjrqcju.supabase.co", process.env.SUPABASE_KEY)
  : null;
const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROUTES = Array.from({ length: 26 }, (_, index) => `NPX${String.fromCharCode(65 + index)}`);
const WEEK_DAYS = [
  { key: "monday", label: "Lundi" },
  { key: "tuesday", label: "Mardi" },
  { key: "wednesday", label: "Mercredi" },
  { key: "thursday", label: "Jeudi" },
  { key: "friday", label: "Vendredi" }
];
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  try {
    setCommonHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/state" && request.method === "GET") {
      sendJson(response, 200, await readSharedState());
      return;
    }

    if (url.pathname === "/api/state" && (request.method === "PUT" || request.method === "POST")) {
      const body = await readRequestBody(request);
      await writeSharedState(JSON.parse(body || "{}"));
      sendJson(response, 200, await readSharedState());
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method not allowed");
      return;
    }

    await serveStaticFile(url.pathname, response, request.method === "HEAD");
  } catch (error) {
    sendJson(response, 500, { error: "Erreur serveur", detail: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DHL carnet entreprises : http://localhost:${PORT}`);
  console.log("Depuis un autre appareil du meme reseau, ouvre http://ADRESSE-IP-DU-PC:3000");
});

async function serveStaticFile(pathname, response, headOnly) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT_DIR, safePath);
  const relativePath = path.relative(ROOT_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const bytes = await fs.readFile(filePath);

  response.writeHead(200, { "Content-Type": contentType });
  if (!headOnly) response.end(bytes);
  else response.end();
}

async function readSharedState() {
  if (!supabase) return readLocalSharedState();

  const { data, error } = await supabase
    .from("shared_state")
    .select("data")
    .eq("id", 1)
    .single();

  if (error) throw error;

  return normalizeSharedState(data.data);
}

async function writeSharedState(value) {
  const state = normalizeSharedState(value);

  if (!supabase) {
    await writeLocalSharedState(state);
    return;
  }

  const { error } = await supabase
    .from("shared_state")
    .upsert({
      id: 1,
      data: state,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;
}

async function readLocalSharedState() {
  try {
    return normalizeSharedState(JSON.parse(await fs.readFile(DATA_FILE, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const state = createDefaultSharedState();
    await writeLocalSharedState(state);
    return state;
  }
}

async function writeLocalSharedState(value) {
  const state = normalizeSharedState(value);
  const tempFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempFile, DATA_FILE);
}

function normalizeSharedState(value) {
  const sourceTabs = value && typeof value === "object" ? value.tabs || {} : {};
  return {
    tabs: Object.fromEntries(ROUTES.map((route) => {
      const companies = Array.isArray(sourceTabs[route]) ? sourceTabs[route].map(normalizeCompany) : [];
      return [route, companies];
    }))
  };
}

function normalizeCompany(company) {
  return {
    id: String(company.id || createId()),
    name: normalizeCompanyName(company.name || ""),
    schedule: normalizeSchedule(company.schedule),
    closureException: normalizeClosureException(company.closureException),
    notes: String(company.notes || ""),
    closedMonday: Boolean(company.closedMonday),
    closedFriday: Boolean(company.closedFriday),
    open: Boolean(company.open)
  };
}

function normalizeCompanyName(value) {
  return String(value || "").trim().toLocaleUpperCase("fr-FR");
}

function createEmptySchedule() {
  return Object.fromEntries(WEEK_DAYS.map((day) => [day.key, ""]));
}

function normalizeSchedule(schedule) {
  if (typeof schedule === "string") {
    return Object.fromEntries(WEEK_DAYS.map((day) => [day.key, schedule]));
  }
  if (!schedule || typeof schedule !== "object") return createEmptySchedule();

  return Object.fromEntries(WEEK_DAYS.map((day) => [day.key, String(schedule[day.key] || "")]));
}

function createEmptyClosureException() {
  return {
    enabled: false,
    start: "",
    end: ""
  };
}

function normalizeClosureException(value) {
  if (!value || typeof value !== "object") return createEmptyClosureException();

  return {
    enabled: Boolean(value.enabled),
    start: normalizeDateValue(value.start),
    end: normalizeDateValue(value.end)
  };
}

function normalizeDateValue(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function createDefaultSharedState() {
  return {
    tabs: Object.fromEntries(ROUTES.map((route) => [route, []]))
  };
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Requete trop grande"));
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function setCommonHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendText(response, statusCode, value) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(value);
}
