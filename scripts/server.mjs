import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chat from "../api/chat.js";
import progress from "../api/progress.js";
import chats from "../api/chats.js";
import voice from "../api/voice.js";
import activity from "../api/activity.js";
import study from "../api/study.js";
import login from "../api/login.js";
import { isLoggedIn } from "../api/_lib/session.js";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const routes = { "/api/activity": activity, "/api/chat": chat, "/api/progress": progress, "/api/chats": chats, "/api/voice": voice, "/api/study": study, "/api/login": login };
// /api/login is the way in, so it cannot sit behind the session gate.
const openRoutes = new Set(["/api/login"]);
const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".woff":"font/woff", ".woff2":"font/woff2", ".ttf":"font/ttf", ".svg":"image/svg+xml", ".png":"image/png" };

export function createAppServer() {
  return createServer(async (req, res) => {
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader("Content-Type","application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/health") {res.json({ok:true});return;}
      if (url.pathname.startsWith("/api/")) {
        const handler = routes[url.pathname];
        if (!handler) {res.status(404).json({error:"Unknown API route."});return;}
        const chunks=[];let size=0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 12*1024*1024) {res.status(413).json({error:"Request too large."});return;}
          chunks.push(chunk);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        try {req.body=text ? JSON.parse(text) : {};}
        catch {res.status(400).json({error:"Invalid JSON."});return;}
        req.query = Object.fromEntries(url.searchParams);
        if (!openRoutes.has(url.pathname) && !isLoggedIn(req)) {res.status(401).json({error:"Please sign in."});return;}
        await handler(req,res);
        return;
      }
      if (!["GET","HEAD"].includes(req.method)) {res.status(405).json({error:"Method not allowed."});return;}
      const candidate = path.resolve(dist, "."+decodeURIComponent(url.pathname));
      if (candidate !== path.resolve(dist) && !candidate.startsWith(dist)) {res.status(403).json({error:"Forbidden."});return;}
      let file=candidate;
      try {if (!(await stat(file)).isFile()) file=path.join(dist,"index.html");}
      catch {file=path.join(dist,"index.html");}
      await stat(file);
      res.setHeader("Content-Type",mime[path.extname(file)] || "application/octet-stream");
      if (req.method === "HEAD") {res.end();return;}
      createReadStream(file).on("error",()=>res.destroy()).pipe(res);
    } catch (error) {
      console.error("Request failed:",error.message);
      if (!res.headersSent) res.status(500).json({error:"Request failed. Check the server configuration."});
      else res.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT)||8080;
  createAppServer().listen(port,"0.0.0.0",()=>console.log(`Jim's Math Lab listening on :${port}`));
}

