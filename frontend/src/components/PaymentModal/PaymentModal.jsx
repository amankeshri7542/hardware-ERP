import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, InputNumber, Input, DatePicker, Radio, Typography, Button,
  Alert, message, Space, Row, Col, Select, Tag, Spin,
} from 'antd';
import { formatINR, formatDate } from '../../utils/formatCurrency';
import { recordPayment } from '../../api/payments.api';
import { listInvoices } from '../../api/invoices.api';
import { useFinancialMutation } from '../../hooks/useFinancialMutation.js';
import { decimal, scaled } from '../../utils/billing.calculations.js';
import { localDate } from '../../hooks/useBilling.js';

const { Text } = Typography;

const STATUS_COLORS = { unpaid: 'red', partial: 'orange' };

/**
 * PaymentModal - record a payment against an invoice or a customer.
 *
 * Props:
 *   customerId  - integer ID of the customer
 *   invoiceId   - integer ID of a specific invoice (null = let user pick from dropdown)
 *   balanceDue  - balance on the specific invoice (used only when invoiceId is pre-set)
 *   open        - modal visibility
 *   onClose     - called on cancel / close
 *   onSuccess   - called after successful payment with response data
 */
export default function PaymentModal({ customerId, invoiceId: propInvoiceId, balanceDue: propBalanceDue, open, onClose, onSuccess }) {
  const mutation=useFinancialMutation('payment',recordPayment);
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const effectiveOpen=open || recoveryOpen;
  const {intent}=mutation;
  // If invoiceId is pre-set (from Invoice Detail page), use it directly.
  // If null (from Customer Detail page), let user pick via dropdown.
  const isCustomerLevel = !propInvoiceId && !!customerId;

  const [selectedInvoiceId, setSelectedInvoiceId] = useState(propInvoiceId || null);
  const [selectedBalance, setSelectedBalance] = useState(propBalanceDue || 0);
  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState('cash');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentDate, setPaymentDate] = useState(null);
  const submitting=mutation.busy;
  const [error, setError] = useState(null);

  // The effective invoice ID and balance to use
  const effectiveInvoiceId = propInvoiceId || selectedInvoiceId;
  const effectiveBalance = propInvoiceId ? propBalanceDue : selectedBalance;

  // Fetch unpaid invoices when modal opens in customer-level mode
  useEffect(() => {
    if (effectiveOpen && isCustomerLevel && customerId) {
      setInvoicesLoading(true);
      Promise.all([
        listInvoices({ customer_id: customerId, status: 'unpaid', limit: 50 }),
        listInvoices({ customer_id: customerId, status: 'partial', limit: 50 }),
      ])
        .then(([unpaidRes, partialRes]) => {
          const all = [
            ...(unpaidRes.data.data?.invoices || []),
            ...(partialRes.data.data?.invoices || []),
          ];
          // Sort oldest first
          all.sort((a, b) => new Date(a.date) - new Date(b.date));
          setUnpaidInvoices(all);
        })
        .catch(() => setUnpaidInvoices([]))
        .finally(() => setInvoicesLoading(false));
    }
  }, [effectiveOpen, isCustomerLevel, customerId]);

  // Reset state when modal opens
  useEffect(() => {
    if (effectiveOpen && !mutation.locked) {
      setSelectedInvoiceId(propInvoiceId || null);
      setSelectedBalance(propBalanceDue || 0);
      setAmount(propInvoiceId ? (propBalanceDue || 0) : 0);
      setMode('cash');
      setReferenceNo('');
      setNotes('');
      setPaymentDate(null);
      setError(null);
    }
  }, [effectiveOpen, propInvoiceId, propBalanceDue, mutation.locked]);

  // When user selects an invoice from the dropdown, update balance and amount
  const handleInvoiceSelect = useCallback((invoiceId) => {
    setSelectedInvoiceId(invoiceId);
    const inv = unpaidInvoices.find((i) => i.id === invoiceId);
    if (inv) {
      const bal = inv.balance_due || '0.00';
      setSelectedBalance(bal);
      setAmount(bal); // pre-fill with full balance
    } else {
      setSelectedBalance(0);
      setAmount(0);
    }
  }, [unpaidInvoices]);

  const close = () => { setRecoveryOpen(false); onClose(); };
  const handleSubmit = async () => {
    if(intent?.status==='completed') {
      if(await mutation.clear()) { onSuccess?.(intent.result); close(); }
      return;
    }
    if(intent?.status==='rejected') { if(await mutation.clear()) setError(null); return; }
    if(intent) { await mutation.run(); return; }
    setError(null);
    try {
      const exactAmount=decimal(amount);
      if(scaled(exactAmount)<=0n) throw new Error('Enter a positive payment amount');
      if(isCustomerLevel && !selectedInvoiceId) throw new Error('Select the invoice for this payment');
      if(effectiveInvoiceId && scaled(exactAmount)>scaled(effectiveBalance)) throw new Error('Amount exceeds the invoice balance. Refresh and review it.');
      const payload={customer_id:customerId,invoice_id:effectiveInvoiceId || null,amount:exactAmount,mode,payment_date:paymentDate ? paymentDate.format('YYYY-MM-DD') : localDate()};
      if(referenceNo) payload.reference_no=referenceNo;
      if(notes) payload.notes=notes;
      await mutation.run(payload,{amount:exactAmount,mode,customerId,invoiceId:effectiveInvoiceId});
    } catch(error) {setError(error.message || 'Check the payment details');}
  };
  const label=intent?.status==='completed' ? 'Done' : intent?.status==='rejected' ? 'Edit rejected payment' : intent ? 'Retry original payment' : 'Record Payment';

  return (<>
    {intent && !effectiveOpen && <Alert style={{marginTop:16}} type="warning" message="A saved payment needs review" action={<Button onClick={()=>setRecoveryOpen(true)}>Recover saved payment</Button>}/>}
    <Modal
      title="Record Payment"
      open={effectiveOpen}
      onCancel={close}
      onOk={handleSubmit}
      okText={label}
      okButtonProps={{ 'aria-label': label, 'aria-busy': submitting, disabled: submitting || intent?.status==='storage_error' || (!intent && !amount), loading: submitting }}
      confirmLoading={submitting}
      destroyOnHidden
      width={520}
    >
      {intent && <Alert style={{marginBottom:16}} showIcon type={intent.status==='completed' ? 'success' : intent.status==='rejected' ? 'error' : 'warning'}
        message={intent.status==='completed' ? 'Payment recorded' : intent.status==='rejected' ? 'Payment was not recorded' : 'Payment outcome needs confirmation'}
        description={intent.status==='completed' ? `Receipt ${intent.result.id}: ${formatINR(intent.result.amount)}. Customer outstanding at receipt: ${formatINR(intent.result.outstanding_balance)}${intent.result.invoice_balance_due != null ? `. Invoice balance at receipt: ${formatINR(intent.result.invoice_balance_due)}` : ''}`
          : `${intent.error || 'The original request is saved.'} ${intent.status==='rejected' ? 'Edit the payment before sending a new request.' : 'Retry the unchanged saved request to confirm the outcome before recording another payment.'}`}/>}
      {intent?.payload && <Text>Saved payment: customer {intent.payload.customer_id}, invoice {intent.payload.invoice_id || 'advance'}, {formatINR(intent.payload.amount)} via {intent.payload.mode}</Text>}
      {error && (
        <Alert
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <fieldset disabled={mutation.locked} style={{border:0,padding:0,margin:0}}><Space direction="vertical" size="middle" style={{ width: '100%' }}>

        {/* ── Invoice Selector (only shown when opened from Customer page) ── */}
        {isCustomerLevel && (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              Apply to Invoice <Text type="danger">*</Text>
            </Text>
            {invoicesLoading ? (
              <Spin size="small" />
            ) : unpaidInvoices.length === 0 ? (
              <Alert
                type="info"
                message="No unpaid or partial invoices found for this customer."
                showIcon
                style={{ marginBottom: 0 }}
              />
            ) : (
              <Select
                disabled={mutation.locked}
                style={{ width: '100%' }}
                placeholder="Select unpaid invoice..."
                value={selectedInvoiceId}
                onChange={handleInvoiceSelect}
                size="large"
                optionLabelProp="label"
              >
                {unpaidInvoices.map((inv) => (
                  <Select.Option
                    key={inv.id}
                    value={inv.id}
                    label={`${inv.invoice_no} — ${formatINR(inv.balance_due)} due`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Text strong>{inv.invoice_no}</Text>
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                          {formatDate(inv.date)}
                        </Text>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <Text style={{ color: '#ff4d4f', fontWeight: 600 }}>
                          {formatINR(inv.balance_due)} due
                        </Text>
                        <Tag color={STATUS_COLORS[inv.status]} style={{ marginLeft: 8, fontSize: 11 }}>
                          {inv.status?.toUpperCase()}
                        </Tag>
                      </div>
                    </div>
                  </Select.Option>
                ))}
              </Select>
            )}
          </div>
        )}

        {/* ── Balance info ── */}
        <div style={{
          background: effectiveInvoiceId ? '#f6ffed' : '#fffbe6',
          border: `1px solid ${effectiveInvoiceId ? '#b7eb8f' : '#ffe58f'}`,
          borderRadius: 6,
          padding: '8px 12px',
        }}>
          <Text type="secondary">
            {effectiveInvoiceId ? 'Invoice Balance Due: ' : 'Customer Total Outstanding: '}
          </Text>
          <Text strong style={{ fontSize: 16 }}>
            {formatINR(effectiveBalance)}
          </Text>
        </div>

        {/* ── Amount ── */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Amount</Text>
          <InputNumber
              stringMode
              disabled={mutation.locked}
            value={amount}
            onChange={setAmount}
            min={0.01}
            max={effectiveInvoiceId ? effectiveBalance : undefined}
            precision={2}
            style={{ width: '100%' }}
            size="large"
            prefix="Rs."
            onFocus={(e) => e.target.select()}
            autoFocus
          />
        </div>

        {/* ── Payment mode ── */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Payment Mode</Text>
          <Radio.Group disabled={mutation.locked} value={mode} onChange={(e) => setMode(e.target.value)}>
            <Radio.Button value="cash">Cash</Radio.Button>
            <Radio.Button value="upi">UPI</Radio.Button>
            <Radio.Button value="bank">Bank</Radio.Button>
            <Radio.Button value="cheque">Cheque</Radio.Button>
          </Radio.Group>
        </div>

        {/* ── Date + Reference ── */}
        <Row gutter={16}>
          <Col span={12}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Date</Text>
            <DatePicker
                disabled={mutation.locked}
              value={paymentDate}
              onChange={setPaymentDate}
              style={{ width: '100%' }}
              placeholder="Today"
              format="DD-MM-YYYY"
            />
          </Col>
          <Col span={12}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Reference No</Text>
            <Input
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder="Txn / Cheque No"
              maxLength={50}
            />
          </Col>
        </Row>

        {/* ── Notes ── */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Notes</Text>
          <Input.TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
            rows={2}
            maxLength={200}
          />
        </div>
      </Space></fieldset>
    </Modal></>
  );
}
