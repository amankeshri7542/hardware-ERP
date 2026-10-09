import React from 'react';
import { Alert, Button, Space, Typography } from 'antd';

export default function FinancialRecovery({mutation,label,onComplete,onEdit,currentTarget,targetHref,savedTarget,targetLabel,children}) {
  const intent=mutation.intent;
  if(!intent) return null;
  const target=savedTarget ?? (intent.payload?.original_invoice_id || intent.payload?.purchase_id || intent.payload?.product_id);
  const wrongTarget=target && currentTarget!==undefined && String(target)!==String(currentTarget);
  const done=async()=>{const receipt=intent.result;if(await mutation.clear()) onComplete?.(receipt);};
  const edit=async()=>{if(wrongTarget) return;const saved=intent;if(await mutation.clear()) onEdit?.(saved);};
  return <Space direction="vertical" style={{width:'100%'}}>
    <Alert showIcon type={intent.status==='completed'?'success':intent.status==='rejected'?'error':'warning'}
      message={intent.status==='completed'?`${label} recorded`:intent.status==='rejected'?`${label} not posted`:`${label} recovery`}
      description={intent.error || (intent.status==='completed'?'The saved receipt confirms this operation.':'Completion is unknown. Retry the saved operation to recover its original result.')} />
    {target && <Typography.Text>{targetLabel || 'Saved document/product'}: {target}</Typography.Text>}
    {children}
    {intent.status==='completed' && <Button type="primary" onClick={done} disabled={mutation.busy}>Done</Button>}
    {intent.status==='rejected' && (wrongTarget ? <a href={targetHref}>Open saved document to edit</a> : <Button onClick={edit} disabled={mutation.busy}>Edit and review</Button>)}
    {['pending','uncertain'].includes(intent.status) && <Button aria-label="Retry saved operation" onClick={()=>mutation.run()} loading={mutation.busy}>Retry saved operation</Button>}
  </Space>;
}
