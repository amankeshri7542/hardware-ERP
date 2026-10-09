import React, { useEffect, useState } from 'react';
import { Modal, Table, InputNumber, Input, Select, Typography, Alert, Button, Space } from 'antd';
import { formatINR } from '../../utils/formatCurrency';
import { processReturn, quoteReturn } from '../../api/invoices.api';
import { useFinancialMutation } from '../../hooks/useFinancialMutation.js';
import { localDate } from '../../hooks/useBilling.js';
import { decimal, scaled, formatted } from '../../utils/billing.calculations.js';
import { financialError } from '../../utils/financialIntent.js';
import FinancialRecovery from '../FinancialRecovery.jsx';

const remaining = item => Number(item.qty)>0 ? formatted(scaled(item.qty,3)-scaled(item.qty_returned||0,3),3) : '0.000';
export default function ReturnModal({invoiceId,invoice,open,onClose,onSuccess}) {
  const mutation=useFinancialMutation('sales-return',processReturn);
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [quantities,setQuantities]=useState({});
  const [reason,setReason]=useState('');
  const [returnDate,setReturnDate]=useState(localDate());
  const [disposition,setDisposition]=useState('sellable');
  const [quote,setQuote]=useState(null);
  const [draft,setDraft]=useState(null);
  const [error,setError]=useState(null);
  const [reviewing,setReviewing]=useState(false);
  useEffect(()=>{setQuote(null);setDraft(null);setQuantities({});setReason('');},[invoiceId]);
  const close=()=>{setRecoveryOpen(false);onClose();};
  const change=action=>{setQuote(null);setError(null);action();};
  const review=async()=>{
    setReviewing(true);setError(null);
    try {
      const payload={original_invoice_id:Number(invoiceId),return_date:returnDate,reason,disposition,
        items:(invoice?.items||[]).filter(item=>scaled(quantities[item.id]||0,3)>0n)
          .map(item=>({invoice_item_id:item.id,qty_returned:decimal(quantities[item.id],3)}))};
      const response=await quoteReturn(payload);
      setDraft(payload);setQuote(response.data.data);
    } catch(error) {setError(error.response?.data?.code?financialError(error.response.data.code):error.message);}
    finally {setReviewing(false);}
  };
  const restored=saved=>{
    setQuantities(Object.fromEntries(saved.payload.items.map(item=>[item.invoice_item_id,item.qty_returned])));
    setReason(saved.payload.reason);setReturnDate(saved.payload.return_date);setDisposition(saved.payload.disposition);setQuote(null);
  };
  const complete=receipt=>{setQuote(null);setQuantities({});setReason('');onSuccess?.(receipt);close();};
  const receipt=mutation.intent?.result;
  const columns=[
    {title:'Product',dataIndex:'product_name_snapshot'},
    {title:'Remaining',render:(_,item)=>`${remaining(item)} ${item.unit}`},
    {title:'Return quantity',render:(_,item)=><InputNumber aria-label={`Return quantity ${item.product_name_snapshot}`} stringMode min="0" max={remaining(item)} precision={3}
      value={quantities[item.id]||'0'} disabled={reviewing} onChange={value=>change(()=>setQuantities({...quantities,[item.id]:value||'0'}))} />},
  ];
  return <>
    {mutation.intent && !open && !recoveryOpen && <Button onClick={()=>setRecoveryOpen(true)}>Recover sales return</Button>}
    <Modal title="Process Return" open={open||recoveryOpen} onCancel={close} footer={null} width={760}>
      {mutation.intent ? <FinancialRecovery mutation={mutation} label="Sales return" onComplete={complete} onEdit={restored}
        currentTarget={invoiceId} targetHref={`/invoices/${mutation.intent.payload?.original_invoice_id}`}>
        {receipt && <Typography.Paragraph>Credit {receipt.credit_note_no || receipt.credit_note_id}: {formatINR(receipt.grand_total)}. Applied to original invoice: {formatINR(receipt.applied_amount)}. {receipt.customer_id === null ? 'Walk-in liability' : 'Unapplied customer credit'}: {formatINR(receipt.unapplied_amount)}. Remaining due: {formatINR(receipt.balance_due)}. No cash refund was made.</Typography.Paragraph>}
      </FinancialRecovery> : <Space direction="vertical" style={{width:'100%'}}>
        <Typography.Text>Original invoice: {invoice?.invoice_no}. Quantities use the original selling unit.</Typography.Text>
        <Table dataSource={invoice?.items||[]} columns={columns} rowKey="id" pagination={false} size="small" />
        <label>Return date<Input aria-label="Return date" type="date" disabled={reviewing} value={returnDate} onChange={event=>change(()=>setReturnDate(event.target.value))} /></label>
        <label>Return reason<Input aria-label="Return reason" disabled={reviewing} value={reason} onChange={event=>change(()=>setReason(event.target.value))} maxLength={500} /></label>
        <label>Condition<Select aria-label="Return condition" disabled={reviewing} value={disposition} onChange={value=>change(()=>setDisposition(value))}
          options={[{value:'sellable',label:'Sellable — restore to available stock'}]} style={{width:'100%'}} /></label>
        <Typography.Text type="secondary">Only sellable goods are supported. Record any refund separately in Settlements after the return posts.</Typography.Text>
        {error && <Alert showIcon type="error" message={error} />}
        {quote && <Alert type="info" showIcon message={`Return credit: ${formatINR(quote.grand_total)}`}
          description={<><p>Applied: {formatINR(quote.applied_amount)}. {quote.customer_id === null ? 'Walk-in liability' : 'Unapplied customer credit'}: {formatINR(quote.unapplied_amount)}. Due after return: {formatINR(quote.balance_due)}.</p>
            {quote.items.map(item=><p key={item.invoice_item_id}>{item.qty_returned} {item.unit} → {item.base_qty} {item.base_unit_snapshot} restored; {formatINR(item.line_total)} credit.</p>)}</>} />}
        <Space><Button onClick={review} loading={reviewing}>Review return</Button>
          {quote && <Button type="primary" danger onClick={()=>mutation.run({...draft,quote_hash:quote.quote_hash},{invoice_no:invoice.invoice_no,quote})}>Confirm return</Button>}</Space>
      </Space>}
    </Modal>
  </>;
}
