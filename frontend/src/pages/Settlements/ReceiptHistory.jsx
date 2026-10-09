import React, { useEffect, useState } from 'react';
import { Alert, Button, Space, Table } from 'antd';
import { listPayments } from '../../api/payments.api.js';
import { formatINR } from '../../utils/formatCurrency';
import { apiError } from './financeUi.js';
export default function ReceiptHistory({ customerId, locked, onReverse, refreshKey }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ payments: [], pagination: {} });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setError(null); setData({ payments: [], total: 0 });
    listPayments({ customer_id: customerId, page, limit: 20 }).then(response => { if (active) setData(response.data.data); })
      .catch(failure => { if (active) setError(apiError(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [customerId, page, refreshKey]);
  return <Space direction="vertical" style={{ width: '100%' }}>
    {error && <Alert type="error" message={error} />}
    <Table rowKey="id" size="small" loading={loading} dataSource={data.payments || []} scroll={{ x: 650 }} pagination={{ current: page, pageSize: 20, total: data.total || 0, showSizeChanger: false, onChange: setPage }} columns={[
      { title: 'Receipt', dataIndex: 'id', render: value => `#${value}` }, { title: 'Date', dataIndex: 'payment_date' },
      { title: 'Invoice', dataIndex: 'invoice_id', render: value => value ? `#${value}` : 'Unallocated advance' },
      { title: 'Amount', dataIndex: 'amount', render: formatINR }, { title: 'Mode', dataIndex: 'mode' },
      { title: 'Action', key: 'action', render: (_, row) => <Button disabled={locked} onClick={() => onReverse({ kind: 'payment_reversal', source_type: 'payment', source_id: row.id })}>Reverse receipt #{row.id}</Button> },
    ]} />
  </Space>;
}
