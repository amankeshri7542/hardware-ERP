import React from 'react';
import { Button, Form, Input, InputNumber, Select, Space } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { modeOptions, moneyModes } from './financeUi.js';
const required = { required: true, message: 'Required' };
export default function MoneyFields({ form, amountLabel }) {
  const mode = Form.useWatch('mode', form);
  return <>
    <Form.Item name="amount" label={amountLabel} rules={[required]}><InputNumber stringMode min="0.01" precision={2} style={{ width: '100%' }} /></Form.Item>
    <Form.Item name="mode" label="Confirmed money mode" rules={[required]}><Select aria-label="Confirmed money mode" options={modeOptions} /></Form.Item>
    <Form.Item name="reference_no" label="Payment reference"><Input maxLength={100} /></Form.Item>
    {mode === 'mixed' && <Form.List name="modes_detail">{(fields, { add, remove }) => <>
      {fields.map((field, index) => <Space key={field.key} align="start" wrap style={{ display: 'flex' }}>
        <Form.Item name={[field.name, 'mode']} label={`Money mode ${index + 1}`} rules={[required]}><Select aria-label={`Money mode ${index + 1}`} style={{ width: 130 }} options={moneyModes.map(value => ({ value, label: value.toUpperCase() }))} /></Form.Item>
        <Form.Item name={[field.name, 'amount']} label={`Mode amount ${index + 1}`} rules={[required]}><InputNumber stringMode min="0.01" precision={2} /></Form.Item>
        <Form.Item name={[field.name, 'reference_no']} label={`Mode reference ${index + 1}`}><Input maxLength={100} /></Form.Item>
        <Button aria-label={`Remove money mode ${index + 1}`} icon={<DeleteOutlined />} onClick={() => remove(field.name)} style={{ marginTop: 30 }} disabled={fields.length <= 2} />
      </Space>)}<Button onClick={() => add()} icon={<PlusOutlined />}>Add money mode</Button>
    </>}</Form.List>}
  </>;
}
