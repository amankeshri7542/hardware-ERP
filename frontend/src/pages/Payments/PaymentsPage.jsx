import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table, Button, Tag, DatePicker, Select, Input, Typography, Row, Col, Card, Space, Spin, message, Modal,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, DollarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { listPayments } from '../../api/payments.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';
import PaymentModal from '../../components/PaymentModal/PaymentModal';
import DocumentsPanel, { useDocumentCapabilities } from '../../components/Documents/DocumentsPanel.jsx';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const PAGE_SIZE = 20;

const MODE_OPTIONS = [
  { label: 'All Modes', value: '' },
  { label: 'Cash', value: 'cash' },
  { label: 'UPI', value: 'upi' },
  { label: 'Bank', value: 'bank' },
  { label: 'Cheque', value: 'cheque' },
  { label: 'Mixed', value: 'mixed' },
];

const MODE_COLORS = {
  cash: 'green',
  upi: 'blue',
  bank: 'purple',
  cheque: 'orange',
  mixed: 'cyan',
};

const MODE_LABELS = {
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank',
  cheque: 'Cheque',
  mixed: 'Mixed',
};

export default function PaymentsPage() {
  const capabilities=useDocumentCapabilities();
  const [searchParams,setSearchParams]=useSearchParams();
  const receiptId=/^[1-9]\d*$/.test(searchParams.get('receipt') || '')?searchParams.get('receipt'):null;
  // Filters
  const [dateRange, setDateRange] = useState(() => [
    dayjs().startOf('month'),
    dayjs().endOf('month'),
  ]);
  const [modeFilter, setModeFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Data
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [totalAmount, setTotalAmount] = useState(0);

  // Payment Modal
  const [modalOpen, setModalOpen] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const fetchPayments = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: PAGE_SIZE,
      };

      if (dateRange && dateRange[0] && dateRange[1]) {
        params.from = dateRange[0].format('YYYY-MM-DD');
        params.to = dateRange[1].format('YYYY-MM-DD');
      }
      if (modeFilter) {
        params.mode = modeFilter;
      }
      if (debouncedSearch) {
        params.search = debouncedSearch;
      }

      const { data } = await listPayments(params);
      const result = data.data || data;
      setPayments(result.payments || []);
      setPagination({
        page: result.page || page,
        total: result.total || 0,
        totalPages: result.totalPages || 0,
      });
      setTotalAmount(result.total_amount ?? 0);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to fetch payments');
    } finally {
      setLoading(false);
    }
  }, [dateRange, modeFilter, debouncedSearch]);

  // Fetch on filter change
  useEffect(() => {
    fetchPayments(1);
  }, [fetchPayments]);

  const handleTableChange = useCallback((pag) => {
    fetchPayments(pag.current);
  }, [fetchPayments]);

  const handlePaymentSuccess = useCallback(() => {
    setModalOpen(false);
    fetchPayments(1);
  }, [fetchPayments]);

  // Table columns
  const columns = useMemo(() => [
    {
      title: 'Date',
      dataIndex: 'payment_date',
      key: 'payment_date',
      width: 120,
      render: (val) => formatDate(val),
    },
    {
      title: 'Customer',
      dataIndex: 'customer_name',
      key: 'customer_name',
      ellipsis: true,
    },
    {
      title: 'Invoice No',
      dataIndex: 'invoice_no',
      key: 'invoice_no',
      width: 160,
      render: (val) => val || <Text type="secondary">Advance</Text>,
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 140,
      align: 'right',
      render: (val) => <Text strong>{formatINR(val)}</Text>,
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      width: 100,
      align: 'center',
      render: (val) => (
        <Tag color={MODE_COLORS[val] || 'default'}>
          {MODE_LABELS[val] || val}
        </Tag>
      ),
    },
    {
      title: 'Reference No',
      dataIndex: 'reference_no',
      key: 'reference_no',
      width: 150,
      ellipsis: true,
      render: (val) => val || <Text type="secondary">--</Text>,
    },
    {
      title: 'Created By',
      dataIndex: 'created_by_name',
      key: 'created_by_name',
      width: 130,
      ellipsis: true,
      render: (val) => val || 'Admin',
    },
    ...(capabilities?.enabled ? [{title:'Receipt',render:(_,row)=><Button onClick={()=>setSearchParams({receipt:String(row.id)})}>Receipt document</Button>}] : []),
  ], [capabilities?.enabled,setSearchParams]);

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>Payments</Title>
        </Col>
        <Col>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModalOpen(true)}
          >
            Record Payment
          </Button>
        </Col>
      </Row>

      {/* Filters */}
      <Card bordered={false} style={{ borderRadius: 8, marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} sm={12} md={8}>
            <RangePicker
              value={dateRange}
              onChange={setDateRange}
              format="DD-MM-YYYY"
              style={{ width: '100%' }}
              allowClear
              placeholder={['From Date', 'To Date']}
            />
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Select
              value={modeFilter}
              onChange={setModeFilter}
              options={MODE_OPTIONS}
              style={{ width: '100%' }}
              placeholder="Payment Mode"
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search customer or reference..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
            />
          </Col>
        </Row>
      </Card>

      {/* Summary */}
      {totalAmount > 0 && (
        <Card
          bordered={false}
          bodyStyle={{ padding: '12px 24px' }}
          style={{ borderRadius: 8, marginBottom: 16, background: '#f6ffed' }}
        >
          <Row justify="space-between" align="middle">
            <Col>
              <Space>
                <DollarOutlined style={{ color: '#52c41a', fontSize: 18 }} />
                <Text type="secondary">
                  Total for filtered results ({pagination.total} payments):
                </Text>
              </Space>
            </Col>
            <Col>
              <Text strong style={{ fontSize: 20, color: '#52c41a' }}>
                {formatINR(totalAmount)}
              </Text>
            </Col>
          </Row>
        </Card>
      )}

      {/* Table */}
      <Card bordered={false} style={{ borderRadius: 8 }}>
        <Table
          dataSource={payments}
          columns={columns}
          rowKey={(record) => record.id || record.payment_id}
          loading={loading}
          pagination={{
            current: pagination.page,
            total: pagination.total,
            pageSize: PAGE_SIZE,
            showSizeChanger: false,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} payments`,
          }}
          onChange={handleTableChange}
          size="middle"
          scroll={{ x: 900 }}
          locale={{ emptyText: 'No payments found' }}
        />
      </Card>

      <Modal title="Customer receipt document" open={Boolean(receiptId && capabilities?.enabled)} onCancel={()=>setSearchParams({})} footer={null} width={1000} destroyOnClose>
        {receiptId && <DocumentsPanel key={`payment-${receiptId}`} sourceType="payment" sourceId={receiptId} />}
      </Modal>

      {/* Payment Modal — standalone (no invoice context) */}
      <PaymentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handlePaymentSuccess}
        customerId={null}
        invoiceId={null}
        balanceDue={null}
      />
    </div>
  );
}
