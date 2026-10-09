import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Checkbox, Descriptions, Form, Input, InputNumber, Modal, Space, Table, Typography } from 'antd';
import { getFinanceDay, quoteFinanceDay, openFinanceDay, closeFinanceDay } from '../../api/finance.api.js';
import { useFinancialMutation } from '../../hooks/useFinancialMutation.js';
import FinancialRecovery from '../../components/FinancialRecovery.jsx';
import useAuthStore from '../../store/authStore.js';
import { decimal } from '../../utils/billing.calculations.js';
import { formatINR } from '../../utils/formatCurrency';
import { apiError, businessDate } from './financeUi.js';

const money = value => value == null ? '—' : formatINR(value);
function Movements({ rows = [] }) {
  return <Table size="small" rowKey={row => `${row.source_type}:${row.source_id}:${row.tender_id}`} dataSource={rows} scroll={{ x: 700 }} pagination={{ pageSize: 20 }} columns={[
    { title: 'Business date', dataIndex: 'date' }, { title: 'Kind', dataIndex: 'kind' },
    { title: 'Original entry', key: 'source', render: (_, row) => `${row.source_type} #${row.source_id}` },
    { title: 'Mode', dataIndex: 'mode' }, { title: 'Direction', dataIndex: 'direction', render: value => value === 'in' ? 'Received' : 'Paid out' },
    { title: 'Amount', dataIndex: 'amount', render: money }, { title: 'Reference', dataIndex: 'reference_no' },
  ]} />;
}
function DayDialog({ open, kind, date, mutation, onClose, onSuccess }) {
  const [form] = Form.useForm();
  const quoteGeneration = useRef(0);
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const userId = useAuthStore(state => state.user?.id);
  const opening = kind === 'open';
  const field = opening ? 'opening_float' : 'counted_cash';
  useEffect(() => {
    if (!open || mutation.intent) return;
    setReview(null); setError(null); form.resetFields(); form.setFieldsValue({ confirmed: false });
  }, [open, kind, date, form]);
  useEffect(() => { quoteGeneration.current++; setLoading(false); return () => { quoteGeneration.current++; }; }, [open, kind, date, userId]);
  useEffect(() => setReview(null), [userId]);
  const quote = async values => {
    const actor = userId; const request = ++quoteGeneration.current; setLoading(true); setError(null);
    try {
      const payload = { date, [field]: decimal(values[field], 2), reason: values.reason.trim(), operator_confirmed: true };
      const response = await quoteFinanceDay(payload);
      if (request !== quoteGeneration.current || useAuthStore.getState().user?.id !== actor) return;
      const result = response.data.data;
      if (!result?.quote_hash || result.date !== date || result.kind !== (opening ? 'day_open' : 'day_close')) throw new Error('The server did not confirm this business day review. Reload before continuing.');
      setReview({ payload: { ...payload, quote_hash: result.quote_hash }, quote: result, formValues: values, actor });
    } catch (failure) { if (request === quoteGeneration.current) setError(apiError(failure)); } finally { if (request === quoteGeneration.current) setLoading(false); }
  };
  return <Modal title={mutation.intent ? 'Recover saved day entry' : opening ? 'Open shop day' : 'Close shop day'} open={open} onCancel={onClose} footer={null} width={850}>
    {mutation.intent ? <FinancialRecovery mutation={mutation} label={opening ? 'Day opening' : 'Day close'} savedTarget={mutation.intent.payload?.date} currentTarget={date}
      targetLabel="Saved business date" targetHref={`/settlements/day?date=${mutation.intent.payload?.date}`}
      onComplete={() => { onClose(); onSuccess(); }} onEdit={saved => { setReview(null); setError(null); form.setFieldsValue(saved.snapshot.formValues); }}>
      {mutation.intent.result?.record && <Typography.Text>Recorded {mutation.intent.result.record.kind} for {mutation.intent.result.record.date}.</Typography.Text>}
    </FinancialRecovery> : <>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {review ? <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Descriptions title={opening ? 'Review opening float' : 'Review daily close'} column={1} bordered items={[
          { key: 'date', label: 'Business date', children: review.quote.date },
          { key: 'opening', label: 'Explicit opening float', children: money(review.quote.opening_float) },
          ...(!opening ? [
            { key: 'cash-in', label: 'Cash received', children: money(review.quote.cash_in) }, { key: 'cash-out', label: 'Cash paid out', children: money(review.quote.cash_out) },
            { key: 'noncash-in', label: 'Noncash received', children: money(review.quote.noncash_in) }, { key: 'noncash-out', label: 'Noncash paid out', children: money(review.quote.noncash_out) },
            { key: 'expected', label: 'Expected closing cash', children: money(review.quote.expected_cash) }, { key: 'counted', label: 'Counted closing cash', children: money(review.quote.counted_cash) },
            { key: 'difference', label: 'Counted minus expected', children: money(review.quote.discrepancy) },
          ] : []),
          { key: 'reason', label: 'Reason', children: review.payload.reason },
        ]} />
        {!opening && <><Alert type={review.quote.discrepancy === '0.00' ? 'info' : 'warning'} showIcon message="The counted discrepancy will be recorded as reviewed. No balancing transaction is created. Posting on or before this business date will be closed." /><Movements rows={review.quote.movements} /></>}
        <Space><Button onClick={() => setReview(null)}>Back to edit</Button><Button type="primary" loading={mutation.busy} onClick={() => review.actor === userId && mutation.run(review.payload, { formValues: review.formValues })}>{opening ? 'Confirm day opening' : 'Confirm daily close'}</Button></Space>
      </Space> : <Form form={form} layout="vertical" onFinish={quote}>
        <Typography.Paragraph>Business date: {date} (Asia/Kolkata)</Typography.Paragraph>
        <Form.Item name={field} label={opening ? 'Explicit opening float' : 'Counted closing cash'} rules={[{ required: true }]}><InputNumber stringMode min="0.00" precision={2} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="reason" label={opening ? 'Opening reason' : 'Close reason'} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} /></Form.Item>
        <Form.Item name="confirmed" valuePropName="checked" rules={[{ validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error('Confirm the physical amount.')) }]}><Checkbox>{opening ? 'I confirm the explicit opening float.' : 'I confirm the cash was physically counted.'}</Checkbox></Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>{opening ? 'Review day opening' : 'Review daily close'}</Button>
      </Form>}
    </>}
  </Modal>;
}
export default function DailyClosePage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || businessDate();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState(null);
  const openingMutation = useFinancialMutation('day-open', openFinanceDay);
  const closeMutation = useFinancialMutation('day-close', closeFinanceDay);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError(null); setState(null);
    try { const response = await getFinanceDay(date); if (request === generation.current) setState(response.data.data); }
    catch (failure) { if (request === generation.current) setError(apiError(failure)); } finally { if (request === generation.current) setLoading(false); }
  }, [date]);
  useEffect(() => { setState(null); setKind(null); load(); return () => { generation.current++; }; }, [load]);
  const locked = openingMutation.locked || closeMutation.locked;
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Link to="/settlements">Back to settlements</Link><Typography.Title level={2}>Daily close</Typography.Title>
    <Space wrap><label htmlFor="finance-day">Business date (Asia/Kolkata)</label><Input id="finance-day" type="date" value={date} onChange={event => event.target.value && setParams({ date: event.target.value })} style={{ width: 170 }} /><Button loading={loading} onClick={load}>Refresh day</Button></Space>
    {error && <Alert type="error" showIcon message={error} />}
    <Space wrap>
      {openingMutation.intent && <Button onClick={() => setKind('open')}>Recover day opening</Button>}
      {closeMutation.intent && <Button onClick={() => setKind('close')}>Recover daily close</Button>}
      {state && !state.opening && !state.closed && <Button type="primary" disabled={locked} onClick={() => setKind('open')}>Open shop day</Button>}
      {state?.opening && !state.closed && <Button type="primary" disabled={locked} onClick={() => setKind('close')}>Close shop day</Button>}
    </Space>
    {state && <>
      <Alert type={state.closed ? 'success' : 'info'} showIcon message={state.closed ? `Closed business day ${date}` : state.opening ? `Open business day ${date}` : 'No opening float recorded for this date'} description={state.closed_through ? `Closed through ${state.closed_through}. New entries on or before that date are blocked.` : 'No closed-through date has been recorded.'} />
      <Descriptions bordered column={{ xs: 1, md: 2 }} items={[
        { key: 'opening', label: 'Opening float', children: money(state.opening?.opening_float) }, { key: 'expected', label: 'Expected closing cash', children: money(state.expected_cash) },
        ...(state.cash_in !== undefined ? [{ key: 'cash-in', label: 'Cash received', children: money(state.cash_in) }, { key: 'cash-out', label: 'Cash paid out', children: money(state.cash_out) }, { key: 'noncash-in', label: 'Noncash received', children: money(state.noncash_in) }, { key: 'noncash-out', label: 'Noncash paid out', children: money(state.noncash_out) }] : []),
        ...(state.closed ? [{ key: 'counted', label: 'Counted closing cash', children: money(state.closed.counted_cash) }, { key: 'discrepancy', label: 'Recorded discrepancy', children: money(state.closed.discrepancy) }, { key: 'cutoff', label: 'Recorded cutoff', children: state.closed.cutoff }] : []),
      ]} />
      <Typography.Title level={4}>Recorded money movements</Typography.Title><Movements rows={state.movements} />
    </>}
    <DayDialog open={kind !== null} kind={kind || 'open'} date={date} mutation={kind === 'close' ? closeMutation : openingMutation} onClose={() => setKind(null)} onSuccess={load} />
  </Space>;
}
