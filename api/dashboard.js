import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  const file = path.join(process.cwd(), 'public', 'dashboard.html');
  const html = fs.readFileSync(file, 'utf8');
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
}
