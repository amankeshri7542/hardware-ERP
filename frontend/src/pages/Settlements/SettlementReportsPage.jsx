import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Descriptions, Form, Input, Space, Table, Typography } from 'antd';
import { getFinanceReports } from '../../api/finance.api.js';
import { formatINR } from '../../utils/formatCurrency';
import { apiError, businessDate } from './financeUi.js';
const money = value => value == null ? '—' : formatINR(value);
export default function SettlementReportsPage() {
  const [filters, setFilters] = useState({ as_of: businessDate() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true; setLoading(true); setError(null); setData(null);
    getFinanceReports(filters).then(response => { if (active) setData(response.data.data); })
      .catch(failure => { if (active) setError(apiError(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters]);
  return <Space direction="vertical" style={{ width: '100%' }} size="middle">
    <Link to="/settlements">Back to settlements</Link><Typography.Title level={2}>Settlement reports</Typography.Title>
    <Form layout="inline" initialValues={filters} onFinish={values => setFilters(Object.fromEntries(Object.entries(values).filter(([, value]) => value)))}>
      <Form.Item name="from" label="Report from"><Input type="date" /></Form.Item><Form.Item name="to" label="Report through"><Input type="date" /></Form.Item>
      <Form.Item name="as_of" label="Report as of" rules={[{ required: true }]}><Input type="date" /></Form.Item>
      <Form.Item><Button type="primary" htmlType="submit" loading={loading}>Apply report filters</Button></Form.Item>
    </Form>
    {error && <Alert type="error" showIcon message={error} />}
    {data?.reconciliation_required && <Alert type="warning" showIcon message="The filtered records include evidence that needs reconciliation. Do not treat unknown historical evidence as a confirmed financial balance." />}
    {data && <>
      <Descriptions title={data.sales?.evidence_status === 'unverified' ? `Sales and returns — unverified (${data.sales.unverified_invoice_count} invoices)` : 'Sales and returns'} bordered column={{ xs: 1, md: 2 }} items={[
        ['gross_sales', 'Gross sales'], ['returns', 'Sales returns'], ['net_sales', 'Net sales'], ['profit', 'Profit'],
      ].map(([key, label]) => ({ key, label, children: money(data.sales?.[key]) }))} />
      <Descriptions title="Actual recorded money movements" bordered column={{ xs: 1, md: 3 }} items={[
        ['customer_collections', 'Customer receipts and advances'], ['customer_refunds', 'Customer and walk-in refunds'],
        ['supplier_payments', 'Supplier payments'], ['supplier_refunds', 'Supplier refunds received'],
        ['incoming', 'All money received'], ['outgoing', 'All money paid out'], ['net', 'Net money movement'],
      ].map(([key, label]) => ({ key, label, children: money(data.cash?.[key]) }))} />
      <Typography.Paragraph>Allocating an existing advance or credit creates no new collection, sale, or profit. Cash and noncash tender portions are reported from their recorded evidence.</Typography.Paragraph>
      <Table rowKey="mode" size="small" pagination={false} dataSource={Object.entries(data.cash?.by_mode || {}).map(([mode, amounts]) => ({ mode, ...amounts }))} columns={[
        { title: 'Mode', dataIndex: 'mode' }, { title: 'Received', dataIndex: 'incoming', render: money },
        { title: 'Paid out', dataIndex: 'outgoing', render: money }, { title: 'Net', dataIndex: 'net', render: money },
      ]} />
    </>}
    <Typography.Paragraph>For as-of aging, running balances, and a filtered CSV, open the Statement tab in a <Link to="/settlements">customer or supplier account</Link>.</Typography.Paragraph>
  </Space>;
}
