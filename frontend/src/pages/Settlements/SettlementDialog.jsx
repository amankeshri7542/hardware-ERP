import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import FinancialRecovery from '../../components/FinancialRecovery.jsx';
import useAuthStore from '../../store/authStore.js';
import { decimal } from '../../utils/billing.calculations.js';
import { formatINR } from '../../utils/formatCurrency';
import { quoteCustomerSettlement, quoteSupplierSettlement } from '../../api/finance.api.js';
import MoneyFields from './MoneyFields.jsx';
import { apiError, businessDate, settlementLabels, sourceLabel } from './financeUi.js';

const { Text } = Typography;
const cashKinds = new Set(['customer_refund', 'anonymous_refund', 'supplier_payment', 'supplier_refund']);
const allocationKinds = new Set(['customer_allocation', 'supplier_debit_application']);
const moneyRule = { required: true, message: 'Enter an amount.' };
const required = { required: true, whitespace: true, message: 'Required' };
const money = value => value == null ? '—' : formatINR(value);

export function SettlementReview({ quote, payload, partyName }) {
  const targets = quote.targets || [];
  const direction = quote.money_direction ?? quote.cash_direction;
  return <Space direction="vertical" style={{ width: '100%' }} size="middle">
    <Descriptions title="Authoritative settlement review" bordered size="small" column={1} items={[
      { key: 'action', label: 'Action', children: settlementLabels[payload.kind] },
      { key: 'party', label: 'Account', children: partyName || 'Walk-in liability — no customer account' },
      { key: 'source', label: 'Original source', children: `${sourceLabel(quote.source_type)} #${quote.source_id}` },
      { key: 'date', label: 'Business date', children: quote.date },
      { key: 'amount', label: 'Reviewed amount', children: money(quote.amount) },
      { key: 'direction', label: 'Money movement', children: !direction || direction === 'none' ? 'No money movement' : ['in','incoming'].includes(direction) ? 'Money received' : 'Money paid out' },
      ...(quote.source_available !== undefined ? [{ key: 'source-before', label: 'Source available', children: money(quote.source_available) }] : []),
      ...((quote.source?.available_amount ?? quote.source?.available) !== undefined ? [{ key: 'source-before', label: 'Source available before settlement', children: money(quote.source.available_amount ?? quote.source.available) }] : []),
      ...(quote.source?.available_after !== undefined ? [{ key: 'source-after', label: 'Source available after settlement', children: money(quote.source.available_after) }] : []),
      ...(quote.payable_due_after !== undefined ? [{ key: 'due-after', label: 'Payable due after settlement', children: money(quote.payable_due_after) }] : []),
      ...(quote.debit_available_after !== undefined ? [{ key: 'debit-after', label: 'Debit available after settlement', children: money(quote.debit_available_after) }] : []),
    ]} />
    {targets.length > 0 && <Table size="small" pagination={false} rowKey={row => row.invoice_id || row.payable_id} dataSource={targets} columns={[
      { title: 'Target document', key: 'target', render: (_, row) => row.invoice_id ? `Invoice #${row.invoice_id}` : `Payable #${row.payable_id}` },
      { title: 'Applied amount', dataIndex: 'amount', render: money },
      { title: 'Due after settlement', key: 'due', render: (_, row) => money(row.balance_due ?? row.due_after) },
    ]} />}
    {quote.tenders?.length > 0 && <Table size="small" pagination={false} rowKey={(_, index) => index} dataSource={quote.tenders} columns={[
      { title: 'Confirmed mode', dataIndex: 'mode' }, { title: 'Amount', dataIndex: 'amount', render: money }, { title: 'Reference', dataIndex: 'reference_no' },
    ]} />}
    <Text>Reason: {payload.reason}</Text>
    {['reversal', 'payment_reversal', 'payable_reversal'].includes(payload.kind) && <Alert type="warning" showIcon message="This creates a full linked reversal. The original remains in the statement; dependent settlements must be reversed separately." />}
  </Space>;
}

