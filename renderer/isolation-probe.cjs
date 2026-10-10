"use strict";
const fs=require('node:fs'); const net=require('node:net');
let raw=''; process.stdin.on('data',chunk=>{raw+=chunk;if(raw.length>4096)process.exit(2);});
process.stdin.on('end',async()=>{
  const input=JSON.parse(raw);
  if(input.mode==='hang'){while(true){} }
  const result={guard:globalThis.__ERP_LOCAL_NETWORK_GUARD__===true,secretPresent:Object.keys(process.env).some(name=>/SECRET|PASSWORD|TOKEN|DB_|AWS_|COOKIE/.test(name)),readDenied:false,writeDenied:false,networkDenied:false,readError:null,writeError:null,networkError:null};
  try{fs.readFileSync(input.canary);}catch(error){result.readError=error.code;result.readDenied=['EACCES','EPERM','ENOENT'].includes(error.code);}
  try{fs.writeFileSync(input.writePath,'escape');}catch(error){result.writeError=error.code;result.writeDenied=['EACCES','EPERM','EROFS','ENOENT'].includes(error.code);}
  result.networkDenied=await new Promise(resolve=>{
    const socket=net.createConnection({host:'127.0.0.1',port:input.port});
    const timer=setTimeout(()=>{socket.destroy();resolve(true);},1000);
    socket.on('connect',()=>{clearTimeout(timer);socket.destroy();resolve(false);});
    socket.on('error',error=>{result.networkError=error.code;clearTimeout(timer);resolve(true);});
  });
  process.stdout.write(JSON.stringify(result));
});
