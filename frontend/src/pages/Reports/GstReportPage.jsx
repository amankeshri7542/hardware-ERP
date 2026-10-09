import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, DatePicker, Tabs, Tag, Space, message } from 'antd';
import { DownloadOutlined, FilePdfOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import ReportLayout from '../../components/Reports/ReportLayout';
import { getGstReport, exportReport, exportReportPdf } from '../../api/reports.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';

export default function GstReportPage() {
  const navigate = useNavigate();

  const [month, setMonth] = useState(dayjs());
  const [invoices, setInvoices] = useState([]);
  const [rateSummary, setRateSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        month: month.format('YYYY-MM'),
      };
      const res = await getGstReport(params);
      const result = res.data.data;
      setInvoices(result.invoices || []);
      setRateSummary(result.rate_summary || []);
    } catch {
      message.error('Failed to load GST report');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportReport('gst', { month: month.format('YYYY-MM') });
      message.success('GST report exported');
    } catch {
      message.error('Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      await exportReportPdf('gst', { month: month.format('YYYY-MM') });
      message.success('GST PDF exported');
    } catch {
      message.error('Failed to export PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const invoiceColumns = [
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
      title: 'GSTIN',
      dataIndex: 'customer_gstin',
      key: 'customer_gstin',
      render: (val) => val || '\u2014',
    },
    {
      title: 'Taxable Amount',
      dataIndex: 'taxable_total',
      key: 'taxable_total',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'CGST',
      key: 'cgst',
      align: 'right',
      render: (_, record) => formatINR((record.gst_total || 0) / 2),
    },
    {
      title: 'SGST',
      key: 'sgst',
      align: 'right',
      render: (_, record) => formatINR((record.gst_total || 0) / 2),
    },
    {
      title: 'Total Tax',
      dataIndex: 'gst_total',
      key: 'gst_total',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'Grand Total',
      dataIndex: 'grand_total',
      key: 'grand_total',
      align: 'right',
      render: (val) => formatINR(val),
    },
  ];

  const rateColumns = [
    {
      title: 'GST Rate',
      dataIndex: 'gst_pct',
      key: 'gst_pct',
      render: (val) => <Tag color="blue">{val}%</Tag>,
    },
    {
      title: 'Taxable Amount',
      dataIndex: 'taxable_amount',
      key: 'taxable_amount',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'CGST',
      dataIndex: 'cgst',
      key: 'cgst',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'SGST',
      dataIndex: 'sgst',
      key: 'sgst',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'Total Tax',
      dataIndex: 'total_tax',
      key: 'total_tax',
      align: 'right',
      render: (val) => formatINR(val),
    },
  ];

  const tabItems = [
    {
      key: 'invoices',
      label: 'Invoice List',
      children: (
        <Table
          dataSource={invoices}
          columns={invoiceColumns}
          rowKey={(record) => record.id || record.invoice_no}
          size="small"
          scroll={{ x: 1000 }}
          pagination={{ pageSize: 50, showTotal: (total) => `Total ${total} invoices` }}
        />
      ),
    },
    {
      key: 'rateSummary',
      label: 'Rate Summary',
      children: (
        <Table
          dataSource={rateSummary}
          columns={rateColumns}
          rowKey={(record) => record.gst_pct}
          size="small"
          pagination={false}
        />
      ),
    },
  ];

  const filters = (
    <Space>
      <DatePicker
        picker="month"
        value={month}
        onChange={(val) => val && setMonth(val)}
        format="MMM YYYY"
        allowClear={false}
      />
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      <ReportLayout
        title="GST Report"
        exportButton={
          <>
            <Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>Export Excel</Button>
            <Button icon={<FilePdfOutlined />} disabled title="PDF exports are temporarily unavailable while safety checks are completed">PDF unavailable</Button>
          </>
        }
        filters={filters}
        loading={loading}
        table={<Tabs items={tabItems} />}
      />
    </div>
  );
}
