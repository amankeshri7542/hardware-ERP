import React from 'react';
import { Layout, Menu, Typography, Button, Space, message } from 'antd';
import { ShoppingCartOutlined, ThunderboltOutlined, LogoutOutlined } from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import useAuthStore from '../../store/authStore';

const { Header, Content } = Layout;
const { Text } = Typography;

export default function BillingLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const isQuickBill = location.pathname.includes('/billing/quick');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '0 24px' }}>
        <Space size="large">
          <Menu mode="horizontal" selectedKeys={[isQuickBill ? 'quick' : 'standard']}
            items={[
              { key: 'standard', icon: <ShoppingCartOutlined />, label: 'Standard Bill', onClick: () => navigate('/billing') },
              { key: 'quick', icon: <ThunderboltOutlined />, label: 'Quick Bill F2', onClick: () => navigate('/billing/quick') },
            ]}
          />
        </Space>
        <Space>
          <Text type="secondary">{user?.name || 'Admin'}</Text>
          <Button type="text" icon={<LogoutOutlined />} aria-label="Sign out" onClick={() => logout().catch(() => message.error('Sign out could not be confirmed. Check your connection and try again.'))} />
        </Space>
      </Header>
      <div style={{ background: '#f5f5f5', padding: '4px 24px', fontSize: 12, color: '#8c8c8c' }}>
        Tab: next field &nbsp;|&nbsp; Enter: add item &nbsp;|&nbsp; F2: quick bill &nbsp;|&nbsp; F9: finalise &nbsp;|&nbsp; Esc: cancel
      </div>
      <Content style={{ background: '#f5f5f5' }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
