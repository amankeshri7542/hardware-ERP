import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Descriptions, Form, Input, Modal, Space, Table, Typography } from 'antd';
import { useFinancialMutation } from '../../hooks/useFinancialMutation.js';
import FinancialRecovery from '../../components/FinancialRecovery.jsx';
import { recordPayment } from '../../api/payments.api.js';
import { decimal } from '../../utils/billing.calculations.js';
import { formatINR } from '../../utils/formatCurrency';
import useAuthStore from '../../store/authStore.js';
import MoneyFields from './MoneyFields.jsx';
import { businessDate } from './financeUi.js';

export default function AdvanceDialog({ open, party, onClose, onSuccess }) {
  const [form] = Form.useForm();
  const mutation = useFinancialMutation('customer-advance', recordPayment);
  const [review, setReview] = useState(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const userId = useAuthStore(state => state.user?.id);
  const effectiveOpen = open || recoveryOpen;
  const close = () => { onClose(); setRecoveryOpen(false); };
  useEffect(() => {
    if (!effectiveOpen || mutation.intent) return;
    setReview(null); form.resetFields();
    form.setFieldsValue({ payment_date: businessDate(), modes_detail: [{}, {}], confirmed: false });
  }, [effectiveOpen, party.id, form]);
  useEffect(() => setReview(null), [userId]);
  const prepare = values => {
    const payload = { customer_id: Number(party.id), invoice_id: null, amount: decimal(values.amount, 2), mode: values.mode, payment_date: values.payment_date, notes: values.notes.trim() };
    if (values.reference_no?.trim()) payload.reference_no = values.reference_no.trim();
    if (values.mode === 'mixed') payload.modes_detail = values.modes_detail.map(tender => ({ mode: tender.mode, amount: decimal(tender.amount, 2), ...(tender.reference_no?.trim() ? { reference_no: tender.reference_no.trim() } : {}) }));
    setReview({ payload, formValues: values, actor: userId });
  };
  return <>
    {mutation.intent && !effectiveOpen && <Button onClick={() => setRecoveryOpen(true)}>Recover customer advance</Button>}
    <Modal title={mutation.intent ? 'Recover customer advance' : 'Record customer advance'} open={effectiveOpen} onCancel={close} footer={null} width={700}>
      {mutation.intent ? <FinancialRecovery mutation={mutation} label="Customer advance" savedTarget={mutation.intent.payload?.customer_id} currentTarget={party.id}
        targetLabel="Saved customer" targetHref={`/settlements/customer/${mutation.intent.payload?.customer_id}`}
        onComplete={() => { close(); onSuccess(); }} onEdit={saved => { setReview(null); form.setFieldsValue(saved.snapshot.formValues); }}>
        <Typography.Text>Saved customer: {mutation.intent.snapshot?.partyName}; advance {formatINR(mutation.intent.payload?.amount)}</Typography.Text>
      </FinancialRecovery> : review ? <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Descriptions title="Review advance receipt" bordered column={1} items={[
          { key: 'customer', label: 'Customer', children: party.name }, { key: 'date', label: 'Business date', children: review.payload.payment_date },
          { key: 'amount', label: 'Received amount', children: formatINR(review.payload.amount) }, { key: 'purpose', label: 'Allocation', children: 'Unallocated advance; no invoice will be settled.' },
          { key: 'reason', label: 'Reason', children: review.payload.notes },
        ]} />
        <Table size="small" pagination={false} rowKey={(_, index) => index} dataSource={review.payload.modes_detail || [{ mode: review.payload.mode, amount: review.payload.amount, reference_no: review.payload.reference_no }]} columns={[
          { title: 'Confirmed mode', dataIndex: 'mode' }, { title: 'Received amount', dataIndex: 'amount', render: formatINR }, { title: 'Reference', dataIndex: 'reference_no' },
        ]} />
        <Space><Button onClick={() => setReview(null)}>Back to edit</Button><Button type="primary" loading={mutation.busy} onClick={() => review.actor === userId && mutation.run(review.payload, { formValues: review.formValues, partyName: party.name })}>Confirm advance receipt</Button></Space>
      </Space> : <Form name="customer-advance" form={form} layout="vertical" onFinish={prepare}>
        <Alert type="info" message="Record an operator-confirmed receipt. Allocation to invoices is a separate action; this does not initiate a transfer." showIcon style={{ marginBottom: 16 }} />
        <Form.Item name="payment_date" label="Advance business date (Asia/Kolkata)" rules={[{ required: true }]}><Input type="date" /></Form.Item>
        <MoneyFields form={form} amountLabel="Advance received amount" />
        <Form.Item name="notes" label="Advance reason" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
        <Form.Item name="confirmed" valuePropName="checked" rules={[{ validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error('Confirm the received money.')) }]}><Checkbox>I confirm the customer money was received.</Checkbox></Form.Item>
        <Button type="primary" htmlType="submit">Review advance receipt</Button>
      </Form>}
    </Modal>
  </>;
}
