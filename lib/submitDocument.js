'use strict';
const FormData = require('form-data');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');

// Un intento nuevo necesita un stream nuevo. La clave de la selección es
// estable aunque se pierda la respuesta con el job_id o cambie la sesión.
module.exports = async function submitDocument({url,fields,filePath,mimeType,originalName,queueId}) {
  for(let i=0;;i++) {
    const form=new FormData();
    for(const [k,v] of Object.entries(fields)) if(v!==undefined && v!==null && v!=='') form.append(k,String(v));
    if(queueId) form.append('queueId',String(queueId));
    const input=fs.createReadStream(filePath);
    form.append('file',input,{filename:originalName || path.basename(filePath),contentType:mimeType || undefined});
    try { return await axios.post(url,form,{headers:form.getHeaders(),timeout:30000,maxContentLength:Infinity,maxBodyLength:Infinity}); }
    catch(e) { if(!queueId || i>=2 || (e.response && e.response.status<500)) throw e;
      await new Promise(r=>setTimeout(r,1000*(i+1)));
    } finally { input.destroy(); }
  }
};