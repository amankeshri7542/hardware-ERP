import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Card, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { getFinanceAccount, recordCustomerSettlement, recordSupplierSettlement } from '../../api/finance.api.js';
import { useFinancialMutation } from '../../hooks/useFinancialMutation.js';
import { formatINR } from '../../utils/formatCurrency';
import SettlementDialog from './SettlementDialog.jsx';
import AdvanceDialog from './AdvanceDialog.jsx';
import ReceiptHistory from './ReceiptHistory.jsx';
import StatementPanel from './StatementPanel.jsx';
import { apiError, positive, sourceLabel } from './financeUi.js';

const money = value => value == null ? '—' : formatINR(value);
export default function PartySettlementPage({ domain }) {
  const { id } = useParams();
  const supplier = domain === 'supplier';
  const mutation = useFinancialMutation(`${domain}-settlement`, supplier ? recordSupplierSettlement : recordCustomerSettlement);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [action, setAction] = useState(null);
  const [open, setOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError(null); setAccount(null);
    try { const response = await getFinanceAccount(domain, id); if (request === generation.current) setAccount(response.data.data); }
    catch (failure) { if (request === generation.current) setError(apiError(failure)); }
    finally { if (request === generation.current) setLoading(false); }
  }, [domain, id]);
  useEffect(() => { setAccount(null); setOpen(false); setAction(null); setAdvanceOpen(false); load(); return () => { generation.current++; }; }, [load]);
  const refresh = () => { setRefreshKey(value => value + 1); load(); };
  const choose = value => { setAction(value); setOpen(true); };
  const party = account?.[domain] || { id: Number(id), name: `${supplier ? 'Supplier' : 'Customer'} #${id}` };
  const targetRows = supplier ? account?.payables || [] : account?.invoices || [];
  const disabledSource = row => mutation.locked || row.eligible === false || !positive(row.available_amount ?? row.available);
  const sourceColumns = [
    { title: 'Original source', key: 'source', render: (_, row) => `${sourceLabel(row.source_type || 'debit')} #${row.source_id || row.id}` },
    { title: 'Issued date', dataIndex: 'date' }, { title: 'Recognized', key: 'recognized', render: (_, row) => money(row.recognized_amount ?? row.amount) },
    { title: 'Available', key: 'available', render: (_, row) => money(row.available_amount ?? row.available) },
    { title: 'Eligibility', key: 'eligible', render: (_, row) => row.eligible === false ? <Tag color="orange">Evidence review required</Tag> : row.eligible === true ? 'Verified source' : 'Eligibility not confirmed' },
    { title: 'Actions', key: 'actions', render: (_, row) => <Space wrap>
      <Button disabled={disabledSource(row)} onClick={() => choose({ kind: supplier ? 'supplier_debit_application' : 'customer_allocation', source_type: row.source_type || 'debit', source_id: row.source_id || row.id })}>Allocate source #{row.source_id || row.id}</Button>
      <Button disabled={disabledSource(row)} onClick={() => choose({ kind: supplier ? 'supplier_refund' : 'customer_refund', source_type: row.source_type || 'debit', source_id: row.source_id || row.id })}>Refund source #{row.source_id || row.id}</Button>
    </Space> },
  ];
  const events = account?.events || [];
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Link to="/settlements">Back to settlements</Link>
    <div><Typography.Title level={2}>{party.name} — {supplier ? 'supplier' : 'customer'} settlement</Typography.Title><Link to={`/${domain}s/${id}`}>Open {domain} details</Link></div>
    <Space wrap><Button onClick={refresh} loading={loading}>Refresh account</Button>
      {mutation.intent && <Button type="primary" onClick={() => setOpen(true)}>Recover saved settlement</Button>}
      {!supplier && <Button onClick={() => setAdvanceOpen(true)} disabled={loading || !account}>Record customer advance</Button>}
    </Space>
    {error && <Alert type="error" showIcon message={error} />}
    {account?.reconciliation_required && <Alert type="warning" showIcon message="Some account records need an evidence review. Unverified sources cannot be settled." />}
    {loading && !account ? <Spin /> : account && <>
      <Typography.Paragraph type="secondary">Amounts owed and available sources are shown separately. Allocations do not create another receipt or automatically offset the account.</Typography.Paragraph>
      <Tabs items={[
        { key: 'balances', label: 'Balances and sources', children: <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Card title={supplier ? 'Recognized payables' : 'Customer invoices'}>
            <Table rowKey="id" size="small" dataSource={targetRows} scroll={{ x: 650 }} pagination={{ pageSize: 10 }} columns={[
              { title: supplier ? 'Payable' : 'Invoice', key: 'document', render: (_, row) => supplier ? `Payable #${row.id} / receipt #${row.purchase_id}` : <Link to={`/invoices/${row.id}`}>{row.invoice_no || `Invoice #${row.id}`}</Link> },
              { title: 'Date', dataIndex: 'date' }, { title: 'Due date', dataIndex: 'due_date', render: value => value || 'Unknown' },
              { title: 'Recognized amount', key: 'amount', render: (_, row) => money(row.amount ?? row.grand_total) },
              { title: 'Remaining due', key: 'due', render: (_, row) => money(row.due ?? row.balance_due) },
              ...(supplier ? [{ title: 'Actions', key: 'actions', render: (_, row) => <Space wrap>
                <Button disabled={mutation.locked || !positive(row.due)} onClick={() => choose({ kind: 'supplier_payment', source_type: 'payable', source_id: row.id })}>Pay payable #{row.id}</Button>
                <Button disabled={mutation.locked || row.eligible === false || row.status === 'reversed'} onClick={() => choose({ kind: 'payable_reversal', source_type: 'payable', source_id: row.id })}>Reverse payable #{row.id}</Button>
              </Space> }] : []),
            ]} />
          </Card>
          <Card title={supplier ? 'Available supplier debit notes' : 'Available advances and return credits'}><Table rowKey={row => `${row.source_type || 'debit'}:${row.source_id || row.id}`} size="small" dataSource={supplier ? account.debits || [] : account.sources || []} columns={sourceColumns} scroll={{ x: 800 }} pagination={{ pageSize: 10 }} /></Card>
          {supplier && <Card title="Stock receipts awaiting payable recognition"><Table rowKey="purchase_id" size="small" dataSource={account.receipts || []} scroll={{ x: 600 }} pagination={{ pageSize: 10 }} columns={[
            { title: 'Stock receipt', dataIndex: 'purchase_id', render: value => <Link to={`/purchases/${value}`}>Receipt #{value}</Link> }, { title: 'Date', dataIndex: 'date' }, { title: 'Receipt amount', dataIndex: 'total_amount', render: money },
            { title: 'Action', key: 'action', render: (_, row) => row.eligible === false ? <Tag color="orange">Evidence review required</Tag> : <Button disabled={mutation.locked} onClick={() => choose({ kind: 'payable_recognition', purchase_id: row.purchase_id, amount: row.total_amount })}>Recognize payable for receipt #{row.purchase_id}</Button> },
          ]} /></Card>}
        </Space> },
        { key: 'events', label: 'Settlements and reversals', children: <Table rowKey="id" size="small" dataSource={events} pagination={{ pageSize: 20 }} scroll={{ x: 750 }} columns={[
          { title: 'Entry', dataIndex: 'id', render: value => `#${value}` }, { title: 'Date', dataIndex: 'date' }, { title: 'Kind', dataIndex: 'kind' },
          { title: 'Source', key: 'source', render: (_, row) => `${sourceLabel(row.source_type)} #${row.source_id}` }, { title: 'Amount', dataIndex: 'amount', render: money }, { title: 'Reason', dataIndex: 'reason' },
          { title: 'Action', key: 'action', render: (_, row) => <Button disabled={mutation.locked || !['customer_allocation', 'customer_refund', 'supplier_payment', 'supplier_debit_application', 'supplier_refund'].includes(row.kind) || row.reversed === true} onClick={() => choose({ kind: 'reversal', source_type: 'event', source_id: row.id })}>Reverse settlement #{row.id}</Button> },
        ]} /> },
        ...(!supplier ? [{ key: 'receipts', label: 'Original customer receipts', children: <ReceiptHistory customerId={id} locked={mutation.locked} onReverse={choose} refreshKey={refreshKey} /> }] : []),
        { key: 'statement', label: 'Statement', children: <StatementPanel domain={domain} partyId={id} refreshKey={refreshKey} /> },
      ]} />
    </>}
    <SettlementDialog open={open} domain={domain} party={party} action={action} targets={targetRows} mutation={mutation} onClose={() => setOpen(false)} onSuccess={refresh} />
    {!supplier && <AdvanceDialog open={advanceOpen} party={party} onClose={() => setAdvanceOpen(false)} onSuccess={refresh} />}
  </Space>;
}
