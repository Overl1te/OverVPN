import type { ThemeConfig } from 'antd';

/** Dense professional admin theme — slate/teal. */
export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: '#0f766e',
    colorInfo: '#0e7490',
    colorSuccess: '#15803d',
    colorWarning: '#b45309',
    colorError: '#b91c1c',
    colorBgBase: '#f4f6f8',
    colorBgContainer: '#ffffff',
    colorBorder: '#d7dee7',
    colorText: '#1e293b',
    colorTextSecondary: '#64748b',
    borderRadius: 4,
    fontFamily: '"IBM Plex Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    fontSize: 13,
    controlHeight: 30,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: '#0f172a',
      siderBg: '#111827',
      bodyBg: '#f4f6f8',
      headerHeight: 48,
      headerPadding: '0 16px',
    },
    Menu: {
      darkItemBg: '#111827',
      darkSubMenuItemBg: '#0f172a',
      darkItemSelectedBg: '#0f766e',
      itemHeight: 36,
      fontSize: 13,
    },
    Table: {
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 8,
      headerBg: '#eef2f6',
    },
    Form: {
      itemMarginBottom: 12,
      verticalLabelPadding: '0 0 2px',
    },
    Card: {
      paddingLG: 16,
    },
  },
};
