import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Card, Descriptions, Table, Tag, DatePicker, Spin,
  Typography, Row, Col, Button, Space, Statistic, Breadcrumb, message,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, DollarOutlined,
  FileTextOutlined, BookOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getCustomer, getCustomerLedger, getCustomerSummary } from '../../api/customers.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';
import CustomerFormModal from './CustomerFormModal';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const ENTRY_TYPE_COLORS = {
  invoice: 'red',
  payment: 'green',
  return: 'orange',
  adjustment: 'blue',
  advance: 'cyan',
};

const TYPE_COLORS = { retail: 'blue', wholesale: 'green', both: 'purple' };

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerPagination, setLedgerPagination] = useState({ page: 1, limit: 20, total: 0 });
  const [dateRange, setDateRange] = useState([
    dayjs().subtract(3, 'month'),
    dayjs(),
  ]);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchCustomer = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getCustomer(id);
      setCustomer(data.data);
    } catch {
      message.error('Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const { data } = await getCustomerSummary(id);
      setSummary(data.data);
    } catch {
      // Summary endpoint may not exist yet — silently fail
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [id]);

  const fetchLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      const params = {
        page: ledgerPagination.page,
        limit: ledgerPagination.limit,
      };
      if (dateRange[0]) params.from = dateRange[0].format('YYYY-MM-DD');
      if (dateRange[1]) params.to = dateRange[1].format('YYYY-MM-DD');

      const { data } = await getCustomerLedger(id, params);
      setLedger(data.data.entries);
      setLedgerPagination((prev) => ({ ...prev, total: data.data.pagination.total }));
    } catch {
      message.error('Failed to load ledger');
    } finally {
      setLedgerLoading(false);
    }
  }, [id, ledgerPagination.page, ledgerPagination.limit, dateRange]);

  useEffect(() => { fetchCustomer(); }, [fetchCustomer]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchLedger(); }, [fetchLedger]);

  const ledgerColumns = [
    {
      title: 'Date', dataIndex: 'date', key: 'date', width: 110,
      render: (v) => formatDate(v),
    },
    {
      title: 'Type', dataIndex: 'entry_type', key: 'entry_type', width: 110,
      render: (type) => (
        <Tag color={ENTRY_TYPE_COLORS[type] || 'default'}>
          {type ? type.charAt(0).toUpperCase() + type.slice(1) : '—'}
        </Tag>
      ),
    },
    {
      title: 'Reference', dataIndex: 'reference_no', key: 'reference_no', width: 140,
      render: (v) => v || '—',
    },
    {
      title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true,
    },
    {
      title: 'Debit', dataIndex: 'debit', key: 'debit', width: 130, align: 'right',
      render: (v) => {
        const amount = Number(v) || 0;
        return amount > 0 ? <span style={{ color: '#ff4d4f' }}>{formatINR(amount)}</span> : '—';
      },
    },
    {
      title: 'Credit', dataIndex: 'credit', key: 'credit', width: 130, align: 'right',
      render: (v) => {
        const amount = Number(v) || 0;
        return amount > 0 ? <span style={{ color: '#52c41a' }}>{formatINR(amount)}</span> : '—';
      },
    },
    {
      title: 'Balance at posting', dataIndex: 'balance', key: 'balance', width: 130,
      align: 'right',
      render: (v) => {
        const amount = typeof v === 'number' || (typeof v === 'string' && v.trim()) ? Number(v) : NaN;
        if (!Number.isFinite(amount)) return '—';
        return (
          <span style={{ fontWeight: 600, color: amount > 0 ? '#ff4d4f' : '#52c41a' }}>
            {formatINR(amount)}
          </span>
        );
      },
    },
  ];

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;
  }
  if (!customer) {
    return <div style={{ padding: 48 }}>Customer not found</div>;
  }

  const netAccountBalance = Number(customer.outstanding_balance) || 0;
  const creditLimit = Number(customer.credit_limit) || 0;
  const unusedCreditLimit = creditLimit - netAccountBalance;

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb style={{ marginBottom: 16 }}
        items={[
          { title: <Link to="/customers">Customers</Link> },
          { title: customer.name },
        ]}
      />

      <Link to={`/settlements/customer/${id}`} style={{ display: 'inline-block', marginBottom: 16 }}>Open customer settlements and statement</Link>
      <Row gutter={24}>
        {/* Left Panel — 65% */}
        <Col xs={24} lg={16}>
          <Card
            title={
              <Space>
                <Title level={4} style={{ margin: 0 }}>{customer.name}</Title>
                <Tag color={TYPE_COLORS[customer.type] || 'default'}>
                  {customer.type ? customer.type.charAt(0).toUpperCase() + customer.type.slice(1) : '—'}
                </Tag>
                <Tag color={customer.is_active ? 'green' : 'red'}>
                  {customer.is_active ? 'Active' : 'Inactive'}
                </Tag>
              </Space>
            }
            extra={
              <Button icon={<EditOutlined />} onClick={() => setModalOpen(true)}>
                Edit
              </Button>
            }
          >
            <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
              {customer.business_name && (
                <Descriptions.Item label="Business Name">{customer.business_name}</Descriptions.Item>
              )}
              <Descriptions.Item label="Phone">
                <span style={{ fontFamily: 'monospace' }}>{customer.phone}</span>
              </Descriptions.Item>
              {customer.alt_phone && (
                <Descriptions.Item label="Alt Phone">
                  <span style={{ fontFamily: 'monospace' }}>{customer.alt_phone}</span>
                </Descriptions.Item>
              )}
              {customer.email && (
                <Descriptions.Item label="Email">{customer.email}</Descriptions.Item>
              )}
              {customer.address && (
                <Descriptions.Item label="Address" span={2}>{customer.address}</Descriptions.Item>
              )}
              {customer.city && (
                <Descriptions.Item label="City">{customer.city}</Descriptions.Item>
              )}
              {customer.pincode && (
                <Descriptions.Item label="Pincode">{customer.pincode}</Descriptions.Item>
              )}
              {customer.gstin && (
                <Descriptions.Item label="GSTIN">
                  <span style={{ fontFamily: 'monospace' }}>{customer.gstin}</span>
                </Descriptions.Item>
              )}
              {customer.payment_terms && (
                <Descriptions.Item label="Payment Terms">{customer.payment_terms}</Descriptions.Item>
              )}
              {customer.notes && (
                <Descriptions.Item label="Notes" span={3}>{customer.notes}</Descriptions.Item>
              )}
            </Descriptions>

            <div style={{ marginTop: 16, padding: '12px 0', borderTop: '1px solid #f0f0f0' }}>
              <Row gutter={24}>
                <Col span={8}>
                  <Statistic title="Credit Limit" value={creditLimit}
                    formatter={(val) => formatINR(val)} />
                </Col>
                <Col span={8}>
                  <Statistic title="Net Account Balance" value={netAccountBalance}
                    valueStyle={{ color: netAccountBalance > 0 ? '#ff4d4f' : '#52c41a' }}
                    formatter={(val) => formatINR(val)} />
                </Col>
                <Col span={8}>
                  <Statistic title="Unused Credit Limit" value={unusedCreditLimit}
                    valueStyle={{ color: unusedCreditLimit >= 0 ? '#52c41a' : '#ff4d4f' }}
                    formatter={(val) => formatINR(val)} />
                </Col>
              </Row>
              <Text type="secondary">Net account balance includes credits. Open settlements for invoice dues and available advances or return credits.</Text>
            </div>
          </Card>
        </Col>

        {/* Right Panel — 35% */}
        <Col xs={24} lg={8}>
          <Card title="Summary" loading={summaryLoading} style={{ marginBottom: 16 }}>
            {summary ? (
              <div>
                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Statistic title="Total Invoices" value={summary.total_invoices || 0} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="Total Payments" value={summary.total_payments || 0} />
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Last Invoice</Text>
                    <div>{summary.last_invoice_date ? formatDate(summary.last_invoice_date) : '—'}</div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Last Payment</Text>
                    <div>{summary.last_payment_date ? formatDate(summary.last_payment_date) : '—'}</div>
                  </Col>
                </Row>
              </div>
            ) : (
              <Text type="secondary">No summary data available</Text>
            )}
          </Card>

          <Card title="Quick Actions">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                block
                type="primary"
                icon={<DollarOutlined />}
                onClick={() => navigate(`/settlements/customer/${id}`)}
              >
                Record advance or allocate credit
              </Button>
              <Button block icon={<FileTextOutlined />}
                onClick={() => navigate(`/invoices?customer_id=${id}`)}>
                View Invoices
              </Button>
              <Button block icon={<BookOutlined />}
                onClick={() => {
                  const el = document.getElementById('customer-ledger');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}>
                View Ledger
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* Ledger Section — full width */}
      <Card id="customer-ledger" title="Original Customer Ledger" style={{ marginTop: 24 }}>
        <p><Text type="secondary">Balances are stored at posting. </Text><Link to={`/settlements/customer/${id}`}>Open the current statement for running and as-of balances.</Link></p>
        <Space style={{ marginBottom: 16 }}>
          <RangePicker
            value={dateRange}
            onChange={(dates) => {
              setDateRange(dates || [null, null]);
              setLedgerPagination((prev) => ({ ...prev, page: 1 }));
            }}
          />
        </Space>
        <Table
          dataSource={ledger}
          columns={ledgerColumns}
          rowKey="id"
          loading={ledgerLoading}
          size="small"
          pagination={{
            current: ledgerPagination.page,
            pageSize: ledgerPagination.limit,
            total: ledgerPagination.total,
            showTotal: (total) => `${total} entries`,
            onChange: (page, pageSize) =>
              setLedgerPagination((prev) => ({ ...prev, page, limit: pageSize })),
          }}
          scroll={{ x: 900 }}
        />
      </Card>

      <CustomerFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => { fetchCustomer(); fetchSummary(); }}
        customer={customer}
      />

    </div>
  );
}
