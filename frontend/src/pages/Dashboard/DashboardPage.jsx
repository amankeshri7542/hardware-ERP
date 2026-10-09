import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Row, Col, Card, Statistic, Table, List, Tag, Typography, Spin, Badge, Space, Button,
} from 'antd';
import {
  DollarOutlined, WalletOutlined, ExclamationCircleOutlined, WarningOutlined,
  FileTextOutlined, ReloadOutlined,
} from '@ant-design/icons';
import {
  getDashboardSummary, getRecentActivity, getOverdueInvoices, getPaymentModeBreakdown,
} from '../../api/dashboard.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';

const { Title, Text } = Typography;

const REFRESH_INTERVAL = 60000; // 60 seconds

const PAYMENT_MODE_LABELS = {
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank',
  cheque: 'Cheque',
};

const PAYMENT_MODE_COLORS = {
  cash: '#52c41a',
  upi: '#1890ff',
  bank: '#722ed1',
  cheque: '#fa8c16',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const intervalRef = useRef(null);

  const [summary, setSummary] = useState(null);
  const [reconciliation, setReconciliation] = useState(false);
  const [financialErrors, setFinancialErrors] = useState([]);
  const [overdueAvailable, setOverdueAvailable] = useState(true);
  const [modesAvailable, setModesAvailable] = useState(true);
  const [recentActivity, setRecentActivity] = useState([]);
  const [overdueInvoices, setOverdueInvoices] = useState([]);
  const [paymentModes, setPaymentModes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboardData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [summaryRes, activityRes, overdueRes, modesRes] = await Promise.allSettled([
        getDashboardSummary(),
        getRecentActivity({ limit: 10 }),
        getOverdueInvoices({ limit: 5 }),
        getPaymentModeBreakdown(),
      ]);

      const flagged = value => value?.reconciliation_required === true || (Array.isArray(value) && value.some(row => row.reconciliation_required === true));
      setReconciliation([summaryRes, overdueRes, modesRes].some(result => result.status === 'fulfilled' && flagged(result.value.data.data)));
      setFinancialErrors([['Financial summary', summaryRes], ['Overdue invoices', overdueRes], ['Payment mode totals', modesRes]]
        .filter(([, result]) => result.status === 'rejected')
        .map(([label, result]) => `${label} unavailable${result.reason.response?.status ? ` (${result.reason.response.status}${result.reason.response.data?.code ? `: ${result.reason.response.data.code}` : ''})` : ''}.`));
      setOverdueAvailable(overdueRes.status === 'fulfilled'); setModesAvailable(modesRes.status === 'fulfilled');
      if (summaryRes.status === 'fulfilled') {
        setSummary(summaryRes.value.data.data);
      } else setSummary(null);
      if (activityRes.status === 'fulfilled') {
        setRecentActivity(activityRes.value.data.data || []);
      }
      if (overdueRes.status === 'fulfilled') {
        const od = overdueRes.value.data.data;
        setOverdueInvoices(Array.isArray(od) ? od : od?.invoices || []);
      } else setOverdueInvoices([]);
      if (modesRes.status === 'fulfilled') {
        const md = modesRes.value.data.data;
        setPaymentModes(Array.isArray(md) ? md : md?.modes || []);
      } else setPaymentModes([]);
    } catch {
      // Errors handled per-request via allSettled
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData(false);
    intervalRef.current = setInterval(() => fetchDashboardData(true), REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchDashboardData]);

  // --- Summary Cards ---
  const summaryCards = [
    {
      title: "Today's Sales",
      value: summary?.today_sales ?? 0,
      prefix: null,
      icon: <DollarOutlined />,
      color: '#1890ff',
      bg: '#e6f7ff',
      format: true,
    },
    {
      title: "Today's Collections",
      value: summary?.today_collections ?? 0,
      prefix: null,
      icon: <WalletOutlined />,
      color: '#52c41a',
      bg: '#f6ffed',
      format: true,
    },
    {
      title: 'Total Outstanding',
      value: summary?.total_outstanding ?? 0,
      prefix: null,
      icon: <ExclamationCircleOutlined />,
      color: '#ff4d4f',
      bg: '#fff2f0',
      format: true,
    },
    {
      title: 'Low Stock Items',
      value: summary?.low_stock_count ?? 0,
      prefix: null,
      icon: <WarningOutlined />,
      color: '#fa8c16',
      bg: '#fff7e6',
      format: false,
    },
    {
      title: 'Supplier Debit Notes',
      value: summary?.outstanding_debit_notes_total ?? 0,
      prefix: null,
      icon: <FileTextOutlined />,
      color: '#722ed1',
      bg: '#f9f0ff',
      format: true,
    },
  ];

  // --- Overdue Table Columns ---
  const overdueColumns = [
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
      title: 'Customer',
      dataIndex: 'customer_name',
      key: 'customer_name',
      ellipsis: true,
    },
    {
      title: 'Amount Due',
      dataIndex: 'balance_due',
      key: 'balance_due',
      align: 'right',
      render: (val) => formatINR(val),
    },
    {
      title: 'Due Date',
      dataIndex: 'due_date',
      key: 'due_date',
      render: (val) => formatDate(val),
    },
    {
      title: 'Days Overdue',
      dataIndex: 'days_overdue',
      key: 'days_overdue',
      align: 'center',
      render: (val) => (
        <Text strong style={{ color: '#ff4d4f' }}>{val}</Text>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>Dashboard</Title>
        </Col>
        <Col>
          <Button
            icon={<ReloadOutlined spin={refreshing} />}
            onClick={() => fetchDashboardData(true)}
            loading={refreshing}
          >
            Refresh
          </Button>
        </Col>
      </Row>

      {reconciliation && <Alert type="warning" showIcon message="Financial totals are incomplete or unverified" description="Some historical balances or money evidence require reconciliation and may be excluded. Zero totals and empty overdue lists do not confirm that nothing is owed." style={{ marginBottom: 16 }} />}
      {financialErrors.length > 0 && <Alert type="error" showIcon message="Some financial sections are unavailable" description={financialErrors.join(' ')} style={{ marginBottom: 16 }} />}
      {/* Row 1 — Summary Cards */}
      {summary && <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {summaryCards.map((card) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={card.title}>
            <Card
              variant="borderless"
              style={{ borderRadius: 8, background: card.bg }}
              styles={{ body: { padding: '20px 24px' } }}
            >
              <Statistic
                title={<Text type="secondary">{card.title}</Text>}
                value={card.format ? card.value : card.value}
                formatter={card.format ? (val) => formatINR(val) : undefined}
                prefix={
                  <span
                    style={{
                      color: card.color,
                      fontSize: 24,
                      marginRight: 8,
                    }}
                  >
                    {card.icon}
                  </span>
                }
                valueStyle={{ color: card.color, fontSize: 28, fontWeight: 600 }}
              />
            </Card>
          </Col>
        ))}
      </Row>}

      {/* Row 2 — Recent Activity + Payment Mode Breakdown */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {/* Left: Recent Activity */}
        <Col xs={24} lg={14}>
          <Card
            title="Recent issued invoices and original receipts"
            bordered={false}
            style={{ borderRadius: 8, height: '100%' }}
            extra={
              <Button type="link" size="small" onClick={() => navigate('/invoices')}>
                View All
              </Button>
            }
          >
            <List
              dataSource={recentActivity}
              locale={{ emptyText: 'No recent activity' }}
              renderItem={(item) => (
                <List.Item
                  key={item.id}
                  style={{ padding: '8px 0' }}
                >
                  <List.Item.Meta
                    avatar={
                      <span style={{ fontSize: 20, color: (item.activity_type || item.type) === 'payment' ? '#52c41a' : '#1890ff' }}>
                        {(item.activity_type || item.type) === 'payment' ? <DollarOutlined /> : <FileTextOutlined />}
                      </span>
                    }
                    title={
                      <Space>
                        <Text strong>{item.reference || item.reference_no || item.invoice_no || '—'}</Text>
                        <Tag color={(item.activity_type || item.type) === 'payment' ? 'green' : 'blue'}>
                          {(item.activity_type || item.type) === 'payment' ? 'Payment' : 'Invoice'}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Text type="secondary">{item.customer_name || 'Unknown issued identity'}</Text>
                    }
                  />
                  <div style={{ textAlign: 'right' }}>
                    <Text strong style={{ fontSize: 14 }}>{formatINR(item.amount)}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>{formatDate(item.date)}</Text>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>

        {/* Right: Payment Mode Breakdown */}
        <Col xs={24} lg={10}>
          <Card
            title="Payment Mode Breakdown"
            bordered={false}
            style={{ borderRadius: 8, height: '100%' }}
            extra={<Text type="secondary">This Month</Text>}
          >
            {!modesAvailable ? <Text type="danger">Payment mode totals unavailable</Text> : paymentModes.length === 0 ? (
              <Text type="secondary">No payment data for this month</Text>
            ) : (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                {paymentModes.map((pm) => (
                  <Row key={pm.mode} justify="space-between" align="middle">
                    <Col>
                      <Space>
                        <span
                          style={{
                            display: 'inline-block',
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: PAYMENT_MODE_COLORS[pm.mode] || '#999',
                          }}
                        />
                        <Text>{PAYMENT_MODE_LABELS[pm.mode] || pm.mode}</Text>
                      </Space>
                    </Col>
                    <Col>
                      <Text strong style={{ fontSize: 16 }}>{formatINR(pm.total || 0)}</Text>
                      <Text type="secondary" style={{ marginLeft: 8 }}>
                        ({pm.count || 0} incoming tender portions)
                      </Text>
                    </Col>
                  </Row>
                ))}
                {/* Grand total */}
                <Row
                  justify="space-between"
                  align="middle"
                  style={{
                    borderTop: '1px solid #f0f0f0',
                    paddingTop: 12,
                    marginTop: 4,
                  }}
                >
                  <Col>
                    <Text strong>Total</Text>
                  </Col>
                  <Col>
                    <Text strong style={{ fontSize: 18, color: '#1890ff' }}>
                      {formatINR(paymentModes.reduce((sum, pm) => sum + Number(pm.total || 0), 0))}
                    </Text>
                  </Col>
                </Row>
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      {/* Row 3 — Overdue Invoices */}
      <Card
        title={
          <Space>
            <Text strong style={{ fontSize: 16 }}>Overdue Invoices</Text>
            {overdueInvoices.length > 0 && (
              <Badge count={overdueInvoices.length} style={{ backgroundColor: '#ff4d4f' }} />
            )}
          </Space>
        }
        bordered={false}
        style={{ borderRadius: 8 }}
        extra={
          <Button type="link" size="small" onClick={() => navigate('/invoices?status=overdue')}>
            View All Overdue
          </Button>
        }
      >
        <Table
          dataSource={overdueInvoices}
          columns={overdueColumns}
          rowKey={(record) => record.id || record.invoice_no}
          pagination={false}
          size="small"
          locale={{ emptyText: overdueAvailable ? 'No overdue invoices' : 'Overdue invoices unavailable' }}
        />
      </Card>
    </div>
  );
}
