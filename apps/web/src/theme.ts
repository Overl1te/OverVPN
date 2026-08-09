import { theme, type ThemeConfig } from 'antd';

/** Dense professional admin theme — slate/teal dark. */
export const adminTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#14b8a6',
    colorInfo: '#22d3ee',
    colorSuccess: '#22c55e',
    colorWarning: '#f59e0b',
    colorError: '#f87171',
    colorBgBase: '#0b1220',
    colorBgContainer: '#111827',
    colorBgElevated: '#1a2332',
    colorBorder: '#1e293b',
    colorBorderSecondary: '#243044',
    colorText: '#e2e8f0',
    colorTextSecondary: '#94a3b8',
    colorTextTertiary: '#64748b',
    borderRadius: 4,
    fontFamily: '"IBM Plex Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    fontSize: 13,
    controlHeight: 30,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: '#0a101c',
      siderBg: '#0a101c',
      bodyBg: '#0b1220',
      headerHeight: 48,
      headerPadding: '0 16px',
      triggerBg: '#111827',
      triggerColor: '#94a3b8',
    },
    Menu: {
      darkItemBg: '#0a101c',
      darkSubMenuItemBg: '#070b14',
      darkItemSelectedBg: '#0f766e',
      darkItemHoverBg: '#122033',
      itemHeight: 36,
      fontSize: 13,
    },
    Table: {
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 8,
      headerBg: '#151e2e',
      rowHoverBg: '#172033',
      borderColor: '#1e293b',
    },
    Form: {
      itemMarginBottom: 12,
      verticalLabelPadding: '0 0 2px',
    },
    Card: {
      paddingLG: 16,
      colorBgContainer: '#111827',
    },
    Modal: {
      contentBg: '#111827',
      headerBg: '#111827',
    },
    Input: {
      activeBorderColor: '#14b8a6',
      hoverBorderColor: '#2dd4bf',
    },
    Button: {
      primaryShadow: '0 0 0 1px rgba(20, 184, 166, 0.18)',
    },
  },
};
