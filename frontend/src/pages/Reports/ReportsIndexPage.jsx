import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Typography, Button, message } from 'antd';
import {
  BarChartOutlined,
  FileTextOutlined,
  ShoppingOutlined,
  TeamOutlined,
  DollarOutlined,
  WalletOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { exportReport } from '../../api/reports.api';

const { Title, Text } = Typography;

const REPORT_CARDS = [
  { title: 'Settlement Reports', description: 'Separate sales, returns, customer receipts/refunds, supplier money movements, and dated statements.', icon: <WalletOutlined style={{ fontSize: 32, color: '#13c2c2' }} />, path: '/settlements/reports', color: '#e6fffb' },
  {
    title: 'Sales Report',
    description: 'View sales by date range and bill type with totals and profit summary.',
    icon: <BarChartOutlined style={{ fontSize: 32, color: '#1890ff' }} />,
    path: '/reports/sales',
    color: '#e6f7ff',
  },
  {
    title: 'GST Report',
    description: 'Monthly GST summary with invoice-level and rate-wise breakdowns.',
    icon: <FileTextOutlined style={{ fontSize: 32, color: '#722ed1' }} />,
    path: '/reports/gst',
    color: '#f9f0ff',
  },
  {
    title: 'Stock Report',
    description: 'Current stock levels, low stock alerts, and category-wise inventory.',
    icon: <ShoppingOutlined style={{ fontSize: 32, color: '#fa8c16' }} />,
    path: '/reports/stock',
    color: '#fff7e6',
  },
  {
    title: 'Stock Movement',
    description: 'Detailed ledger of inventory in, out, and return movements over time.',
    icon: <BarChartOutlined style={{ fontSize: 32, color: '#13c2c2' }} />,
    path: '/reports/stock-movement',
    color: '#e6fffb',
  },
  {
    title: 'Customer Dues',
    description: 'Outstanding balances, overdue accounts, and ageing analysis.',
    icon: <TeamOutlined style={{ fontSize: 32, color: '#ff4d4f' }} />,
    path: '/reports/dues',
    color: '#fff2f0',
  },
  {
    title: 'Profit Report',
    description: 'Invoice-wise profit and margin analysis over a date range.',
    icon: <DollarOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
    path: '/reports/profit',
    color: '#f6ffed',
  },
  {
    title: 'Collections Report',
    description: 'Payment collections by date range and payment mode.',
    icon: <WalletOutlined style={{ fontSize: 32, color: '#13c2c2' }} />,
    path: '/reports/collections',
    color: '#e6fffb',
  },
];

export default function ReportsIndexPage() {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);

  const handleFullExport = async () => {
    setExporting(true);
    try {
      await exportReport('full-export');
      message.success('Full data export downloaded');
    } catch {
      message.error('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>Reports</Title>
        </Col>
        <Col>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={handleFullExport}
          >
            Full Data Export
          </Button>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {REPORT_CARDS.map((card) => (
          <Col xs={24} sm={12} lg={8} key={card.path}>
            <Card
              hoverable
              bordered={false}
              style={{ borderRadius: 8, background: card.color, height: '100%' }}
              onClick={() => navigate(card.path)}
            >
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                {card.icon}
              </div>
              <Title level={5} style={{ textAlign: 'center', margin: 0, marginBottom: 8 }}>
                {card.title}
              </Title>
              <Text type="secondary" style={{ display: 'block', textAlign: 'center' }}>
                {card.description}
              </Text>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
