import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Card, Statistic, Table, Button, Select, Space, message, DatePicker } from 'antd';
import { DownloadOutlined, FilePdfOutlined } from '@ant-design/icons';
import ReportLayout from '../../components/Reports/ReportLayout';
import { getStockMovementReport, exportReport, exportReportPdf } from '../../api/reports.api';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export default function StockMovementPage() {
  const [dateRange, setDateRange] = useState([dayjs().startOf('month'), dayjs().endOf('month')]);
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.from = dateRange[0].format('YYYY-MM-DD');
        params.to = dateRange[1].format('YYYY-MM-DD');
      }

      const res = await getStockMovementReport(params);
      const result = res.data.data;
      setData(result.movements || []);
      setSummary(result.summary || null);
    } catch {
      message.error('Failed to load stock movement report');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {};
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.from = dateRange[0].format('YYYY-MM-DD');
        params.to = dateRange[1].format('YYYY-MM-DD');
      }
      await exportReport('stock-movement', params);
      message.success('Stock movement report exported');
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
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.from = dateRange[0].format('YYYY-MM-DD');
        params.to = dateRange[1].format('YYYY-MM-DD');
      }
      await exportReportPdf('stock-movement', params);
      message.success('Stock movement PDF exported');
    } catch {
      message.error('Failed to export PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const columns = [
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      render: (val) => dayjs(val).format('DD-MM-YYYY'),
      width: 120,
    },
    {
      title: 'Product',
      dataIndex: 'product_name',
      key: 'product_name',
      ellipsis: true,
    },
    {
      title: 'Movement Type',
      dataIndex: 'movement_type',
      key: 'movement_type',
      render: (val) => {
        let color = 'default';
        if (val === 'in' || val === 'return_in') color = 'green';
        if (val === 'out' || val === 'return_out') color = 'volcano';
        if (val === 'adjustment') color = 'blue';
        return <span style={{ color }}>{val.replace('_', ' ').toUpperCase()}</span>;
      },
    },
    {
      title: 'Qty In',
      dataIndex: 'qty_in',
      key: 'qty_in',
      align: 'right',
      render: (val) => val > 0 ? <span style={{ color: '#52c41a' }}>{val}</span> : '-',
    },
    {
      title: 'Qty Out',
      dataIndex: 'qty_out',
      key: 'qty_out',
      align: 'right',
      render: (val) => val > 0 ? <span style={{ color: '#ff4d4f' }}>{val}</span> : '-',
    },
    {
      title: 'Balance',
      dataIndex: 'stock_after',
      key: 'stock_after',
      align: 'right',
    },
    {
      title: 'Reference',
      key: 'reference',
      render: (_, record) => {
        if (!record.reference_type) return '-';
        return `${record.reference_type}: ${record.reference_id || ''}`;
      },
    },
    {
      title: 'Notes',
      dataIndex: 'notes',
      key: 'notes',
      ellipsis: true,
    },
  ];

  const summaryCards = summary ? (
    <Row gutter={[16, 16]}>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#f6ffed' }}>
          <Statistic title="Total In" value={summary.total_in || 0} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#fff2f0' }}>
          <Statistic title="Total Out" value={summary.total_out || 0} />
        </Card>
      </Col>
    </Row>
  ) : null;

  const filters = (
    <Space wrap>
      <RangePicker
        value={dateRange}
        onChange={setDateRange}
        format="DD-MM-YYYY"
        allowClear={false}
      />
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      <ReportLayout
        title="Stock Movement Report"
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
            rowKey={(record, idx) => record.id || idx}
            size="small"
            scroll={{ x: 1000 }}
            pagination={{ pageSize: 50, showTotal: (total) => `Total ${total} entries` }}
          />
        }
      />
    </div>
  );
}
