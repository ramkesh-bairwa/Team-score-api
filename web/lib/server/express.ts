// Minimal Express-compatible req/res for the API route handlers, so the handlers copied from the old
// Express API run unchanged and answer exactly like before: same status codes, JSON bodies, headers
// (application/json; charset=utf-8, weak ETag + 304, X-Powered-By) and the same 404/400 pages.
import crypto from 'crypto';

export type Req = {
  method: string;
  url: string;          // path + query, relative to the router mount (like Express req.url)
  originalUrl: string;  // full path + query
  path: string;
  params: Record<string, string>;
  query: Record<string, any>;
  body: any;
  headers: Headers;
  get(name: string): string | undefined;
  protocol: string;
};

export type Res = {
  status(code: number): Res;
  set(name: string, value: string): Res;
  json(body: any): void;
  send(body: any): void;
  sendHtml(html: string): void;
};

export type Handler = (req: Req, res: Res) => any;

// Express "simple" query parser (querystring): repeated keys become arrays
export const parseQuery = (search: URLSearchParams) => {
  const q: Record<string, any> = {};
  for (const [k, v] of search) {
    if (k in q) q[k] = Array.isArray(q[k]) ? [...q[k], v] : [q[k], v];
    else q[k] = v;
  }
  return q;
};

// Same algorithm as the `etag` package Express uses (weak, length + sha1)
const etag = (body: Buffer) => {
  if (!body.length) return 'W/"0-2jmj7l5rSw0yd5vlqbCDzd5OnYw"';
  const hash = crypto.createHash('sha1').update(body).digest('base64').substring(0, 27);
  return `W/"${body.length.toString(16)}-${hash}"`;
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Express/finalhandler error page (used for "Cannot GET /x" and body-parser errors)
export const errorPage = (status: number, message: string) => new Response(
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>${escapeHtml(message)}</pre>\n</body>\n</html>\n`,
  {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Powered-By': 'Express',
    },
  },
);

// Runs an Express-style handler and turns what it sends into a Response
export async function run(handler: Handler, req: Req): Promise<Response> {
  let status = 200;
  const headers = new Headers({ 'X-Powered-By': 'Express' });
  let body: Buffer | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>(r => { resolveDone = r; });

  const finish = (buf: Buffer, type: string) => {
    if (!headers.has('Content-Type')) headers.set('Content-Type', type);
    body = buf;
    resolveDone();
  };
  const res: Res = {
    status(code) { status = code; return res; },
    set(name, value) { headers.set(name, value); return res; },
    json(obj) { finish(Buffer.from(obj === undefined ? '' : JSON.stringify(obj)), 'application/json; charset=utf-8'); },
    send(obj) {
      if (typeof obj === 'string') finish(Buffer.from(obj), 'text/html; charset=utf-8');
      else res.json(obj);
    },
    sendHtml(html) { headers.set('Cache-Control', headers.get('Cache-Control') || 'public, max-age=0'); finish(Buffer.from(html), 'text/html; charset=utf-8'); },
  };

  try {
    await handler(req, res);
    if (body === null) await done; // every handler sends before it returns; this only covers late sends
  } catch (e: any) {
    console.error(e);
    return errorPage(500, 'Internal Server Error');
  }

  const buf: Buffer = body || Buffer.alloc(0);
  if (status !== 204 && status !== 304) {
    headers.set('Content-Length', String(buf.length));
    const tag = etag(buf);
    headers.set('ETag', tag);
    // Express answers fresh GET/HEAD requests with 304
    if ((req.method === 'GET' || req.method === 'HEAD') && status >= 200 && status < 300 && req.get('if-none-match') === tag) {
      return new Response(null, { status: 304, headers });
    }
  }
  return new Response(req.method === 'HEAD' ? null : new Uint8Array(buf), { status, headers });
}

// ─── Router (same matching as Express: registration order, case-insensitive, optional trailing slash) ───

type Route = { method: string; re: RegExp; keys: string[]; handler: Handler };

export class Router {
  routes: Route[] = [];
  private add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const pattern = path === '/' ? '' : path.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+?)'; });
    this.routes.push({ method, re: new RegExp(`^${pattern}/?$`, 'i'), keys, handler });
    return this;
  }
  get(p: string, h: Handler) { return this.add('GET', p, h); }
  post(p: string, h: Handler) { return this.add('POST', p, h); }
  put(p: string, h: Handler) { return this.add('PUT', p, h); }
  patch(p: string, h: Handler) { return this.add('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.add('DELETE', p, h); }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const m = method === 'HEAD' ? 'GET' : method;
    for (const r of this.routes) {
      if (r.method !== m) continue;
      const hit = r.re.exec(path);
      if (!hit) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        try { params[k] = decodeURIComponent(hit[i + 1]); } catch { params[k] = hit[i + 1]; }
      });
      return { handler: r.handler, params };
    }
    return null;
  }
}

// ─── Request body (express.json({ limit: '10mb' })) ───

export class BodyError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function readJsonBody(request: Request): Promise<any> {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (request.method === 'GET' || request.method === 'HEAD' || type !== 'application/json') return undefined;
  const raw = Buffer.from(await request.arrayBuffer());
  // Express in production shows only the status text on its error page
  if (raw.length > 10 * 1024 * 1024) throw new BodyError(413, 'Payload Too Large');
  if (!raw.length) return {};
  const text = raw.toString('utf8');
  // strict mode: only objects and arrays
  const first = text.trimStart()[0];
  if (first !== '{' && first !== '[') throw new BodyError(400, 'Bad Request');
  try { return JSON.parse(text); } catch { throw new BodyError(400, 'Bad Request'); }
}

// Protocol as Express sees it with `trust proxy` = true (X-Forwarded-Proto from Nginx)
export const protocolOf = (request: Request, url: URL) => {
  const fwd = request.headers.get('x-forwarded-proto');
  if (fwd) return fwd.split(',')[0].trim();
  return url.protocol.replace(':', '');
};

export function makeReq(request: Request, url: URL, mountPath: string, params: Record<string, string>, body: any): Req {
  const sub = url.pathname.slice(mountPath.length) || '/';
  return {
    method: request.method,
    url: sub + url.search,
    originalUrl: url.pathname + url.search,
    path: sub,
    params,
    query: parseQuery(url.searchParams),
    body,
    headers: request.headers,
    get: (name: string) => request.headers.get(name) ?? undefined,
    protocol: protocolOf(request, url),
  };
}
