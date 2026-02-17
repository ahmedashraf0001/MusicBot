const fs = require('fs');
const path = 'node_modules/@distube/yt-dlp/dist/index.js';
let code = fs.readFileSync(path, 'utf8');
code = code.replace(
  'JSON.parse(output)',
  'JSON.parse(output.split("\\n").filter(l => l.trim().startsWith("{") || l.trim().startsWith("[")).join("\\n"))'
);
fs.writeFileSync(path, code);
console.log('Patched! Lines replaced:', code.includes('startsWith("{")') ? 'YES' : 'NO - patch may have failed');