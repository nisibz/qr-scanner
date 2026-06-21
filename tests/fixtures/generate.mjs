// Generate QR code image fixtures for Playwright tests.
// Run: `npm run test:fixtures`
// Output: tests/fixtures/<name>.png
import QRCode from 'qrcode';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal 1x1 transparent PNG (no QR code) for the "no QR found" test.
const NOOP_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname);

const FIXTURES = [
  { name: 'url', text: 'https://example.com/hello' },
  { name: 'plain', text: 'Just some plain text' },
  { name: 'wifi', text: 'WIFI:S:MyNetwork;T:WPA;P:secretpass;H:false;;' },
  { name: 'email', text: 'mailto:foo@bar.com?subject=Hi&body=Hello' },
  { name: 'suspicious', text: 'http://192.168.1.1/login' },
  {
    name: 'vcard',
    text: [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Jane Doe',
      'ORG:Acme Inc',
      'TITLE:Engineer',
      'TEL:+1-555-123-4567',
      'EMAIL:jane@example.com',
      'END:VCARD',
    ].join('\r\n'),
  },
];

async function main() {
  await mkdir(outDir, { recursive: true });

  // No-QR fixture: write the tiny transparent PNG.
  const noopPath = resolve(outDir, 'noop.png');
  await writeFile(noopPath, Buffer.from(NOOP_PNG_BASE64, 'base64'));
  console.log(`wrote ${noopPath} (no-QR placeholder)`);

  for (const f of FIXTURES) {
    const buf = await QRCode.toBuffer(f.text, {
      type: 'png',
      margin: 2,
      width: 480,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    const file = resolve(outDir, `${f.name}.png`);
    await writeFile(file, buf);
    console.log(`wrote ${file} (${f.text})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
