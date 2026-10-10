import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, theme, message, Alert } from 'antd';
import {
  DashboardOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  TeamOutlined,
  AppstoreOutlined,
  ShoppingOutlined,
  TruckOutlined,
  BarChartOutlined,
  SettingOutlined,
  WalletOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import useAuthStore from '../store/authStore';
import { canAccessPath, hasCapability } from '../utils/access';
import PWAInstallButton from './PWAInstallButton';

const { Header, Sider, Content, Footer } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/billing', icon: <ShoppingCartOutlined />, label: 'Billing' },
  { key: '/invoices', icon: <FileTextOutlined />, label: 'Invoices' },
  { key: '/customers', icon: <TeamOutlined />, label: 'Customers' },
  { key: '/products', icon: <AppstoreOutlined />, label: 'Products' },
  { key: '/purchases', icon: <ShoppingOutlined />, label: 'Purchases' },
  { key: '/suppliers', icon: <TruckOutlined />, label: 'Suppliers' },
  { key: '/settlements', icon: <WalletOutlined />, label: 'Settlements' },
  { key: '/reports', icon: <BarChartOutlined />, label: 'Reports' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  // Determine which menu item is active based on current path
  const selectedKey = menuItems.find((item) =>
    location.pathname.startsWith(item.key),
  )?.key || '/dashboard';

  const handleMenuClick = ({ key }) => {
    navigate(key);
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      message.error('Sign out could not be confirmed. Check your connection and try again.');
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '12px 0',
          }}
        >
          <Text
            strong
            style={{
              color: '#fff',
              fontSize: collapsed ? 14 : 18,
              whiteSpace: 'nowrap',
              transition: 'font-size 0.2s',
            }}
          >
            {collapsed ? 'UE' : 'UMA Enterprises'}
          </Text>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems.filter(item => canAccessPath(user, item.key))}
          onClick={handleMenuClick}
        />
      </Sider>

      <Layout
        style={{
          marginLeft: collapsed ? 80 : 200,
          transition: 'margin-left 0.2s',
        }}
      >
        <Header
          style={{
            padding: '0 24px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 9,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16, width: 48, height: 48 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <PWAInstallButton />
            <Text style={{ color: '#595959' }}>
              {user?.name || 'Admin'}
            </Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={handleLogout}
              danger
            >
              Logout
            </Button>
          </div>
        </Header>

        <Content
          style={{
            margin: 16,
            padding: 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            minHeight: 'calc(100vh - 64px - 70px - 32px)',
          }}
        >
          <Alert showIcon type="warning" style={{ marginBottom: 16 }}
            message={hasCapability(user, 'billing.create')
              ? 'Legacy PDF exports and supplier invoice attachments remain unavailable. Supported record documents appear only when enabled. You can still record purchases without attachments.'
              : 'Your account can view the product catalog. Billing is currently unavailable for this account.'} />
          <Outlet />
        </Content>

        <Footer style={{ textAlign: 'center', padding: '12px 24px' }}>
          <Text type="secondary">UMA Enterprises v1.0</Text>
        </Footer>
      </Layout>
    </Layout>
  );
}