export default function SettlementDialog({ open, domain, party, action, targets = [], mutation, onClose, onSuccess }) {
  const [form] = Form.useForm();
  const quoteGeneration = useRef(0);
  const [quote, setQuote] = useState(null);
  const [reviewed, setReviewed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [draftAction, setDraftAction] = useState(action);
  const userId = useAuthStore(state => state.user?.id);
  const kind = draftAction?.kind;
  const supplier = domain === 'supplier';
  const targetField = supplier ? 'payable_id' : 'invoice_id';
  const allocation = allocationKinds.has(kind);
  const cash = cashKinds.has(kind);
  const recognition = kind === 'payable_recognition';
  const saved = mutation.intent;
  const savedParty = saved?.payload?.[supplier ? 'supplier_id' : 'customer_id'];
  const savedTarget = savedParty ? `${domain}:${savedParty}` : saved?.payload ? `anonymous:${saved.snapshot?.action?.liability_id || saved.payload.source_id}` : null;
  const currentTarget = party?.id ? `${domain}:${party.id}` : `anonymous:${draftAction?.liability_id || draftAction?.source_id || (!savedParty && (saved?.snapshot?.action?.liability_id || saved?.payload?.source_id)) || 'none'}`;
  const targetHref = savedParty ? `/settlements/${domain}/${savedParty}` : '/settlements/anonymous';
  useEffect(() => {
    if (!open || mutation.intent) return;
    setDraftAction(action); setQuote(null); setReviewed(null); setError(null);
    form.resetFields();
    form.setFieldsValue({ date: businessDate(), reason: '', amount: action?.amount,
      due_date: action?.due_date, operator_confirmed: false, targets: [{}], modes_detail: [{}, {}] });
  }, [open, action, form]);
  useEffect(() => { quoteGeneration.current++; setLoading(false); return () => { quoteGeneration.current++; }; }, [open, action, userId]);
  useEffect(() => { setQuote(null); setReviewed(null); }, [userId]);
  const prepare = values => {
    const payload = { kind, date: values.date, reason: values.reason.trim(), operator_confirmed: values.operator_confirmed === true };
    if (party?.id) payload[supplier ? 'supplier_id' : 'customer_id'] = Number(party.id);
    if (recognition) Object.assign(payload, { purchase_id: draftAction.purchase_id, amount: decimal(draftAction.amount, 2), due_date: values.due_date, document_reference: values.document_reference.trim() });
    else Object.assign(payload, { source_type: draftAction.source_type, source_id: draftAction.source_id });
    if (cash) payload.amount = decimal(values.amount, 2);
    if (kind === 'supplier_debit_application') payload.amount = decimal(values.targets[0].amount, 2);
    if (allocation) payload.targets = values.targets.map(target => ({ [targetField]: target[targetField], amount: decimal(target.amount, 2) }));
    if (cash) {
      payload.mode = values.mode;
      if (values.reference_no?.trim()) payload.reference_no = values.reference_no.trim();
      if (values.mode === 'mixed') payload.modes_detail = values.modes_detail.map(tender => ({ mode: tender.mode, amount: decimal(tender.amount, 2), ...(tender.reference_no?.trim() ? { reference_no: tender.reference_no.trim() } : {}) }));
    }
    return payload;
  };
  const review = async values => {
    if (mutation.locked) return;
    const actor = userId; const request = ++quoteGeneration.current;
    setLoading(true); setError(null);
    try {
      const payload = prepare(values);
      const response = await (supplier ? quoteSupplierSettlement : quoteCustomerSettlement)(payload);
      if (request !== quoteGeneration.current || useAuthStore.getState().user?.id !== actor) return;
      const result = response.data.data;
      if (!result?.quote_hash || result.kind !== payload.kind || !/^\d+\.\d{2}$/.test(result.amount)) throw new Error('The server did not provide a complete settlement review. Reload before trying again.');
      const sourceId = recognition ? payload.purchase_id : payload.source_id;
      if (String(result.source_id) !== String(sourceId) || result.source_type !== (recognition ? 'purchase' : payload.source_type) || result.date !== payload.date || String(result[supplier ? 'supplier_id' : 'customer_id'] ?? '') !== String(payload[supplier ? 'supplier_id' : 'customer_id'] ?? '')) throw new Error('The review does not match the selected original source.');
      setQuote(result); setReviewed({ payload: { ...payload, quote_hash: result.quote_hash }, formValues: values, actor });
    } catch (failure) { if (request === quoteGeneration.current) setError(apiError(failure)); }
    finally { if (request === quoteGeneration.current) setLoading(false); }
  };
  const confirm = async () => {
    if (!reviewed || reviewed.actor !== userId) return;
    await mutation.run(reviewed.payload, { formValues: reviewed.formValues, action: draftAction, partyName: party?.name, targetHref });
  };
  const editRejected = intent => {
    setDraftAction(intent.snapshot?.action || intent.payload); setQuote(null); setReviewed(null); setError(null);
    form.setFieldsValue(intent.snapshot?.formValues || intent.payload);
  };
  return <Modal title={saved ? 'Recover saved settlement' : settlementLabels[kind] || 'Settlement'} open={open} onCancel={onClose} footer={null} width={760} destroyOnHidden={false}>
    {saved ? <FinancialRecovery mutation={mutation} label={settlementLabels[saved.payload?.kind] || 'Settlement'} savedTarget={savedTarget} currentTarget={currentTarget}
      targetLabel={savedParty ? 'Saved account' : 'Saved liability'} targetHref={targetHref} onComplete={() => { onClose(); onSuccess(); }} onEdit={editRejected}>
      {saved.snapshot?.partyName && <Text>Saved account name: {saved.snapshot.partyName}</Text>}
      {saved.payload && <Text>Original source: {sourceLabel(saved.payload.source_type || 'purchase')} #{saved.payload.source_id || saved.payload.purchase_id}; date {saved.payload.date}</Text>}
      {saved.result?.record && <Text>Recorded entry #{saved.result.record.id}: {money(saved.result.record.amount)}</Text>}
    </FinancialRecovery> : <>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {quote && reviewed ? <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <SettlementReview quote={quote} payload={reviewed.payload} partyName={party?.name} />
        <Space><Button onClick={() => { setQuote(null); setReviewed(null); }}>Back to edit</Button><Button type="primary" onClick={confirm} loading={mutation.busy}>Confirm settlement</Button></Space>
      </Space> : <Form name="settlement" form={form} layout="vertical" onFinish={review}>
        <Text>Original source: {sourceLabel(draftAction?.source_type || 'purchase')} #{draftAction?.source_id || draftAction?.purchase_id}</Text>
        <Form.Item name="date" label="Settlement business date (Asia/Kolkata)" rules={[required]}><Input type="date" /></Form.Item>
        {recognition && <>
          <Descriptions size="small" items={[{ key: 'amount', label: 'Receipt amount to recognize', children: money(draftAction.amount) }]} />
          <Form.Item name="due_date" label="Supplier due date" rules={[required]}><Input type="date" /></Form.Item>
          <Form.Item name="document_reference" label="Supplier document reference" rules={[required]}><Input maxLength={200} /></Form.Item>
        </>}
        {allocation && <Form.List name="targets" rules={[{ validator: (_, values) => values?.length ? Promise.resolve() : Promise.reject(new Error('Choose a target.')) }]}>
          {(fields, { add, remove }, { errors }) => <>
            {fields.map((field, index) => <Space key={field.key} align="start" style={{ display: 'flex' }}>
              <Form.Item name={[field.name, targetField]} label={`Target ${supplier ? 'payable' : 'invoice'} ${index + 1}`} rules={[{ required: true, message: 'Choose a target.' }]} style={{ flex: 1 }}><Select aria-label={`Target ${supplier ? 'payable' : 'invoice'} ${index + 1}`} style={{ minWidth: 250 }} options={targets.map(target => ({ value: target.id, disabled: target.eligible === false, label: `${supplier ? 'Payable' : target.invoice_no || 'Invoice'} #${target.id} — due ${money(target.due ?? target.balance_due)}` }))} /></Form.Item>
              <Form.Item name={[field.name, 'amount']} label={`Allocation amount ${index + 1}`} rules={[moneyRule]}><InputNumber stringMode min="0.01" precision={2} /></Form.Item>
              {!supplier && <Button aria-label={`Remove target ${index + 1}`} icon={<DeleteOutlined />} onClick={() => remove(field.name)} style={{ marginTop: 30 }} />}
            </Space>)}
            {!supplier && <Button icon={<PlusOutlined />} onClick={() => add()}>Add invoice target</Button>}<Form.ErrorList errors={errors} />
          </>}
        </Form.List>}
        {cash && <>
          <MoneyFields form={form} amountLabel="Settlement amount" />
          <Alert type="info" showIcon message="Record money that has already been confirmed by the operator. This action does not send or verify a transfer." />
        </>}
        <Form.Item name="reason" label="Settlement reason" rules={[required]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        <Form.Item name="operator_confirmed" valuePropName="checked" rules={[{ validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error('Confirm the reviewed event before continuing.')) }]}>
          <Checkbox>I confirm this event and any actual money movement.</Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>Review settlement</Button>
      </Form>}
    </>}
  </Modal>;
}
