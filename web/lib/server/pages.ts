// Serves the HTML pages the old API served (overlay, WebRTC camera/viewer pages, Swagger UI).
import fs from 'fs';
import path from 'path';
import { Handler } from './express';
import { CODE_RE } from './streamRooms';

const file = (name: string) => fs.readFileSync(path.join(process.cwd(), 'server-pages', name), 'utf8');

// GET /overlay/:code (any code; the page shows "not found" itself)
export const overlayPage: Handler = (req, res) => res.sendHtml(file('overlay.html'));

// GET /go/:code and /watch/:code (exact same checks as src/stream.js)
export const streamPage = (name: string): Handler => (req, res) => {
  if (!CODE_RE.test(req.params.code)) return res.status(404).send('Unknown match');
  res.set('Cache-Control', 'no-store');
  res.sendHtml(file(name));
};

export const docsPage: Handler = (req, res) => res.sendHtml(file('docs.html'));
