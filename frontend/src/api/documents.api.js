import api from './axios.js';
import { safeDocumentFilename } from '../components/Documents/documentIntent.js';
export const getDocumentCapabilities=()=>api.get('/documents/capabilities');
export const listDocuments=params=>api.get('/documents',{params});
export const getDocument=id=>api.get(`/documents/${encodeURIComponent(id)}`);
export const sendDocumentIntent=intent=>{
  const config={headers:{'Idempotency-Key':intent.key,'Idempotency-Actor':String(intent.actorId)}};
  return intent.operation==='retry' ? api.post(`/documents/${encodeURIComponent(intent.payload.id)}/retry`,{},config) : api.post('/documents',intent.payload,config);
};
export async function downloadDocument(id) {
  let response;
  try {response=await api.get(`/documents/${encodeURIComponent(id)}/download`,{responseType:'blob'});}
  catch(error) {
    if(error.response?.data instanceof Blob) {
      try {error.response.data=JSON.parse(await error.response.data.text());} catch { /* Keep the original failed request. */ }
    }
    throw error;
  }
  if(!String(response.headers['content-type']).startsWith('application/pdf') || !(response.data instanceof Blob) || response.data.size===0 || response.data.size>20*1024*1024 || await response.data.slice(0,5).text()!=='%PDF-') throw new Error('The download was not a valid PDF. The financial record has not changed.');
  const match=/filename="([^"\r\n]+)"/.exec(response.headers['content-disposition'] || '');
  const url=URL.createObjectURL(response.data), link=document.createElement('a');
  link.href=url;link.download=safeDocumentFilename(match?.[1]);document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
