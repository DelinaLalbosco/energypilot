import { createServer } from "node:http";
import { URL } from "node:url";
import { getPlan } from "../providers/planProvider";
import { ReadingError, addReadings, clearReadings, listReadings } from "../domain/readings";
import { loadHorizon, loadScenario } from "../providers/energyData";
import { freshness } from "../providers/pipelineRefresh";
import { ask } from "../domain/assistant";

// Optional backend/.env (e.g. ANTHROPIC_API_KEY=...) — keys stay on the server.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url).pathname);
} catch {
  /* no .env file */
}

const PORT = Number(process.env.PORT || 8787);

function send(res: any, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
}

const MAX_BODY_BYTES = 1_000_000;

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ReadingError("Request body too large (max 1 MB)"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/api/health") return send(res, 200, { ok: true, service: "hackowatt-backend" });
    if (url.pathname === "/api/plan") {
      const now = Math.max(0, Math.min(23, Number(url.searchParams.get("now") || 19)));
      const defaultPv = loadScenario().solar.defaultKwp;
      const pv = Number(url.searchParams.get("pv") ?? defaultPv);
      const pvKwp = Number.isFinite(pv) ? Math.max(0, Math.min(50, pv)) : defaultPv;
      const comfort = url.searchParams.get("comfort") ?? undefined;
      return send(res, 200, await getPlan(now, pvKwp, comfort));
    }
    if (url.pathname === "/api/readings") {
      if (req.method === "GET") return send(res, 200, { readings: listReadings() });
      if (req.method === "DELETE") {
        clearReadings();
        return send(res, 200, { ok: true, total: 0 });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        return send(res, 200, { ok: true, ...addReadings(body, String(req.headers["content-type"] ?? "")) });
      }
      return send(res, 405, { error: "Use GET, POST or DELETE" });
    }
    if (url.pathname === "/api/ask") {
      if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
      const body = JSON.parse((await readBody(req)) || "{}");
      const question = String(body.question ?? "").trim().slice(0, 2000);
      if (!question) return send(res, 400, { error: "Missing question" });
      const history = Array.isArray(body.history)
        ? body.history
            .filter((t: any) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string")
            .map((t: any) => ({ role: t.role, content: t.content.slice(0, 4000) }))
        : [];
      const defaultPv = loadScenario().solar.defaultKwp;
      const pv = Number(body.pv ?? defaultPv);
      const plan = await getPlan(Number(body.now ?? 19), Number.isFinite(pv) ? pv : defaultPv, body.comfort ?? undefined);
      return send(res, 200, await ask(plan, question, history));
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof ReadingError) return send(res, 400, { error: error.message });
    console.error(error);
    return send(res, 500, { error: error instanceof Error ? error.message : "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`HackoWatt backend listening on http://localhost:${PORT}`);
  try {
    console.log(`[refresh] ${freshness(loadHorizon()[0]?.timestamp ?? "").message}`);
  } catch (error) {
    console.error("[refresh] could not check the forecast date:", error);
  }
});
