import fs from 'node:fs';

const files = [
  'index.html', 'cotizacion.html', 'pedido.html', 'abono.html',
  'calendario.html', 'reportes.html'
];

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    const code = match[1].trim();
    if (!code) return;
    try {
      new Function(code);
    } catch (error) {
      throw new Error(`${file} inline script #${index + 1}: ${error.message}`);
    }
  });
}

console.log('HomeEasy inline JavaScript syntax smoke: PASS');
