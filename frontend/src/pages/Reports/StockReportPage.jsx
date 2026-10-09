import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Card, Statistic, Table, Button, Select, Switch, Space, Badge, Tag, message } from 'antd';
import { DownloadOutlined, WarningOutlined, FilePdfOutlined } from '@ant-design/icons';
import ReportLayout from '../../components/Reports/ReportLayout';
import { getStockReport, getProductCategories, exportReport, exportReportPdf } from '../../api/reports.api';
import { formatINR } from '../../utils/formatCurrency';

const { Option } = Select;

export default function StockReportPage() {
  const [category, setCategory] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    getProductCategories()
      .then((res) => setCategories(res.data.data || []))
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (category) params.category = category;
      if (lowStockOnly) params.low_stock = true;

      const res = await getStockReport(params);
      const result = res.data.data;
      setData(result.products || []);
      setSummary(result.summary || null);
    } catch {
      message.error('Failed to load stock report');
    } finally {
      setLoading(false);
    }
  }, [category, lowStockOnly]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {};
      if (category) params.category = category;
      if (lowStockOnly) params.low_stock = true;
      await exportReport('stock', params);
      message.success('Stock report exported');
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
      if (category) params.category = category;
      if (lowStockOnly) params.low_stock = true;
      await exportReportPdf('stock', params);
      message.success('Stock PDF exported');
    } catch {
      message.error('Failed to export PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const columns = [
    {
      title: 'SKU',
      dataIndex: 'sku',
      key: 'sku',
      width: 100,
    },
    {
      title: 'Product Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      render: (val) => val || '\u2014',
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
    },
    {
      title: 'Current Stock',
      dataIndex: 'current_stock',
      key: 'current_stock',
      align: 'right',
      render: (val, record) => {
        const isLow = record.is_low_stock || (record.min_stock && val <= record.min_stock);
        return isLow ? (
          <Badge
            count={<WarningOutlined style={{ color: '#fa8c16', fontSize: 12 }} />}
            offset={[8, 0]}
          >
            <Tag color="orange">{val}</Tag>
          </Badge>
        ) : (
          <span>{val}</span>
        );
      },
    },
    {
      title: 'Min Stock',
      dataIndex: 'min_stock',
      key: 'min_stock',
      align: 'right',
      render: (val) => val ?? '\u2014',
    },
    {
      title: 'MRP',
      dataIndex: 'mrp',
      key: 'mrp',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'Stock Value',
      dataIndex: 'stock_value_cost',
      key: 'stock_value_cost',
      align: 'right',
      render: (val) => formatINR(val),
    },
  ];

  const summaryCards = summary ? (
    <Row gutter={[16, 16]}>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#e6f7ff' }}>
          <Statistic title="Total Products" value={summary.total_products || 0} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#fff7e6' }}>
          <Statistic title="Low Stock Items" value={summary.low_stock_count || 0} valueStyle={{ color: '#fa8c16' }} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#fff2f0' }}>
          <Statistic title="Out of Stock" value={summary.out_of_stock_count || 0} valueStyle={{ color: '#ff4d4f' }} />
        </Card>
      </Col>
      <Col xs={12} sm={8} lg={6}>
        <Card size="small" bordered={false} style={{ background: '#f6ffed' }}>
          <Statistic title="Total Stock Value" value={summary.total_stock_value_cost || 0} formatter={(val) => formatINR(val)} />
        </Card>
      </Col>
    </Row>
  ) : null;

  const filters = (
    <Space wrap>
      <Select
        value={category}
        onChange={setCategory}
        style={{ width: 200 }}
        placeholder="All Categories"
        allowClear
        onClear={() => setCategory('')}
      >
        {categories.map((cat) => (
          <Option key={cat} value={cat}>{cat}</Option>
        ))}
      </Select>
      <Space>
        <Switch checked={lowStockOnly} onChange={setLowStockOnly} />
        <span>Low Stock Only</span>
      </Space>
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      <ReportLayout
        title="Stock Report"
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
            rowKey={(record) => record.id || record.sku}
            size="small"
            scroll={{ x: 900 }}
            pagination={{ pageSize: 50, showTotal: (total) => `Total ${total} products` }}
          />
        }
      />
    </div>
  );
}
