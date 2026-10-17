'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const G = require('../lib/party-engine.cjs');
const catalog = {};
for (const key of ['CATEGORIES','SUSPECTS','PLACES','ROLE_PACKS','ROLES','MAX_ROUNDS']) catalog[key] = G[key];
// Only public case possibilities and public-evidence logic ship to browsers.
const script = `(()=>{'use strict';const G=${JSON.stringify(catalog)};G.candidates=function(v){return G.SUSPECTS.flatMap(s=>G.PLACES.filter(p=>{const value=c=>{const i=G.CATEGORIES.findIndex(x=>x.id===c);return i<3?s.bits[i]:p.bits[i-3]};return v.facts.every(f=>value(f.category)===f.value)&&v.statements.filter(t=>value(t.category)!==t.value).length<=2}).map(p=>({suspectId:s.id,placeId:p.id})));};window.WitnessParty=Object.freeze(G);})();\n`;
fs.writeFileSync(path.join(root,'public/catalog.js'),script);
for(const file of ['index.html','online-app.js','online.css','fx.js','style.css','assets.css','party.css','party-assets.css','party-rules.html']) {
  if(!fs.existsSync(path.join(root,'public',file))) throw new Error('Missing public file: '+file);
}
if(fs.existsSync(path.join(root,'public','party-engine.js'))) throw new Error('Server engine must stay outside public');
console.log('Public catalog and online assets verified. Server case state remains private.');
