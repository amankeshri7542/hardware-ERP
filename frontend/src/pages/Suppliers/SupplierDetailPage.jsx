import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Card, Descriptions, Tabs, Table, Tag, Button, Space, message, Spin, Alert } from 'antd';
import { ArrowLeftOutlined, ShoppingCartOutlined, LineChartOutlined } from '@ant-design/icons';
import { getSupplier, getSupplierProducts, getSupplierDebitNotes } from '../../api/suppliers.api';
import { getPurchases } from '../../api/purchases.api';
import { formatINR } from '../../utils/formatCurrency';

const { Title, Text } = Typography;

export default function SupplierDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [supplier, setSupplier] = useState(null);
  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [debitNotes, setDebitNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSupplierData = useCallback(async () => {
    setLoading(true);
    try {
      const [suppRes, prodRes, purchRes, notesRes] = await Promise.all([
        getSupplier(id),
        getSupplierProducts(id),
        getPurchases({ supplier_id: id, limit: 100 }),
        getSupplierDebitNotes(id)
      ]);
      setSupplier(suppRes.data.data);
      const prodData = prodRes.data.data;
      setProducts(Array.isArray(prodData) ? prodData : prodData?.products || []);
      setPurchases(purchRes.data.data?.purchases || []);
      const notesData = notesRes.data.data;
      setDebitNotes(Array.isArray(notesData) ? notesData : notesData?.debit_notes || []);
    } catch (err) {
      message.error('Failed to load supplier details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSupplierData();
  }, [fetchSupplierData]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '50px' }}><Spin size="large" /></div>;
  }

  if (!supplier) {
    return <div style={{ padding: '24px' }}><Alert message="Supplier not found" type="error" /></div>;
  }

  const productColumns = [
    { title: 'Product Name', dataIndex: 'product_name', key: 'product_name' },
    { title: 'Last Price', dataIndex: 'last_price', key: 'last_price', render: val => formatINR(val) },
    { title: 'Last Purchase', dataIndex: 'last_purchase_date', key: 'last_purchase_date', render: val => val ? new Date(val).toLocaleDateString() : 'N/A' },
    { title: 'Status', dataIndex: 'is_primary_supplier', key: 'is_primary_supplier', render: val => val ? <Tag color="green">Primary</Tag> : <Tag>Secondary</Tag> },
    {
      title: 'Action',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button 
            type="primary" 
            size="small" 
            icon={<ShoppingCartOutlined />} 
            onClick={() => navigate('/purchases/new', { 
              state: { supplierId: id, product: { id: record.product_id, name: record.product_name, purchase_price: record.last_price } } 
            })}
          >
            Restock
          </Button>
          <Button
            size="small"
            icon={<LineChartOutlined />}
            onClick={() => navigate(`/products/${record.product_id}`)}
          >
            History
          </Button>
        </Space>
      )
    }
  ];

  // Columns for Purchase History
  const purchaseColumns = [
    { title: 'Date', dataIndex: 'date', key: 'date', render: val => new Date(val).toLocaleDateString('en-IN') },
    { title: 'PO Number', dataIndex: 'po_number', key: 'po_number' },
    { title: 'Items', dataIndex: 'item_count', key: 'item_count', width: 70, align: 'center' },
    { title: 'Total Amount', dataIndex: 'total_amount', key: 'total_amount', render: val => formatINR(val), align: 'right' },
    { title: 'Status', dataIndex: 'status', key: 'status', render: val => {
      const colors = { received: 'green', draft: 'orange' };
      return <Tag color={colors[val] || 'default'}>{val ? val.toUpperCase() : 'N/A'}</Tag>;
    }}
  ];

  // Columns for Debit Notes
  const debitNoteColumns = [
    { title: 'Note No.', dataIndex: 'debit_note_no', key: 'debit_note_no' },
    { title: 'Date', dataIndex: 'date', key: 'date', render: val => new Date(val).toLocaleDateString() },
    { title: 'Original amount', dataIndex: 'amount', key: 'amount', render: val => formatINR(val) },
    { title: 'Original status', dataIndex: 'status', key: 'status', render: val => {
      const colors = { outstanding: 'red', adjusted: 'green', cancelled: 'default' };
      return <Tag color={colors[val]}>{val ? val.toUpperCase() : 'N/A'}</Tag>;
    }},
    { title: 'Notes', dataIndex: 'notes', key: 'notes' },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/suppliers')}>Back to Suppliers</Button>
        <Button onClick={() => navigate(`/settlements/supplier/${id}`)}>Open supplier settlements and statement</Button>
      </Space>

      <Card title={<Title level={4} style={{ margin: 0 }}>{supplier.name}</Title>}>
        <Descriptions column={{ xxl: 4, xl: 3, lg: 3, md: 3, sm: 2, xs: 1 }} bordered>
          <Descriptions.Item label="Contact Person">{supplier.contact_person || 'N/A'}</Descriptions.Item>
          <Descriptions.Item label="Phone">{supplier.phone}</Descriptions.Item>
          <Descriptions.Item label="GSTIN">{supplier.gstin || 'N/A'}</Descriptions.Item>
          <Descriptions.Item label="Email">{supplier.email || 'N/A'}</Descriptions.Item>
          <Descriptions.Item label="Address" span={2}>{[supplier.address, supplier.city, supplier.pincode].filter(Boolean).join(', ')}</Descriptions.Item>
          <Descriptions.Item label="Payment Terms">{supplier.payment_terms || 'N/A'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card style={{ marginTop: 24 }}>
        <Tabs 
          defaultActiveKey="1" 
          items={[
            {
              key: '1',
              label: 'Products Supplied',
              children: <Table columns={productColumns} dataSource={products} rowKey="id" pagination={{ pageSize: 10 }} />
            },
            {
              key: '2',
              label: 'Purchase History',
              children: <Table columns={purchaseColumns} dataSource={purchases} rowKey="id" pagination={{ pageSize: 10 }} />
            },
            {
              key: '3',
              label: 'Original Issued Debit Notes',
              children: <><p><Text type="secondary">Amounts and status reflect the original issued notes. </Text><Button type="link" onClick={() => navigate(`/settlements/supplier/${id}`)}>View current remaining claims in settlements</Button></p><Table columns={debitNoteColumns} dataSource={debitNotes} rowKey="id" pagination={{ pageSize: 10 }} /></>
            }
          ]}
        />
      </Card>
    </div>
  );
}
