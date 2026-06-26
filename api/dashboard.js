export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send('<html><body><h1>Test OK</h1></body></html>');
}
