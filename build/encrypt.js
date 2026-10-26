const fs=require('fs'),c=require('crypto');
const [,,inp,outp,pw,apiUrl='']=process.argv;
const salt=c.randomBytes(16), iv=c.randomBytes(12), iter=200000;
const key=c.pbkdf2Sync(pw,salt,iter,32,'sha256');
const g=c.createCipheriv('aes-256-gcm',key,iv); const ct=Buffer.concat([g.update(fs.readFileSync(inp)),g.final(),g.getAuthTag()]);
const enc={salt:salt.toString('base64'),iv:iv.toString('base64'),iter,ct:ct.toString('base64')};
const t=fs.readFileSync('dash_template.html','utf8').replace('/*__ENC__*/',JSON.stringify(enc)).replace('__API_URL__',apiUrl);
fs.writeFileSync(outp,t); console.log('encrypted',ct.length,'bytes');
