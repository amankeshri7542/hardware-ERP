import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Row, Col, Card, Statistic, Table, Button, DatePicker, Select, Space, Tag, message } from 'antd';
import { DownloadOutlined, FilePdfOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import ReportLayout from '../../components/Reports/ReportLayout';
import { getCollectionsReport, exportReport, exportReportPdf } from '../../api/reports.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';

const { RangePicker } = DatePicker;
const { Option } = Select;

const MODE_OPTIONS = [
  { label: 'All Modes', value: '' },
  { label: 'Cash', value: 'cash' },
  { label: 'UPI', value: 'upi' },
  { label: 'Bank', value: 'bank' },
  { label: 'Cheque', value: 'cheque' },
];

const MODE_COLORS = {
  cash: 'green',
  upi: 'blue',
  bank: 'purple',
  cheque: 'orange',
  mixed: 'magenta',
};

export default function CollectionsReportPage() {
  const [dateRange, setDateRange] = useState([dayjs().startOf('month'), dayjs()]);
  const [paymentMode, setPaymentMode] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const generation = useRef(0);
  const [reconciliation, setReconciliation] = useState(false);
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const fetchData = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setData([]); setSummary(null);
    try {
      const params = {
        from: dateRange[0].format('YYYY-MM-DD'),
        to: dateRange[1].format('YYYY-MM-DD'),
      };
      if (paymentMode) params.mode = paymentMode;
      Object.assign(params, { page, limit: 50 });

      const res = await getCollectionsReport(params);
      if (request !== generation.current) return;
      const result = res.data.data;
      setReconciliation(result.reconciliation_required === true);
      setTotal(result.pagination?.total || 0);
      setData(result.payments || []);
      setSummary(result.summary || null);
    } catch {
      if (request === generation.current) message.error('Failed to load collections report');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [dateRange, paymentMode, page]);

  useEffect(() => {
    fetchData();
    return () => { generation.current++; };
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {
        from: dateRange[0].format('YYYY-MM-DD'),
        to: dateRange[1].format('YYYY-MM-DD'),
      };
      if (paymentMode) params.mode = paymentMode;
      await exportReport('collections', params);
      message.success('Collections report exported');
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
      if (paymentMode) params.mode = paymentMode;
      await exportReportPdf('collections', params);
      message.success('Collections PDF exported');
    } catch {
      message.error('Failed to export PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const columns = [
    { title: 'Direction', dataIndex: 'direction', render: value => value === 'in' ? 'Received' : 'Paid out' },
    { title: 'Event', dataIndex: 'kind' },
    { title: 'Source', key: 'source', render: (_, row) => `${row.source_type} #${row.source_id}` },
    {
      title: 'Payment Ref',
      dataIndex: 'reference_no',
      key: 'reference_no',
    },
    {
      title: 'Date',
      dataIndex: 'payment_date',
      key: 'payment_date',
      render: (val) => formatDate(val),
    },
    {
      title: 'Issued party',
      dataIndex: 'customer_name',
      key: 'customer_name',
      ellipsis: true,
      render: (val, row) => val || row.party_snapshot?.name || 'Unknown issued identity',
    },
    {
      title: 'Invoice No',
      dataIndex: 'invoice_no',
      key: 'invoice_no',
      render: (val) => val || '\u2014',
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      render: (val) => (
        <Tag color={MODE_COLORS[val] || 'default'}>
          {val?.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Notes',
      dataIndex: 'notes',
      key: 'notes',
      ellipsis: true,
      render: (val) => val || '\u2014',
    },
  ];

  const summaryCards = summary ? (
    <Row gutter={[16, 16]}>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#e6f7ff' }}>
          <Statistic title="Money received" value={summary.total_collected || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}><Card size="small" bordered={false}><Statistic title="Money paid out" value={summary.total_refunded || 0} formatter={formatINR} /></Card></Col>
      <Col xs={12} sm={8} lg={4}><Card size="small" bordered={false}><Statistic title="Net money movement" value={summary.net_collected || 0} formatter={formatINR} /></Card></Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#f6ffed' }}>
          <Statistic title="Total Transactions" value={summary.total_payments || 0} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#f6ffed' }}>
          <Statistic title="Cash net" value={summary.cash_total || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#e6f7ff' }}>
          <Statistic title="UPI net" value={summary.upi_total || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#f9f0ff' }}>
          <Statistic title="Bank net" value={summary.bank_total || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={4}>
        <Card size="small" bordered={false} style={{ background: '#fff7e6' }}>
          <Statistic title="Cheque net" value={summary.cheque_total || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
    </Row>
  ) : null;

  const filters = (
    <Space wrap>
      <RangePicker
        value={dateRange}
        onChange={(dates) => { if (dates) { setPage(1); setDateRange(dates); } }}
        format="DD-MM-YYYY"
        allowClear={false}
      />
      <Select
        value={paymentMode}
        onChange={value => { setPage(1); setPaymentMode(value); }}
        style={{ width: 160 }}
        placeholder="Payment Mode"
      >
        {MODE_OPTIONS.map((opt) => (
          <Option key={opt.value} value={opt.value}>{opt.label}</Option>
        ))}
      </Select>
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      <ReportLayout
        title="Collections Report"
        exportButton={
          <>
            <Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>Export Excel</Button>
            <Button icon={<FilePdfOutlined />} disabled title="PDF exports are temporarily unavailable while safety checks are completed">PDF unavailable</Button>
          </>
        }
        filters={filters}
        summary={<>{reconciliation && <Alert type="warning" showIcon message="Some issued identities are unknown. Money movements retain their original recorded evidence." />}{summaryCards}</>}
        loading={loading}
        table={
          <Table
            dataSource={data}
            columns={columns}
            rowKey={(record) => record.id || record.reference_no}
            size="small"
            scroll={{ x: 800 }}
            pagination={{ current: page, pageSize: 50, total, showSizeChanger: false, onChange: setPage, showTotal: value => `Total ${value} tender portions` }}
          />
        }
      />
    </div>
  );
}
