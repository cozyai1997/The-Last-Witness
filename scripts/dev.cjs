'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'../public');
const handler = require('../api/room.js');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
http.createServer(async(req,res)=>{
  const url = new URL(req.url,'http://localhost');
  if(url.pathname==='/api/room') return handler(req,res);
  const target = path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!target.startsWith(root+path.sep)) {res.writeHead(403);return res.end();}
  try {const data=await fs.promises.readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT)||4174,'127.0.0.1',()=>console.log('Last Witness online dev server: http://127.0.0.1:'+(process.env.PORT||4174)));
