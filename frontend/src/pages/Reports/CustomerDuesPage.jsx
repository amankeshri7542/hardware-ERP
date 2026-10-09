import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Row, Col, Card, Statistic, Table, Button, Select, Switch, Space, message } from 'antd';
import { DownloadOutlined, FilePdfOutlined } from '@ant-design/icons';
import ReportLayout from '../../components/Reports/ReportLayout';
import { getCustomerDuesReport, exportReport, exportReportPdf } from '../../api/reports.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';

const { Option } = Select;

const TYPE_OPTIONS = [
  { label: 'All Customers', value: '' },
  { label: 'Retail', value: 'retail' },
  { label: 'Wholesale', value: 'wholesale' },
];

export default function CustomerDuesPage() {
  const navigate = useNavigate();

  const [customerType, setCustomerType] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reconciliation, setReconciliation] = useState(false);
  const generation = useRef(0);
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const fetchData = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setData([]); setSummary(null);
    try {
      const params = { page, limit: 50 };
      if (customerType) params.customerType = customerType;
      if (overdueOnly) params.overdueOnly = true;

      const res = await getCustomerDuesReport(params);
      if (request !== generation.current) return;
      const result = res.data.data;
      setTotal(result.pagination?.total || 0); setReconciliation(result.reconciliation_required === true);
      setData(result.customers || []);
      setSummary(result.summary || null);
    } catch {
      if (request === generation.current) message.error('Failed to load customer dues report');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [customerType, overdueOnly, page]);

  useEffect(() => {
    fetchData();
    return () => { generation.current++; };
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {};
      if (customerType) params.customerType = customerType;
      if (overdueOnly) params.overdueOnly = true;
      await exportReport('customer-dues', params);
      message.success('Customer dues report exported');
    } catch {
      message.error('Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const params = {};
      if (customerType) params.customerType = customerType;
      if (overdueOnly) params.overdueOnly = true;
      await exportReportPdf('customer-dues', params);
      message.success('Customer dues PDF exported');
    } catch {
      message.error('Failed to export PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const getRowStyle = (record) => {
    const balance = Number(record.outstanding_balance) || 0;
    if (balance > 50000) return { background: '#fff2f0' };
    if (balance > 20000) return { background: '#fff7e6' };
    if (balance > 5000) return { background: '#fffbe6' };
    return {};
  };

  const columns = [
    { title: 'Available customer funds', dataIndex: 'available_credit', render: value => value == null ? '—' : formatINR(value) },
    { title: 'Overdue amount', dataIndex: 'overdue_amount', render: value => value == null ? '—' : formatINR(value) },
    {
      title: 'Customer Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (text, record) => (
        <Button type="link" size="small" onClick={() => navigate(`/customers/${record.id}`)}>
          {text}
        </Button>
      ),
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (val) => val?.toUpperCase() || '\u2014',
    },
    {
      title: 'Invoice due',
      dataIndex: 'outstanding_balance',
      key: 'outstanding_balance',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'Unpaid Invoices',
      dataIndex: 'unpaid_invoice_count',
      key: 'unpaid_invoice_count',
      align: 'center',
    },
    {
      title: 'Oldest Unpaid',
      dataIndex: 'oldest_unpaid_date',
      key: 'oldest_unpaid_date',
      render: (val) => val ? formatDate(val) : '\u2014',
    },
    {
      title: 'Last Invoice',
      dataIndex: 'last_invoice_date',
      key: 'last_invoice_date',
      render: (val) => val ? formatDate(val) : '\u2014',
    },
  ];

  const summaryCards = summary ? (
    <Row gutter={[16, 16]}>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#e6f7ff' }}>
          <Statistic title="Total Customers" value={summary.count || 0} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#fff2f0' }}>
          <Statistic
            title="Invoice due"
            value={summary.total_due || 0}
            formatter={(val) => formatINR(val)}
            valueStyle={{ color: '#ff4d4f' }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#fff7e6' }}>
          <Statistic title="Overdue amount" value={summary.overdue || 0} formatter={formatINR} valueStyle={{ color: '#fa8c16' }} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#f6ffed' }}>
          <Statistic
            title="Available customer funds"
            value={summary.available_credit || 0}
            formatter={(val) => formatINR(val)}
          />
        </Card>
      </Col>
    </Row>
  ) : null;

  const filters = (
    <Space wrap>
      <Select
        value={customerType}
        onChange={value => { setPage(1); setCustomerType(value); }}
        style={{ width: 180 }}
        placeholder="Customer Type"
      >
        {TYPE_OPTIONS.map((opt) => (
          <Option key={opt.value} value={opt.value}>{opt.label}</Option>
        ))}
      </Select>
      <Space>
        <Switch checked={overdueOnly} onChange={value => { setPage(1); setOverdueOnly(value); }} />
        <span>Overdue Only</span>
      </Space>
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      <ReportLayout
        title="Customer Dues"
        exportButton={
          <>
            <Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>Export Excel</Button>
            <Button icon={<FilePdfOutlined />} disabled title="PDF exports are temporarily unavailable while safety checks are completed">PDF unavailable</Button>
          </>
        }
        filters={filters}
        summary={<>{reconciliation && <Alert type="warning" showIcon message="Some issued balances require reconciliation. Available customer funds are shown separately from invoice due." />}{summaryCards}</>}
        loading={loading}
        table={
          <Table
            dataSource={data}
            columns={columns}
            rowKey={(record) => record.id}
            size="small"
            scroll={{ x: 900 }}
            pagination={{ current: page, pageSize: 50, total, showSizeChanger: false, onChange: setPage, showTotal: value => `Total ${value} customers` }}
            onRow={(record) => ({ style: getRowStyle(record) })}
          />
        }
      />
    </div>
  );
}
