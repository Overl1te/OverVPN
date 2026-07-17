import { Alert, Checkbox, Collapse, Form, Input, InputNumber, Select, Typography } from 'antd';
import type { FormInstance } from 'antd/es/form';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PlanFormValues } from './planFormUtils';

type InboundOption = {
  value: string;
  label: string;
};

type Props = {
  form: FormInstance<PlanFormValues>;
  inboundOptions: InboundOption[];
  onFinish: (values: PlanFormValues) => void;
  showInboundEmptyLink?: boolean;
};

export function PlanFormFields({
  form,
  inboundOptions,
  onFinish,
  showInboundEmptyLink = true,
}: Props) {
  const { t } = useTranslation();
  const happProviderId = Form.useWatch('happProviderId', form);
  const happAdvancedEnabled = Boolean(happProviderId?.trim());

  return (
    <Form form={form} layout="vertical" onFinish={onFinish}>
      <Form.Item name="name" label={t('plans.name')} rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="description" label={t('plans.description')}>
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item
        name="defaultDataLimitGiB"
        label={t('plans.trafficLimit')}
        extra={t('plans.trafficLimitHint')}
      >
        <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder={t('app.unlimited')} />
      </Form.Item>
      <Form.Item name="defaultExpiryDays" label={t('app.days')}>
        <InputNumber min={1} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name="defaultDeviceLimit"
        label={t('users.deviceLimit')}
        extra={t('users.deviceLimitHint')}
      >
        <InputNumber min={1} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item
        name="defaultSpeedLimitMbps"
        label={t('plans.speedLimit')}
        extra={t('plans.speedLimitHint')}
      >
        <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder={t('app.unlimited')} />
      </Form.Item>
      <Form.Item name="defaultResetStrategy" label={t('users.resetStrategy')}>
        <Select
          options={['NO_RESET', 'DAILY', 'MONTHLY', 'YEARLY'].map((value) => ({
            value,
            label: t(`enums.resetStrategy.${value}`),
          }))}
        />
      </Form.Item>
      <Form.Item
        name="inboundIds"
        label={t('plans.inboundIds')}
        rules={[
          {
            required: true,
            type: 'array',
            min: 1,
            message: t('plans.inboundsRequired'),
          },
        ]}
        extra={t('plans.inboundsRequired')}
      >
        <Select mode="multiple" options={inboundOptions} />
      </Form.Item>
      {inboundOptions.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('plans.inboundsEmpty')}
          description={
            showInboundEmptyLink ? (
              <Typography.Text>
                {t('plans.inboundsRequired')} <Link to="/inbounds">{t('nav.inbounds')}</Link>
              </Typography.Text>
            ) : (
              t('plans.inboundsRequired')
            )
          }
        />
      ) : null}
      <Collapse
        style={{ marginBottom: 8 }}
        items={[
          {
            key: 'subscription',
            label: t('plans.subscriptionBranding'),
            children: (
              <>
                <Form.Item
                  name="subscriptionTitleTemplate"
                  label={t('plans.subscriptionTitleTemplate')}
                  extra={t('plans.subscriptionTitleTemplateHint')}
                >
                  <Input placeholder="{product} - {username}" maxLength={200} />
                </Form.Item>
                <Form.Item
                  name="subscriptionAnnounce"
                  label={t('plans.subscriptionAnnounce')}
                  extra={t('plans.subscriptionAnnounceHint')}
                >
                  <Input.TextArea rows={2} maxLength={500} showCount />
                </Form.Item>
                <Form.Item
                  name="subscriptionSupportUrl"
                  label={t('plans.subscriptionSupportUrl')}
                  extra={t('plans.subscriptionSupportUrlHint')}
                >
                  <Input placeholder="https://t.me/your_support" maxLength={2048} />
                </Form.Item>
                <Form.Item
                  name="subscriptionWebPageUrl"
                  label={t('plans.subscriptionWebPageUrl')}
                  extra={t('plans.subscriptionWebPageUrlHint')}
                >
                  <Input placeholder="https://example.com/info" maxLength={2048} />
                </Form.Item>
                <Form.Item
                  name="subscriptionShowTrafficLimits"
                  valuePropName="checked"
                  extra={t('plans.subscriptionShowTrafficLimitsHint')}
                >
                  <Checkbox>{t('plans.subscriptionShowTrafficLimits')}</Checkbox>
                </Form.Item>
                <Form.Item
                  name="happProviderId"
                  label={t('plans.happProviderId')}
                  extra={t('plans.happProviderIdHint')}
                >
                  <Input maxLength={128} />
                </Form.Item>
                {!happAdvancedEnabled ? (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={t('plans.happProviderRequired')}
                  />
                ) : null}
                <Form.Item
                  name="subscriptionSubInfoText"
                  label={t('plans.subscriptionSubInfoText')}
                  extra={t('plans.subscriptionSubInfoTextHint')}
                >
                  <Input.TextArea
                    rows={2}
                    maxLength={500}
                    showCount
                    disabled={!happAdvancedEnabled}
                  />
                </Form.Item>
                <Form.Item
                  name="subscriptionSubInfoColor"
                  label={t('plans.subscriptionSubInfoColor')}
                >
                  <Select
                    allowClear
                    disabled={!happAdvancedEnabled}
                    options={[
                      { value: 'blue', label: t('plans.subInfoColor.blue') },
                      { value: 'green', label: t('plans.subInfoColor.green') },
                      { value: 'red', label: t('plans.subInfoColor.red') },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  name="subscriptionSubInfoButtonText"
                  label={t('plans.subscriptionSubInfoButtonText')}
                  extra={t('plans.subscriptionSubInfoButtonTextHint')}
                >
                  <Input maxLength={25} showCount disabled={!happAdvancedEnabled} />
                </Form.Item>
                <Form.Item
                  name="subscriptionSubInfoButtonLink"
                  label={t('plans.subscriptionSubInfoButtonLink')}
                  extra={t('plans.subscriptionSubInfoButtonLinkHint')}
                >
                  <Input
                    placeholder="https://t.me/your_bot"
                    maxLength={2048}
                    disabled={!happAdvancedEnabled}
                  />
                </Form.Item>
                <Form.Item
                  name="subscriptionSubExpireEnabled"
                  valuePropName="checked"
                  extra={t('plans.subscriptionSubExpireEnabledHint')}
                >
                  <Checkbox disabled={!happAdvancedEnabled}>
                    {t('plans.subscriptionSubExpireEnabled')}
                  </Checkbox>
                </Form.Item>
                <Form.Item
                  name="subscriptionSubExpireButtonLink"
                  label={t('plans.subscriptionSubExpireButtonLink')}
                  extra={t('plans.subscriptionSubExpireButtonLinkHint')}
                >
                  <Input
                    placeholder="https://t.me/your_bot"
                    maxLength={2048}
                    disabled={!happAdvancedEnabled}
                  />
                </Form.Item>
                <Form.Item
                  name="subscriptionFallbackUrlTemplate"
                  label={t('plans.subscriptionFallbackUrlTemplate')}
                  extra={t('plans.subscriptionFallbackUrlTemplateHint')}
                >
                  <Input
                    placeholder="https://backup.example.com/api/sub/{token}"
                    maxLength={2048}
                    disabled={!happAdvancedEnabled}
                  />
                </Form.Item>
                <Form.Item
                  name="subscriptionColorProfile"
                  label={t('plans.subscriptionColorProfile')}
                  extra={t('plans.subscriptionColorProfileHint')}
                >
                  <Input.TextArea
                    rows={4}
                    maxLength={65536}
                    showCount
                    disabled={!happAdvancedEnabled}
                  />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </Form>
  );
}
