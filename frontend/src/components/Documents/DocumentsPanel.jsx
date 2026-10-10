import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import useAuthStore from '../../store/authStore.js';
import { hasCapability } from '../../utils/access.js';
import { getDocumentCapabilities, listDocuments, sendDocumentIntent, downloadDocument } from '../../api/documents.api.js';
import { clearDocumentIntent, documentError, documentSourcePath, documentStorageKey, executeDocumentIntent, newDocumentIntent, readDocumentIntent } from './documentIntent.js';

export function useDocumentCapabilities() {
  const user=useAuthStore(state=>state.user), [result,setResult]=useState(null);
  useEffect(()=>{
    let active=true;setResult(null);
    if(hasCapability(user,'documents.read')) getDocumentCapabilities().then(({data})=>{if(active)setResult({actorId:user.id,data:data.data});}).catch(()=>{if(active)setResult({actorId:user.id,data:{enabled:false}});});
    return ()=>{active=false;};
  },[user]);
  return result?.actorId===user?.id?result?.data:null;
}
const recover=actorId=>{try{return readDocumentIntent(localStorage,actorId);}catch(error){return {status:'storage_error',error:error.message};}};
const labels={pending:'Document pending',running:'Document generating',ready:'Document ready',retryable_failure:'Document failed — retry available',permanent_failure:'Document blocked — review required'};
export default function DocumentsPanel({sourceType,sourceId,credit=false}) {
  const capabilities=useDocumentCapabilities(), user=useAuthStore(state=>state.user), actorId=user?.id;
  const [saved,setSaved]=useState(()=>({actorId,intent:recover(actorId)}));
  const intent=saved.actorId===actorId?saved.intent:recover(actorId);
  const [book,setBook]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [layout,setLayout]=useState('a4'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[asOf,setAsOf]=useState('');
  const exclusive=useRef(false);
  const view=`${actorId}:${sourceType}:${sourceId}`,currentView=useRef(view);currentView.current=view;
  const documents=book?.view===view?book.rows:[];
  useEffect(()=>{
    setSaved({actorId,intent:recover(actorId)});
    const changed=event=>{if(event.key===documentStorageKey(actorId))setSaved({actorId,intent:recover(actorId)});};
    window.addEventListener('storage',changed);return ()=>window.removeEventListener('storage',changed);
  },[actorId]);
  const refresh=useCallback(async()=>{
    setLoading(true);setError(null);
    try {const {data}=await listDocuments({source_type:sourceType,source_id:sourceId});if(currentView.current===view)setBook({view,rows:data.data.documents});}
    catch(cause){setError(documentError(cause));}
    finally{setLoading(false);}
  },[sourceType,sourceId,view]);
  useEffect(()=>{setBook(null);if(capabilities?.enabled)refresh();},[capabilities?.enabled,refresh]);
  const locked=async action=>{
    if(exclusive.current || useAuthStore.getState().user?.id!==actorId)return;
    exclusive.current=true;setBusy(true);setError(null);
    try {
      if(!navigator.locks?.request)throw new Error('This browser cannot coordinate document recovery. Use a supported secure browser.');
      await navigator.locks.request(documentStorageKey(actorId),async()=>{
        if(useAuthStore.getState().user?.id!==actorId)throw new Error('Sign in as the original account to recover this document request.');
        await action();
      });
    }catch(cause){setError(documentError(cause));}
    finally{exclusive.current=false;setBusy(false);}
  };
  const run=(operation,payload)=>locked(async()=>{
    let current=readDocumentIntent(localStorage,actorId);
    if(current && (!intent || current.key!==intent.key)){setSaved({actorId,intent:current});return;}
    if(current && ['completed','rejected'].includes(current.status)){setSaved({actorId,intent:current});return;}
    if(!current){if(!payload)throw new Error('No saved document request is available.');current=newDocumentIntent(actorId,operation,payload);}
    setSaved({actorId,intent:current});
    const result=await executeDocumentIntent(localStorage,actorId,current,sendDocumentIntent);
    setSaved({actorId,intent:result});if(result.status==='completed')await refresh();
  });
  const dismiss=()=>locked(async()=>{clearDocumentIntent(localStorage,actorId,intent);setSaved({actorId,intent:null});});
  if(!capabilities?.enabled)return null;
  const wrongSource=intent?.payload && (intent.payload.source_type!==sourceType || String(intent.payload.source_id)!==String(sourceId));
  const request=()=>run('request',{source_type:sourceType,source_id:Number(sourceId),layout,...(sourceType==='customer_statement'?{from:from||undefined,to:to||undefined,as_of:asOf}: {})});
  return <Card title={sourceType==='customer_statement'?'Statement documents':'Record documents'} style={{margin:'16px 0'}}>
    <Alert type="success" showIcon message={sourceType==='customer_statement'?'Account statement — no financial posting':'Financial record posted'} description="Document delivery is separate. Requesting, retrying or downloading a document does not repeat a sale, return or payment." style={{marginBottom:12}} />
    <Typography.Paragraph type="secondary">Issued records retain their original facts. Statements capture the selected as-of view. Download a ready version again to reprint the same content. Physical printing and statutory certification are not verified.</Typography.Paragraph>
    {error && <Alert role="alert" type="error" showIcon message="Document action failed" description={error} style={{marginBottom:12}} />}
    {intent && <Alert type={intent.status==='completed'?'success':intent.status==='rejected'?'error':'warning'} showIcon message={intent.status==='completed'?'Document request recorded':intent.status==='rejected'?'Document request rejected':'Document request needs recovery'} style={{marginBottom:12}} description={<Space direction="vertical">
      <span>{intent.error || (intent.status==='completed'?'The document job was saved. Its delivery status is listed below.':'Completion is uncertain. Keep the original key; retry only this saved document request.')}</span>
      {intent.payload && <Typography.Text>Saved source: {intent.payload.source_type} #{intent.payload.source_id}; layout {intent.payload.layout}{intent.payload.as_of?`; as of ${intent.payload.as_of}; range ${intent.payload.from || 'full history'} to ${intent.payload.to || intent.payload.as_of}`:''}.</Typography.Text>}
      {intent.key && <Typography.Text code>Document request key: {intent.key}</Typography.Text>}
      {wrongSource ? <Link to={documentSourcePath(intent.payload)}>Open original document source</Link> : ['pending','uncertain'].includes(intent.status) && <Button aria-label="Recover document request" aria-busy={busy} loading={busy} onClick={()=>run()}>Recover document request</Button>}
      {['completed','rejected'].includes(intent.status) && <Button aria-label="Dismiss document request" aria-busy={busy} loading={busy} onClick={dismiss}>Dismiss document request</Button>}
    </Space>} />}
    <Space wrap style={{marginBottom:12}}>
      <Select aria-label="Document layout" value={layout} onChange={setLayout} disabled={!!intent || busy} style={{width:170}} options={[{value:'a4',label:'A4'},...(!credit && sourceType!=='customer_statement' && capabilities.formats?.includes('thermal80')?[{value:'thermal80',label:'Thermal 80 mm'}]:[])]} />
      {sourceType==='customer_statement' && <>
        <label>Statement from <Input aria-label="Statement document from" type="date" value={from} onChange={event=>setFrom(event.target.value)} disabled={!!intent || busy} /></label>
        <label>Statement to <Input aria-label="Statement document to" type="date" value={to} onChange={event=>setTo(event.target.value)} disabled={!!intent || busy} /></label>
        <label>Statement as of <Input aria-label="Statement document as of" type="date" value={asOf} onChange={event=>setAsOf(event.target.value)} disabled={!!intent || busy} /></label>
      </>}
      <Button aria-label="Request document" aria-busy={busy} type="primary" loading={busy} disabled={!!intent || !hasCapability(user,'documents.write') || (sourceType==='customer_statement' && !asOf)} onClick={request}>Request document</Button>
      <Button aria-label="Refresh document status" aria-busy={loading} loading={loading} onClick={refresh}>Refresh document status</Button>
    </Space>
    <Table aria-label="Document versions" rowKey="id" dataSource={documents} loading={loading} pagination={false} size="small" locale={{emptyText:'No document version requested yet.'}} columns={[
      {title:'Version',render:(_,row)=><Space direction="vertical" size={0}><Typography.Text code>{row.id}</Typography.Text><span>{row.template_version} · {row.layout}</span></Space>},
      {title:'Created',dataIndex:'created_at',render:value=>value?new Date(value).toLocaleString():'Unknown'},
      {title:'Delivery',render:(_,row)=><Space direction="vertical" size={0}><Tag color={row.status==='ready'?'green':row.status.includes('failure')?'red':'gold'}>{labels[row.status]||'Unknown document status'}</Tag>{row.error_code && <Typography.Text>{row.error_code}</Typography.Text>}</Space>},
      {title:'Actions',render:(_,row)=><Space wrap>
        <Button aria-label="Download / reprint PDF" disabled={row.status!=='ready' || busy} onClick={async()=>{setError(null);try{await downloadDocument(row.id);}catch(cause){setError(documentError(cause));}}}>Download / reprint PDF</Button>
        {row.status==='retryable_failure' && <Button aria-label="Retry document delivery" aria-busy={busy} loading={busy} disabled={!!intent || !hasCapability(user,'documents.write')} onClick={()=>run('retry',{id:row.id,source_type:row.source_type,source_id:row.source_id,layout:row.layout})}>Retry document delivery</Button>}
      </Space>},
    ]} />
  </Card>;
}
