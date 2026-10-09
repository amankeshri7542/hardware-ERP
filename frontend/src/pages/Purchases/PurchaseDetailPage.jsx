import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Card, Descriptions, Table, Spin, Typography, Tag, message, Button,
  Input, Alert,
} from 'antd';
import { ArrowLeftOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { getPurchase, getPurchaseReturns, updatePurchaseNotes } from '../../api/purchases.api';
import { scaled, formatted } from '../../utils/billing.calculations.js';
import { formatINR, formatDate } from '../../utils/formatCurrency';
import PurchaseReturnModal from '../../components/PurchaseReturnModal/PurchaseReturnModal';

const { Title } = Typography;

export default function PurchaseDetailPage() {
  const { id } = useParams();
  const [purchase, setPurchase] = useState(null);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');

  const fetchPurchase = () => {
    setLoading(true);
    Promise.all([getPurchase(id), getPurchaseReturns(id)])
      .then(([receipt, returned]) => { setPurchase(receipt.data.data); setReturns(returned.data.data.returns || []); })
      .catch(() => message.error('Failed to load purchase'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPurchase();
  }, [id]);

  const handleSaveNotes = async () => {
    try {
      await updatePurchaseNotes(id, notesValue);
      message.success('Notes updated');
      setPurchase(prev => ({ ...prev, notes: notesValue }));
      setEditingNotes(false);
    } catch {
      message.error('Failed to update notes');
    }
  };

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!purchase) return <div style={{ padding: 48 }}>Purchase not found</div>;

  const columns = [
    { title: 'Product', dataIndex: 'product_name', key: 'product_name', render: (t) => <strong>{t}</strong> },
    { title: 'Selected quantity', dataIndex: 'qty', key: 'qty', width: 100, align: 'right' },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 80 },
    { title: 'Original price / unit', dataIndex: 'cost_price', key: 'cost_price', width: 150, render: (v, item) => `${formatINR(v)} / ${item.unit}`, align: 'right' },
    { title: 'Base stock received', key: 'base', render: (_, item) => item.base_unit_snapshot ? `${item.base_qty} ${item.base_unit_snapshot}` : 'Historical unit requires reconciliation' },
    { title: 'Remaining returnable', key: 'remaining', render: (_, item) => purchase.contract_version === 'phase3-v1' ? `${formatted(scaled(item.qty, 3) - scaled(item.qty_returned || '0', 3), 3)} ${item.unit}` : 'Reconciliation required' },
    { title: 'Line Total', dataIndex: 'line_total', key: 'line_total', width: 120, render: (v) => formatINR(v), align: 'right' },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Link to="/purchases"><ArrowLeftOutlined /> Back to Purchases</Link>

      <Alert
        message="Items and quantities cannot be edited after stock has been received. Create a Purchase Return if items were incorrect."
        type="info"
        showIcon
        style={{ marginTop: 16 }}
      />

      <Card style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>{purchase.po_number}</Title>
          <Button type="default" danger disabled={purchase.contract_version !== 'phase3-v1'} onClick={() => setReturnModalOpen(true)}>Create Return</Button>
        </div>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="Date">{formatDate(purchase.date)}</Descriptions.Item>
          <Descriptions.Item label="Supplier">{purchase.supplier_name}</Descriptions.Item>
          <Descriptions.Item label="Total">{formatINR(purchase.total_amount)}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color="green">{purchase.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Notes" span={3}>
            {editingNotes ? (
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input.TextArea
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  style={{ maxWidth: 400 }}
                />
                <Button type="text" icon={<CheckOutlined />} onClick={handleSaveNotes} style={{ color: '#52c41a' }} />
                <Button type="text" icon={<CloseOutlined />} onClick={() => setEditingNotes(false)} />
              </span>
            ) : (
              <span>
                {purchase.notes || <Typography.Text type="secondary">No notes</Typography.Text>}
                {' '}
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => { setNotesValue(purchase.notes || ''); setEditingNotes(true); }}
                />
              </span>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Invoice File" span={3}>
            <Alert type="warning" showIcon message="Supplier invoice attachments and downloads are temporarily unavailable while safety checks are completed." />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Items" style={{ marginTop: 16 }}>
        <Table
          dataSource={purchase.items}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
          footer={() => (
            <div style={{ textAlign: 'right', fontSize: 16 }}>
              <strong>Total: {formatINR(purchase.total_amount)}</strong>
            </div>
          )}
        />
      </Card>

      {purchase.contract_version !== 'phase3-v1' && <Alert style={{ marginTop: 16 }} type="warning" showIcon message="This historical purchase needs reconciliation before a supplier return can be posted." />}
      <Card title="Supplier returns" style={{ marginTop: 16 }}>
        <Table dataSource={returns} rowKey="id" pagination={false} size="small" onRow={record => ({ id: `supplier-return-${record.id}` })}
          columns={[
            { title: 'Return', dataIndex: 'return_no' }, { title: 'Date', dataIndex: 'date', render: formatDate },
            { title: 'Amount', dataIndex: 'total_amount', render: formatINR },
            { title: 'Stock posting', dataIndex: 'status', render: value => <Tag>{value || 'Historical'}</Tag> },
            { title: 'Debit notes', render: (_, record) => (record.debit_notes || []).map(note => <div key={note.id}><a href={`#supplier-debit-${note.id}`}>{note.debit_note_no}</a></div>) },
          ]}
          expandable={{ expandedRowRender: record => <Table dataSource={record.items} rowKey="id" pagination={false} size="small" columns={[
            { title: 'Original product', dataIndex: 'product_name' },
            { title: 'Selected returned', render: (_, item) => `${item.qty_returned} ${item.unit || ''}` },
            { title: 'Base stock removed', render: (_, item) => item.base_unit_snapshot ? `${item.base_qty} ${item.base_unit_snapshot}` : 'Historical unit unknown' },
            { title: 'Original price / unit', dataIndex: 'cost_price', render: formatINR },
            { title: 'Allocated value', dataIndex: 'amount', render: formatINR },
          ]} /> }} />
      </Card>
      <Card title="Linked supplier debit notes" style={{ marginTop: 16 }}>
        {returns.flatMap(record => (record.debit_notes || []).map(note => <p id={`supplier-debit-${note.id}`} key={note.id}>
          <strong>{note.debit_note_no}</strong> — {formatINR(note.amount)}, <Tag>{note.status}</Tag> from <a href={`#supplier-return-${record.id}`}>{record.return_no}</a>.
        </p>))}
        <Typography.Text type="secondary">Outstanding debit notes record the supplier obligation. No settlement has been recorded by these returns.</Typography.Text>
      </Card>

      <PurchaseReturnModal
        open={returnModalOpen}
        purchase={purchase}
        onClose={() => setReturnModalOpen(false)}
        onSuccess={fetchPurchase}
      />
    </div>
  );
}
