import { Typography } from 'antd';
import type { ReactNode } from 'react';

export function PageHeader({ title, extra }: { title: ReactNode; extra?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <Typography.Title level={4} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      {extra ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{extra}</div> : null}
    </div>
  );
}
