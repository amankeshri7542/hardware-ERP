import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Statistic, Table, Button, Select, Switch, Space, message } from 'antd';
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
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (customerType) params.type = customerType;
      if (overdueOnly) params.overdue = true;

      const res = await getCustomerDuesReport(params);
      const result = res.data.data;
      setData(result.customers || []);
      setSummary(result.summary || null);
    } catch {
      message.error('Failed to load customer dues report');
    } finally {
      setLoading(false);
    }
  }, [customerType, overdueOnly]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {};
      if (customerType) params.type = customerType;
      if (overdueOnly) params.overdue = true;
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
      if (customerType) params.type = customerType;
      if (overdueOnly) params.overdue = true;
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
      title: 'Outstanding',
      dataIndex: 'outstanding_balance',
      key: 'outstanding_balance',
      align: 'right',
      render: (val) => formatINR(val),
      sorter: (a, b) => (a.outstanding_balance || 0) - (b.outstanding_balance || 0),
      defaultSortOrder: 'descend',
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
          <Statistic title="Total Customers" value={summary.total_customers || 0} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#fff2f0' }}>
          <Statistic
            title="Total Outstanding"
            value={summary.total_outstanding || 0}
            formatter={(val) => formatINR(val)}
            valueStyle={{ color: '#ff4d4f' }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#fff7e6' }}>
          <Statistic title="Overdue Customers" value={summary.overdue_customers || 0} valueStyle={{ color: '#fa8c16' }} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#f6ffed' }}>
          <Statistic
            title="Avg Outstanding"
            value={summary.avg_outstanding || 0}
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
        onChange={setCustomerType}
        style={{ width: 180 }}
        placeholder="Customer Type"
      >
        {TYPE_OPTIONS.map((opt) => (
          <Option key={opt.value} value={opt.value}>{opt.label}</Option>
        ))}
      </Select>
      <Space>
        <Switch checked={overdueOnly} onChange={setOverdueOnly} />
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
        summary={summaryCards}
        loading={loading}
        table={
          <Table
            dataSource={data}
            columns={columns}
            rowKey={(record) => record.id}
            size="small"
            scroll={{ x: 900 }}
            pagination={{ pageSize: 50, showTotal: (total) => `Total ${total} customers` }}
            onRow={(record) => ({ style: getRowStyle(record) })}
          />
        }
      />
    </div>
  );
}
