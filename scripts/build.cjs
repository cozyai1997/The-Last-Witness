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
// Practice is an explicitly local simulation; it never receives an online case.
// Keep its full rules engine in a separate global so the public online catalog
// cannot be replaced and no live server state is copied into the browser.
const engineSource = fs.readFileSync(path.join(root,'lib/party-engine.cjs'),'utf8');
if(!engineSource.includes('root.WitnessParty = api;')) throw new Error('Practice engine UMD boundary changed');
fs.writeFileSync(path.join(root,'public/practice-engine.js'),engineSource.replace('root.WitnessParty = api;','root.WitnessPracticeEngine = api;'));
const sevenSource = fs.readFileSync(path.join(root,'lib/seven-engine.cjs'),'utf8');
if(!sevenSource.includes('WitnessSevenEngine')) throw new Error('Seven-day practice boundary missing');
fs.writeFileSync(path.join(root,'public/seven-practice-engine.js'),sevenSource);
for(const file of ['seven-data.js','seven-app.js','seven-app.css','seven-practice.js','seven-practice-engine.js']) {
  if(!fs.existsSync(path.join(root,'public',file))) throw new Error('Missing seven-day file: '+file);
}
for(const file of ['index.html','online-app.js','online.css','fx.js','style.css','assets.css','party.css','party-assets.css','party-rules.html','bgm.js','practice.js','practice-engine.js','detective-options.js','case-replay.js','case-replay.css','case-interface.js','case-interface.css','case-presentation.js','case-presentation.css','fonts/handwriting.woff2','fonts/OFL.txt','audio/witness-noir-loop.mp3']) {
  if(!fs.existsSync(path.join(root,'public',file))) throw new Error('Missing public file: '+file);
}
if(fs.existsSync(path.join(root,'public','party-engine.js'))) throw new Error('Server engine must stay outside public');
console.log('Public catalog, isolated local practice engine and online assets verified. Online case state remains server-private.');
