import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Card, Col, Row, Select, Space, Typography } from 'antd';
import { listCustomers } from '../../api/customers.api.js';
import { getSuppliers } from '../../api/suppliers.api.js';
import { apiError } from './financeUi.js';

function AccountPicker({ party }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const response = await (party === 'customer' ? listCustomers : getSuppliers)({ search: query, limit: 100 });
        if (active) setOptions((response.data.data?.[`${party}s`] || []).map(item => ({ value: item.id, label: `${item.name} (#${item.id})` })));
      } catch (failure) { if (active) setError(apiError(failure)); }
      finally { if (active) setLoading(false); }
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [party, query]);
  return <Space direction="vertical" style={{ width: '100%' }}>
    {error && <Alert type="error" message={error} />}
    <Select aria-label={`Choose ${party} account`} placeholder={`Choose ${party} account`} showSearch filterOption={false}
      onSearch={setQuery} loading={loading} options={options} style={{ width: '100%' }} onChange={id => navigate(`/settlements/${party}/${id}`)} />
  </Space>;
}
export default function SettlementsPage() {
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    <div><Typography.Title level={2}>Settlements</Typography.Title><Typography.Paragraph>Review account balances, record confirmed money movements, allocate existing funds, and close the shop day.</Typography.Paragraph></div>
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}><Card title="Customer accounts"><Typography.Paragraph>Advances, available return credits, invoice allocations, refunds and linked reversals.</Typography.Paragraph><AccountPicker party="customer" /></Card></Col>
      <Col xs={24} lg={12}><Card title="Supplier accounts"><Typography.Paragraph>Recognized payables, payments, available debit notes, refunds and linked reversals.</Typography.Paragraph><AccountPicker party="supplier" /></Card></Col>
      <Col xs={24} md={8}><Card title="Walk-in return liabilities"><Typography.Paragraph>Refund a proven return liability against its original sale.</Typography.Paragraph><Link to="/settlements/anonymous">Open walk-in liabilities</Link></Card></Col>
      <Col xs={24} md={8}><Card title="Daily close"><Typography.Paragraph>Enter opening float, review confirmed cash movements and record the counted close.</Typography.Paragraph><Link to="/settlements/day">Open daily close</Link></Card></Col>
      <Col xs={24} md={8}><Card title="Settlement reports"><Typography.Paragraph>Review dated balances, aging and money directions. Export the same filtered dataset.</Typography.Paragraph><Link to="/settlements/reports">Open settlement reports</Link></Card></Col>
    </Row>
  </Space>;
}
