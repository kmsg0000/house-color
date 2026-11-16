// Node 로 서버 실행: node node-server.mjs  (PORT 환경변수, 기본 8787)
import http from 'node:http';
import { handle } from './server.mjs';

const PORT = Number(process.env.PORT || 8787);
http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const request = new Request(`${proto}://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request, process.env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e && e.message || e));
  }
}).listen(PORT, () => console.log(`MCP 서버: http://localhost:${PORT}/mcp`));
