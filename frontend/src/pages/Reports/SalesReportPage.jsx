import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Statistic, Table, Button, DatePicker, Select, Space, Tag, message } from 'antd';
import { DownloadOutlined, FilePdfOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import ReportLayout from '../../components/Reports/ReportLayout';
import { getSalesReport, exportReport, exportReportPdf } from '../../api/reports.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';

const { RangePicker } = DatePicker;
const { Option } = Select;

const BILL_TYPE_OPTIONS = [
  { label: 'All Types', value: '' },
  { label: 'Retail', value: 'retail' },
  { label: 'Wholesale', value: 'wholesale' },
  { label: 'Quick Bill', value: 'quickbill' },
];

const BILL_TYPE_COLORS = {
  retail: 'blue',
  wholesale: 'purple',
  quickbill: 'orange',
};

const STATUS_COLORS = {
  paid: 'green',
  partial: 'orange',
  unpaid: 'red',
};

export default function SalesReportPage() {
  const navigate = useNavigate();

  const [dateRange, setDateRange] = useState([dayjs().startOf('month'), dayjs()]);
  const [billType, setBillType] = useState('');
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 50, total: 0 });

  const fetchData = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = {
        from: dateRange[0].format('YYYY-MM-DD'),
        to: dateRange[1].format('YYYY-MM-DD'),
        page,
        limit: 50,
      };
      if (billType) params.bill_type = billType;

      const res = await getSalesReport(params);
      const result = res.data.data;
      setData(result.invoices || []);
      setSummary(result.summary || null);
      setPagination((prev) => ({
        ...prev,
        current: page,
        total: result.total || result.summary?.total_invoices || 0,
      }));
    } catch {
      message.error('Failed to load sales report');
    } finally {
      setLoading(false);
    }
  }, [dateRange, billType]);

  useEffect(() => {
    fetchData(1);
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {
        from: dateRange[0].format('YYYY-MM-DD'),
        to: dateRange[1].format('YYYY-MM-DD'),
      };
      if (billType) params.bill_type = billType;
      await exportReport('sales', params);
      message.success('Sales report exported');
    } catch {
      message.error('Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const params = {
        from: dateRange[0].format('YYYY-MM-DD'),
        to: dateRange[1].format('YYYY-MM-DD'),
      };
      if (billType) params.bill_type = billType;
      await exportReportPdf('sales', params);
      message.success('Sales PDF exported');
    } catch {
      message.error('Failed to export PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const columns = [
    {
      title: 'Invoice No',
      dataIndex: 'invoice_no',
      key: 'invoice_no',
      render: (text, record) => (
        <Button type="link" size="small" onClick={() => navigate(`/invoices/${record.id}`)}>
          {text}
        </Button>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      render: (val) => formatDate(val),
    },
    {
      title: 'Customer',
      dataIndex: 'customer_name',
      key: 'customer_name',
      ellipsis: true,
      render: (val) => val || 'Walk-in',
    },
    {
      title: 'Type',
      dataIndex: 'bill_type',
      key: 'bill_type',
      render: (val) => (
        <Tag color={BILL_TYPE_COLORS[val] || 'default'}>{val?.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'Total',
      dataIndex: 'grand_total',
      key: 'grand_total',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'Paid',
      dataIndex: 'amount_paid',
      key: 'amount_paid',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (val) => (
        <Tag color={STATUS_COLORS[val] || 'default'}>{val?.toUpperCase()}</Tag>
      ),
    },
  ];

  const summaryCards = summary ? (
    <Row gutter={[16, 16]}>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#e6f7ff' }}>
          <Statistic title="Total Invoices" value={summary.total_invoices || 0} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#f6ffed' }}>
          <Statistic title="Total Sales" value={summary.total_sales || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#fff7e6' }}>
          <Statistic title="Total GST" value={summary.total_gst || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#f9f0ff' }}>
          <Statistic title="Total Collected" value={summary.total_collected || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#fff2f0' }}>
          <Statistic title="Total Outstanding" value={summary.total_outstanding || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#e6fffb' }}>
          <Statistic title="Avg Profit %" value={summary.avg_profit_pct || 0} suffix="%" precision={1} />
        </Card>
      </Col>
    </Row>
  ) : null;

  const filters = (
    <Space wrap>
      <RangePicker
        value={dateRange}
        onChange={(dates) => dates && setDateRange(dates)}
        format="DD-MM-YYYY"
        allowClear={false}
      />
      <Select
        value={billType}
        onChange={setBillType}
        style={{ width: 160 }}
        placeholder="Bill Type"
      >
        {BILL_TYPE_OPTIONS.map((opt) => (
          <Option key={opt.value} value={opt.value}>{opt.label}</Option>
        ))}
      </Select>
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      <ReportLayout
        title="Sales Report"
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
            rowKey={(record) => record.id || record.invoice_no}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: pagination.total,
              showSizeChanger: false,
              showTotal: (total) => `Total ${total} invoices`,
              onChange: (page) => fetchData(page),
            }}
            size="small"
            scroll={{ x: 800 }}
          />
        }
      />
    </div>
  );
}
