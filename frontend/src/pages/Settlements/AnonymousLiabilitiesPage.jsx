import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Space, Table, Typography } from 'antd';
import { getAnonymousLiabilities, recordCustomerSettlement } from '../../api/finance.api.js';
import { useFinancialMutation } from '../../hooks/useFinancialMutation.js';
import { formatINR } from '../../utils/formatCurrency';
import SettlementDialog from './SettlementDialog.jsx';
import { apiError, positive } from './financeUi.js';
export default function AnonymousLiabilitiesPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(null);
  const mutation = useFinancialMutation('customer-settlement', recordCustomerSettlement);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const response = await getAnonymousLiabilities(); setRows(response.data.data.liabilities || response.data.data); }
    catch (failure) { setError(apiError(failure)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <Space direction="vertical" style={{ width: '100%' }} size="middle">
    <Link to="/settlements">Back to settlements</Link><Typography.Title level={2}>Walk-in return liabilities</Typography.Title>
    <Typography.Paragraph>Each liability remains linked to its original paid sale and return. Refunds do not create a customer account.</Typography.Paragraph>
    <Space><Button onClick={load} loading={loading}>Refresh liabilities</Button>{mutation.intent && <Button onClick={() => setOpen(true)}>Recover saved settlement</Button>}</Space>
    {error && <Alert type="error" showIcon message={error} />}
    <Table rowKey="source_id" dataSource={Array.isArray(rows) ? rows : []} loading={loading} scroll={{ x: 800 }} expandable={{ expandedRowRender: liability => <Table rowKey="id" size="small" pagination={false} dataSource={liability.events || []} columns={[
      { title: 'Settlement', dataIndex: 'id', render: value => `#${value}` }, { title: 'Date', dataIndex: 'date' }, { title: 'Kind', dataIndex: 'kind' }, { title: 'Amount', dataIndex: 'amount', render: formatINR },
      { title: 'Action', key: 'action', render: (_, event) => <Button disabled={mutation.locked || event.kind !== 'anonymous_refund' || liability.events.some(item => String(item.reverses_event_id) === String(event.id))} onClick={() => { setAction({ kind: 'reversal', source_type: 'event', source_id: event.id, liability_id: liability.source_id }); setOpen(true); }}>Reverse walk-in settlement #{event.id}</Button> },
    ]} /> }} columns={[
      { title: 'Liability', dataIndex: 'source_id', render: value => `#${value}` },
      { title: 'Original sale', key: 'sale', render: (_, row) => <Link to={`/invoices/${row.original_invoice_id}`}>{row.invoice_no || `Invoice #${row.original_invoice_id}`}</Link> },
      { title: 'Walk-in name', dataIndex: 'customer_name_walkin', render: value => value || 'Unknown issued name' },
      { title: 'Return credit', dataIndex: 'credit_invoice_id', render: value => `#${value}` }, { title: 'Date', dataIndex: 'date' },
      { title: 'Recognized', dataIndex: 'recognized_amount', render: formatINR }, { title: 'Available', dataIndex: 'available_amount', render: value => value == null ? '—' : formatINR(value) },
      { title: 'Action', key: 'action', render: (_, row) => <Button disabled={mutation.locked || row.eligible === false || !positive(row.available_amount)} onClick={() => { setAction({ kind: 'anonymous_refund', source_type: 'anonymous_liability', source_id: row.source_id }); setOpen(true); }}>Refund liability #{row.source_id}</Button> },
    ]} />
    <SettlementDialog open={open} domain="customer" action={action} mutation={mutation} onClose={() => setOpen(false)} onSuccess={load} />
  </Space>;
}
