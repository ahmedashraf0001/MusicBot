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

// Fix 3: Use android player client — works from datacenter IPs and provides audio-only streams.
// tv_embedded doesn't provide audio-only streams, causing bestaudio to fail.
// android client provides proper webm/m4a audio-only formats without cookies.
code = code.replace(
  /noWarnings: true,/g,
  'noWarnings: true,\n      extractorArgs: "youtube:player_client=android,mweb,web",'
);

// Fix 4: Use bestaudio/best with explicit audio codec fallback
code = code.replace(
  /format: "ba\/ba\*"/g,
  'format: "bestaudio[acodec!=none]/bestaudio/best"'
);

fs.writeFileSync(path, code);
console.log('Patched! JSON fix:', code.includes('startsWith("{")') ? 'YES' : 'NO');
console.log('Patched! noCallHome removed:', !code.includes('noCallHome') ? 'YES' : 'NO');
console.log('Patched! android client:', code.includes('player_client=android') ? 'YES' : 'NO');
console.log('Patched! format fix:', code.includes('acodec!=none') ? 'YES' : 'NO');

