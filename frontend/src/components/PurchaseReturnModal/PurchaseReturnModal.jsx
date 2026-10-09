import React, { useState, useEffect, useRef } from 'react';
import { Modal, Table, InputNumber, Input, Alert, Button, DatePicker, Typography } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { createPurchaseReturn, quotePurchaseReturn } from '../../api/purchases.api';
import { useFinancialMutation } from '../../hooks/useFinancialMutation.js';
import { decimal, scaled, formatted } from '../../utils/billing.calculations.js';
import { formatINR } from '../../utils/formatCurrency';
import useAuthStore from '../../store/authStore.js';

const sendReturn = (payload, key, actorId) => {
  const { purchase_id, ...body } = payload;
  return createPurchaseReturn(purchase_id, body, key, actorId);
};
const remaining = item => formatted(scaled(item.qty, 3) - scaled(item.qty_returned || '0', 3), 3);

export default function PurchaseReturnModal({ open, purchase, onClose, onSuccess }) {
  const mutation = useFinancialMutation('purchase-return', sendReturn);
  const userId = useAuthStore(state => state.user?.id);
  const { intent } = mutation;
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [returnDate, setReturnDate] = useState(dayjs());
  const [quote, setQuote] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState(null);
  const effectiveOpen = open || recoveryOpen;
  const rejectedOnOtherPurchase = intent?.status === 'rejected'
    && String(intent.payload.purchase_id) !== String(purchase?.id);
  const current = useRef();
  current.current = { purchaseId: purchase?.id, quantities, reason, returnDate, locked: mutation.locked, userId };

  useEffect(() => {
    if (effectiveOpen && !current.current.locked) {
      setQuantities({}); setReason(''); setReturnDate(dayjs()); setQuote(null); setError(null);
    }
  }, [effectiveOpen, purchase?.id, userId]);

  const close = () => { setRecoveryOpen(false); onClose(); };
  const edit = callback => { setQuote(null); setError(null); callback(); };
  const handleSubmit = async () => {
    if (intent?.status === 'completed') {
      if (await mutation.clear()) { onSuccess?.(intent.result); close(); }
      return;
    }
    if (intent?.status === 'rejected') {
      if (rejectedOnOtherPurchase) return;
      if (await mutation.clear()) {
        setQuantities(intent.snapshot?.quantities || Object.fromEntries(intent.payload.items.map(item => [item.purchase_item_id, item.qty_returned])));
        setReason(intent.payload.reason); setReturnDate(dayjs(intent.payload.return_date)); setQuote(null); setError(null);
      }
      return;
    }
    if (intent) { await mutation.run(); return; }
    setError(null);
    try {
      if (!purchase || purchase.contract_version !== 'phase3-v1') throw new Error('This original purchase needs reconciliation before stock can be returned.');
      if (!reason.trim()) throw new Error('Enter a reason for this supplier return.');
      if (!returnDate) throw new Error('Choose a return date.');
      const items = purchase.items.filter(item => scaled(quantities[item.id] || '0', 3) > 0n)
        .map(item => ({ purchase_item_id: item.id, qty_returned: decimal(quantities[item.id], 3) }));
      if (!items.length) throw new Error('Enter a return quantity for at least one original line.');
      const payload = { purchase_id: purchase.id, return_date: returnDate.format('YYYY-MM-DD'), reason: reason.trim(), items };
      if (quote) {
        await mutation.run({ ...payload, quote_hash: quote.quote_hash }, { purchase, quote, quantities });
        return;
      }
      const before = current.current;
      setReviewing(true);
      const { purchase_id, ...body } = payload;
      const response = await quotePurchaseReturn(purchase_id, body);
      const after = current.current;
      if (before.userId === after.userId && before.purchaseId === after.purchaseId && before.quantities === after.quantities && before.reason === after.reason &&
          before.returnDate === after.returnDate && !after.locked) setQuote(response.data.data);
    } catch (failure) {
      const code = failure.response?.data?.code;
      setError(code?.includes('RECONCILIATION') ? 'The original purchase or prior returns need reconciliation before another return.'
        : code === 'INSUFFICIENT_STOCK' ? 'Available base stock is below the requested return. Refresh the purchase and review quantities.'
          : failure.response?.data?.error || failure.message || 'Unable to review supplier return.');
    } finally { setReviewing(false); }
  };
  const shownPurchase = intent?.snapshot?.purchase || purchase;
  const shownQuote = intent?.snapshot?.quote || quote;
  const label = intent?.status === 'completed' ? 'Done' : intent?.status === 'rejected' ? 'Edit Rejected Supplier Return'
    : intent ? 'Retry Original Supplier Return' : quote ? 'Post Return & Create Debit Note' : 'Review Supplier Return';
  const columns = [
    { title: 'Product', dataIndex: 'product_name', render: (_, item) => item.product_name_snapshot || item.product_name },
    { title: 'Received', render: (_, item) => `${item.qty} ${item.unit}` },
    { title: 'Remaining', render: (_, item) => `${remaining(item)} ${item.unit}` },
    { title: 'Original price', render: (_, item) => `${formatINR(item.cost_price)} / ${item.unit}` },
    { title: 'Return quantity', render: (_, item) => <InputNumber aria-label={`Return quantity for line ${item.id}`} stringMode min="0" max={remaining(item)} precision={3}
      value={intent?.snapshot?.quantities?.[item.id] ?? quantities[item.id] ?? '0'} disabled={mutation.locked || mutation.busy || reviewing}
      onChange={value => edit(() => setQuantities(previous => ({ ...previous, [item.id]: value || '0' })))} /> },
  ];
  return <>
    {intent && !effectiveOpen && <Alert style={{ marginTop: 16 }} type="warning" message="A saved supplier return needs review"
      action={<Button onClick={() => setRecoveryOpen(true)}>Recover Saved Supplier Return</Button>} />}
    <Modal title={`Return Items — ${shownPurchase?.po_number || 'Saved purchase'}`} open={effectiveOpen} onCancel={close}
      onOk={handleSubmit} okText={label} width={900} destroyOnHidden={false}
      okButtonProps={{ 'aria-label': label, disabled: reviewing || mutation.busy || rejectedOnOtherPurchase || intent?.status === 'storage_error' || (!intent && !purchase), loading: reviewing || mutation.busy }}>
      {rejectedOnOtherPurchase && <Alert type="warning" showIcon style={{ marginBottom: 16 }}
        message="Open the original purchase to edit this rejected return."
        description={<Link to={`/purchases/${intent.payload.purchase_id}`}>Open original purchase</Link>} />}
      {intent && <Alert showIcon style={{ marginBottom: 16 }} type={intent.status === 'completed' ? 'success' : intent.status === 'rejected' ? 'error' : 'warning'}
        message={intent.status === 'completed' ? 'Supplier return posted' : intent.status === 'rejected' ? 'Supplier return was not posted' : 'Supplier return outcome needs confirmation'}
        description={intent.status === 'completed'
          ? `${intent.result.return_no}: ${formatINR(intent.result.total_amount)}. Debit note ${intent.result.debit_note.debit_note_no} is outstanding; no supplier settlement was recorded.`
          : `${intent.error || 'The original request is saved.'} ${intent.status === 'rejected' ? 'Review and edit before starting a new request.' : 'Retry the unchanged saved request before posting another return.'}`} />}
      {intent?.payload && <p>Saved return for <Link to={`/purchases/${intent.payload.purchase_id}`}>purchase {intent.payload.purchase_id}</Link>, actor {intent.actorId}, dated {intent.payload.return_date}.</p>}
      {intent?.payload && <p>Reason: {intent.payload.reason}</p>}
      {error && <Alert role="alert" type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {!intent && <>
        <p><strong>Supplier:</strong> {shownPurchase?.supplier_name}</p>
        <DatePicker aria-label="Supplier return date" value={returnDate} disabled={reviewing} onChange={value => edit(() => setReturnDate(value))} />
        <Input.TextArea aria-label="Supplier return reason" placeholder="Reason for supplier return (required)" value={reason}
          onChange={event => edit(() => setReason(event.target.value))} maxLength={500} rows={2} disabled={reviewing} style={{ marginTop: 12, marginBottom: 16 }} />
      </>}
      {shownPurchase && <Table columns={columns} dataSource={shownPurchase.items} rowKey="id" pagination={false} size="small" scroll={{ x: 720 }} />}
      {shownQuote && <div style={{ marginTop: 16 }}>
        <Typography.Title level={5}>Reviewed supplier credit: {formatINR(shownQuote.total_amount)}</Typography.Title>
        {shownQuote.items.map(item => <p key={item.purchase_item_id}>{item.product_name_snapshot}: {item.qty_returned} {item.unit} = {item.base_qty} {item.base_unit_snapshot} removed; {formatINR(item.amount)} from original receipt.</p>)}
        <Typography.Text type="secondary">Stock is shared across receipts. This return uses the original receipt value; it does not identify a physical lot or settle the supplier account.</Typography.Text>
      </div>}
    </Modal>
  </>;
}
