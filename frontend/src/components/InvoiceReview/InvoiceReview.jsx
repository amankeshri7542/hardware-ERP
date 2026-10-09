import React from 'react';
import { Modal, Alert, Button, Table, Descriptions, Space, Typography } from 'antd';
import { formatINR } from '../../utils/formatCurrency';
import { moneyDifference } from '../../utils/billing.calculations.js';
export default function InvoiceReview({billing}) {
 const {review,intent,isSubmitting}=billing;
 const recovering=intent && intent.status !== 'completed';
 const quote=review?.quote;
 if(!review && !recovering) return null;
 return <Modal title={recovering ? 'Invoice recovery' : 'Review invoice totals'} open={!!review || !!recovering} footer={null} closable={false} maskClosable={false} keyboard={false} width={760}>
  {recovering ? <Space direction="vertical" style={{width:'100%'}}>
   <Alert showIcon type={intent.status==='rejected' ? 'error':'warning'} message={intent.status==='rejected' ? 'Invoice was not recorded' : 'Invoice outcome needs confirmation'}
    description={intent.status==='rejected' ? intent.error : `${intent.error || 'The original invoice request is saved.'} Keep this transaction unchanged until its outcome is confirmed. Retrying uses the same request and cannot create a second invoice.`}/>
   {intent.payload && <Typography.Text>Saved amount paid: {formatINR(intent.payload.payment.amount_paid)} · {intent.payload.bill_type}</Typography.Text>}
   {intent.status==='rejected' ? <Button onClick={billing.editRejected}>Edit and review again</Button> : intent.status!=='storage_error' && <Button type="primary" loading={isSubmitting} onClick={billing.retryInvoice}>Retry original invoice</Button>}
  </Space> : quote && <Space direction="vertical" size="middle" style={{width:'100%'}}>
   <Alert type={review.changed ? 'warning':'info'} showIcon message={review.changed ? 'Server totals differ from the draft. Review the updated amounts before confirming.' : 'These totals have been checked by the server.'}/>
   <Typography.Text>Customer: {review.snapshot.customer?.name || 'Walk-in'} · {review.payload.bill_type} · {review.payload.date}</Typography.Text>
   <Table size="small" pagination={false} rowKey={(_,index)=>index} dataSource={quote.items} columns={[
    {title:'Product',dataIndex:'product_name_snapshot'},
    {title:'Selling quantity',render:(_,item)=>`${item.qty} ${item.unit}`},
    {title:'Rate per selling unit',render:(_,item)=>formatINR(item.rate)},
    {title:'Stock quantity',render:(_,item)=>`${item.base_qty} ${item.base_unit || ''}`},
    {title:'GST',render:(_,item)=>`${item.gst_pct}% / ${formatINR(item.gst_amount)}`},
    {title:'Line total',dataIndex:'line_total',render:formatINR},
   ]}/>
   <Descriptions column={2} bordered size="small">
    <Descriptions.Item label="Grand total">{formatINR(quote.totals.grand_total)}</Descriptions.Item>
    <Descriptions.Item label="Amount paid">{formatINR(review.payload.payment.amount_paid)}</Descriptions.Item>
    <Descriptions.Item label="Balance due">{formatINR(moneyDifference(quote.totals.grand_total,review.payload.payment.amount_paid))}</Descriptions.Item>
    <Descriptions.Item label="Payment methods">{review.payload.payment.modes.map(mode=>`${mode.mode}: ${formatINR(mode.amount)}`).join(', ') || 'No payment'}</Descriptions.Item>
   </Descriptions>
   <Space><Button onClick={billing.cancelReview}>Edit draft</Button><Button type="primary" loading={isSubmitting} onClick={billing.confirmInvoice}>Confirm invoice</Button></Space>
  </Space>}
 </Modal>;
}
