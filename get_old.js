import fs from 'fs';
console.log(fs.readFileSync('src/ai/index.js', 'utf8').substring(0, 1000));
