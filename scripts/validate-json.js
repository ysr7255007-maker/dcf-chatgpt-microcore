'use strict';
const fs = require('fs');
for (const filename of process.argv.slice(2)) JSON.parse(fs.readFileSync(filename, 'utf8'));
console.log(JSON.stringify({ ok: true, files: process.argv.slice(2) }));
