import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, Alert } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import useAuthStore from '../../store/authStore';
import { loginApi } from '../../api/auth.api';
import './LoginPage.css';

const { Title, Text } = Typography;

export default function LoginPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const emailRef = useRef(null);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const login = useAuthStore((state) => state.login);

  // If already authenticated, redirect to home
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Auto-focus email field on mount
  useEffect(() => {
    if (!isAuthenticated && emailRef.current) {
      emailRef.current.focus();
    }
  }, [isAuthenticated]);

  const handleSubmit = async (values) => {
    setLoading(true);
    setError(null);

    try {
      const response = await loginApi({
        email: values.email,
        password: values.password,
      });

      const { user } = response.data.data;
      login(user);
      navigate('/', { replace: true });
    } catch (err) {
      const message =
        err.response?.data?.error ||
        'Unable to connect to server. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Don't render login form if already authenticated (will redirect)
  if (isAuthenticated) {
    return null;
  }

  return (
    <div className="login-page">
      <Card className="login-card" bordered={false}>
        <div className="login-header">
          <Title level={3} className="login-title">
            UMA Enterprises
          </Title>
          <Text className="login-subtitle">
            Sign in to your account
          </Text>
        </div>

        {error && (
          <Alert
            className="login-error"
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
          requiredMark={false}
        >
          <Form.Item
            name="email"
            label="Username / Email"
            rules={[
              { required: true, message: 'Please enter your username' },
            ]}
          >
            <Input
              ref={emailRef}
              prefix={<MailOutlined />}
              placeholder="Enter your username"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: 'Please enter your password' },
              { min: 6, message: 'Password must be at least 6 characters' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Enter password"
              size="large"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              className="login-submit-btn"
            >
              Sign In
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
