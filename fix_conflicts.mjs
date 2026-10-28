import { readFileSync, writeFileSync } from 'fs';
const p = 'app/api/payment/charge/route.ts';
let s = readFileSync(p, 'utf8');
s = s.replace(/<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> [^\r\n]+\r?\n?/g, (_,a,b)=> b.replace(/void e;/g,''));
writeFileSync(p, s);
