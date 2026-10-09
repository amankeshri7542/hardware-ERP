import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Input, Button, Tag, Radio, DatePicker, Space, Spin, Typography,
  Row, Col, Card, Tooltip, message,
} from 'antd';
import {
  SearchOutlined, EyeOutlined, DownloadOutlined,
  LoadingOutlined, WarningOutlined,
} from '@ant-design/icons';
import { listInvoices, openInvoicePdf } from '../../api/invoices.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const BILL_TYPE_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Retail', value: 'retail' },
  { label: 'Wholesale', value: 'wholesale' },
  { label: 'Quick Bill', value: 'quickbill' },
];

const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Paid', value: 'paid' },
  { label: 'Partial', value: 'partial' },
  { label: 'Unpaid', value: 'unpaid' },
];

const BILL_TYPE_COLORS = {
  retail: 'blue',
  wholesale: 'purple',
  quickbill: 'orange',
};

const STATUS_COLORS = {
  paid: 'green',
  partial: 'gold',
  unpaid: 'red',
};

const PAGE_SIZE = 20;

export default function InvoicesPage() {
  const navigate = useNavigate();

  // Filters
  const [dateRange, setDateRange] = useState(null);
  const [billType, setBillType] = useState('');
  const [status, setStatus] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [invoiceNoSearch, setInvoiceNoSearch] = useState('');
  const [debouncedInvoiceNo, setDebouncedInvoiceNo] = useState('');

  // Data
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, total: 0 });
  const [summary, setSummary] = useState({ total_sales: 0, total_gst: 0, total_profit: 0 });

  // Debounce customer search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(customerSearch), 350);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  // Debounce invoice number search — 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInvoiceNo(invoiceNoSearch), 300);
    return () => clearTimeout(timer);
  }, [invoiceNoSearch]);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        limit: PAGE_SIZE,
      };
      if (billType) params.bill_type = billType;
      if (status) params.status = status;
      if (debouncedSearch) params.customer_search = debouncedSearch;
      if (debouncedInvoiceNo) params.invoice_no = debouncedInvoiceNo;
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.date_from = dateRange[0].format('YYYY-MM-DD');
        params.date_to = dateRange[1].format('YYYY-MM-DD');
      }

      const { data } = await listInvoices(params);
      const result = data.data;
      setInvoices(result.invoices || []);
      setPagination((prev) => ({ ...prev, total: result.pagination?.total || 0 }));
      if (result.summary) {
        setSummary(result.summary);
      }
    } catch {
      message.error('Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, billType, status, debouncedSearch, debouncedInvoiceNo, dateRange]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [billType, status, debouncedSearch, debouncedInvoiceNo, dateRange]);

  const handleDownloadPdf = useCallback(async (invoiceId) => {
    try {
      await openInvoicePdf(invoiceId);
    } catch {
      message.error('Failed to download PDF');
    }
  }, []);

  const columns = useMemo(() => [
    {
      title: 'Invoice No',
      dataIndex: 'invoice_no',
      width: 140,
      render: (text, record) => (
        <a onClick={() => navigate(`/invoices/${record.id}`)} style={{ fontWeight: 600 }}>
          {text}
        </a>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'date',
      width: 110,
      render: (v) => formatDate(v),
    },
    {
      title: 'Customer',
      dataIndex: 'customer_name',
      ellipsis: true,
      render: (name, record) => name || record.customer_name_walkin || '--',
    },
    {
      title: 'Type',
      dataIndex: 'bill_type',
      width: 100,
      render: (v) => (
        <Tag color={BILL_TYPE_COLORS[v] || 'default'}>
          {v === 'quickbill' ? 'Quick Bill' : v?.charAt(0).toUpperCase() + v?.slice(1)}
        </Tag>
      ),
    },
    {
      title: 'Grand Total',
      dataIndex: 'grand_total',
      width: 120,
      align: 'right',
      render: (v) => formatINR(v),
    },
    {
      title: 'Paid',
      dataIndex: 'amount_paid',
      width: 110,
      align: 'right',
      render: (v) => formatINR(v),
    },
    {
      title: 'Balance',
      dataIndex: 'balance_due',
      width: 110,
      align: 'right',
      render: (v) => (v > 0 ? <Text type="danger">{formatINR(v)}</Text> : formatINR(0)),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      render: (v) => (
        <Tag color={STATUS_COLORS[v] || 'default'}>
          {v?.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Profit',
      dataIndex: 'profit_amount',
      width: 100,
      align: 'right',
      render: (v) => {
        if (v == null) return '--';
        const isPositive = v >= 0;
        return (
          <Text style={{ color: isPositive ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
            {isPositive ? '+' : ''}{formatINR(v)}
          </Text>
        );
      },
    },
    {
      title: 'PDF',
      dataIndex: 'pdf_status',
      width: 50,
      align: 'center',
      render: () => <Tooltip title="PDF downloads are temporarily unavailable while safety checks are completed"><Tag>Unavailable</Tag></Tooltip>,
    },
    {
      title: '',
      width: 50,
      align: 'center',
      render: (_, record) => (
        <Tooltip title="View Details">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/invoices/${record.id}`)}
          />
        </Tooltip>
      ),
    },
  ], [navigate, handleDownloadPdf]);

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 20 }}>
        <Col><Title level={3} style={{ margin: 0 }}>Invoices</Title></Col>
        <Col>
          <Space>
            <Button type="primary" onClick={() => navigate('/billing')}>
              New Invoice
            </Button>
            <Button onClick={() => navigate('/billing/quick')}>
              Quick Bill
            </Button>
          </Space>
        </Col>
      </Row>

      {/* Filters */}
                <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>        <Row gutter={[16, 12]} align="middle">
          <Col>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Invoice No..."
              value={invoiceNoSearch}
              onChange={(e) => setInvoiceNoSearch(e.target.value)}
              allowClear
              style={{ width: 180 }}
            />
          </Col>
          <Col flex="auto">
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search customer..."
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              allowClear
              style={{ maxWidth: 260 }}
            />
          </Col>
          <Col>
            <RangePicker
              value={dateRange}
              onChange={setDateRange}
              format="DD-MM-YYYY"
              allowClear
            />
          </Col>
          <Col>
            <Radio.Group
              options={BILL_TYPE_OPTIONS}
              value={billType}
              onChange={(e) => setBillType(e.target.value)}
              optionType="button"
              size="small"
            />
          </Col>
          <Col>
            <Radio.Group
              options={STATUS_OPTIONS}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              optionType="button"
              size="small"
            />
          </Col>
        </Row>
      </Card>

      {/* Summary Bar */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
                      <Card size="small" styles={{ body: { textAlign: 'center' } }}>            <Text type="secondary">Total Sales</Text>
            <Title level={4} style={{ margin: 0 }}>{formatINR(summary.total_sales)}</Title>
          </Card>
        </Col>
        <Col span={8}>
                      <Card size="small" styles={{ body: { textAlign: 'center' } }}>            <Text type="secondary">Total GST</Text>
            <Title level={4} style={{ margin: 0 }}>{formatINR(summary.total_gst)}</Title>
          </Card>
        </Col>
        <Col span={8}>
                      <Card size="small" styles={{ body: { textAlign: 'center' } }}>            <Text type="secondary">Total Profit</Text>
            <Title
              level={4}
              style={{ margin: 0, color: (summary.total_profit || 0) >= 0 ? '#52c41a' : '#ff4d4f' }}
            >
              {formatINR(summary.total_profit)}
            </Title>
          </Card>
        </Col>
      </Row>

      {/* Table */}
      <Spin spinning={loading}>
        <Table
          dataSource={invoices}
          columns={columns}
          rowKey="id"
          pagination={{
            current: pagination.page,
            pageSize: PAGE_SIZE,
            total: pagination.total,
            showTotal: (total) => `${total} invoices`,
            onChange: (page) => setPagination((prev) => ({ ...prev, page })),
            showSizeChanger: false,
          }}
          size="middle"
          scroll={{ x: 1200 }}
        />
      </Spin>
    </div>
  );
}
