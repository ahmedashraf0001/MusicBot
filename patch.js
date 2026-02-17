const fs = require('fs');
const path = 'node_modules/@distube/yt-dlp/dist/index.js';
let code = fs.readFileSync(path, 'utf8');

// Fix 1: Fix JSON parsing to handle non-JSON lines in output
code = code.replace(
  'JSON.parse(output)',
  'JSON.parse(output.split("\\n").filter(l => l.trim().startsWith("{") || l.trim().startsWith("[")).join("\\n"))'
);

// Fix 2: Remove deprecated --no-call-home flag (removed in yt-dlp >=2025)
code = code.replace(/\s*noCallHome: true,/g, '');

// Fix 3: Use tv_embedded player client to bypass YouTube bot-detection on datacenter IPs.
// tv_embedded provides proper audio-only streams unlike the ios client.
// ios client only provides combined video+audio, so bestaudio fails.
code = code.replace(
  /noWarnings: true,/g,
  'noWarnings: true,\n      extractorArgs: "youtube:player_client=tv_embedded,web",'
);

// Fix 4: Use bestaudio/best — works with tv_embedded which provides audio-only streams
code = code.replace(
  /format: "ba\/ba\*"/g,
  'format: "bestaudio/best"'
);

fs.writeFileSync(path, code);
console.log('Patched! JSON fix:', code.includes('startsWith("{")') ? 'YES' : 'NO');
console.log('Patched! noCallHome removed:', !code.includes('noCallHome') ? 'YES' : 'NO');
console.log('Patched! tv_embedded client:', code.includes('player_client=tv_embedded') ? 'YES' : 'NO');
console.log('Patched! format fix:', code.includes('"bestaudio/best"') ? 'YES' : 'NO');

