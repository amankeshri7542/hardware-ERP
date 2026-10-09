import React, { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Space, Table, Typography } from 'antd';
import { getFinanceStatement, getFinanceExport } from '../../api/finance.api.js';
import { formatINR } from '../../utils/formatCurrency';
import { apiError, businessDate } from './financeUi.js';
const money = value => value == null ? '—' : formatINR(value);
export default function StatementPanel({ domain, partyId, refreshKey }) {
  const [filters, setFilters] = useState({ as_of: businessDate() });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setError(null); setData(null);
    getFinanceStatement(domain, partyId, { ...filters, page, limit: 20 }).then(response => { if (active) setData(response.data.data); })
      .catch(failure => { if (active) setError(apiError(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [domain, partyId, filters, page, refreshKey]);
  const download = async () => {
    setExporting(true); setError(null);
    try {
      const response = await getFinanceExport({ ...filters, party_type: domain, party_id: partyId });
      if (!String(response.headers['content-type']).includes('text/csv')) throw new Error('The server did not return a CSV statement.');
      const url = URL.createObjectURL(response.data); const link = document.createElement('a');
      link.href = url; link.download = `${domain}-statement-${partyId}.csv`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) { setError(apiError(failure)); } finally { setExporting(false); }
  };
  const aging = data?.aging;
  return <Space direction="vertical" style={{ width: '100%' }} size="middle">
    <Form layout="inline" initialValues={filters} onFinish={values => { setPage(1); setFilters(Object.fromEntries(Object.entries(values).filter(([, value]) => value))); }}>
      <Form.Item name="from" label="Statement from"><Input type="date" /></Form.Item>
      <Form.Item name="to" label="Statement through"><Input type="date" /></Form.Item>
      <Form.Item name="as_of" label="Statement as of" rules={[{ required: true }]}><Input type="date" /></Form.Item>
      <Form.Item><Button type="primary" htmlType="submit">Apply statement filters</Button></Form.Item>
    </Form>
    <Button disabled={!data || loading} loading={exporting} onClick={download}>Export filtered statement CSV</Button>
    {error && <Alert type="error" showIcon message={error} />}
    {data?.reconciliation_required && <Alert type="warning" showIcon message="Some issued evidence is unknown or requires reconciliation. Those amounts are identified separately and are not treated as verified availability." />}
    {data && <>
      <Descriptions title={`Statement as of ${data.as_of}`} bordered size="small" column={{ xs: 1, md: 3 }} items={[
        { key: 'opening', label: 'Opening balance for range', children: money(data.opening_balance) },
        { key: 'debit', label: 'Debits in full filtered range', children: money(data.summary?.debit) },
        { key: 'credit', label: 'Credits in full filtered range', children: money(data.summary?.credit) },
        { key: 'closing', label: 'Closing balance for range', children: money(data.closing_balance) },
        { key: 'count', label: 'Entries in full filtered range', children: data.summary?.count },
      ]} />
      {aging && <Descriptions title="As-of aging and available sources" bordered size="small" column={{ xs: 1, md: 3 }} items={[
        ['total_due', domain === 'supplier' ? 'Total payable due' : 'Total invoice due'], ['overdue', 'Overdue'],
        ['available_credit', domain === 'supplier' ? 'Available supplier claims' : 'Available customer funds'],
        ['current', 'Current'], ['days_1_30', '1–30 days overdue'], ['days_31_60', '31–60 days overdue'],
        ['days_61_90', '61–90 days overdue'], ['over_90', 'Over 90 days overdue'], ['unknown_due_date', 'Unknown due date'],
      ].map(([key, label]) => ({ key, label, children: money(aging[key]) }))} />}
      {aging?.unknown_count > 0 && <Typography.Text type="warning">{aging.unknown_count} records have unknown issued evidence.</Typography.Text>}
      <Typography.Text type="secondary">Running balances use full effective-date history before filtering and paging. Historical party names come from issued evidence; missing snapshots remain unknown.</Typography.Text>
      <Table rowKey={row => `${row.source_type}:${row.source_id}:${row.kind}`} loading={loading} dataSource={data.rows || []} scroll={{ x: 1000 }} size="small"
        pagination={{ current: page, pageSize: 20, total: data.pagination?.total || 0, showSizeChanger: false, onChange: setPage }} columns={[
          { title: 'Effective date', dataIndex: 'date' }, { title: 'Kind', dataIndex: 'kind' },
          { title: 'Issued party name', dataIndex: 'party_name', render: value => value || 'Unknown issued identity' },
          { title: 'Original source', key: 'source', render: (_, row) => `${row.source_type} #${row.source_id}` },
          { title: 'Description', dataIndex: 'description' }, { title: 'Debit', dataIndex: 'debit', render: money },
          { title: 'Credit', dataIndex: 'credit', render: money }, { title: 'Running balance', dataIndex: 'running_balance', render: money },
        ]} />
    </>}
  </Space>;
}
