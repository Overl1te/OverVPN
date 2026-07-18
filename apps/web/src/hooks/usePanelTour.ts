import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthContext';
import { getSettings } from '@/api/settings';

const TOUR_DISMISSED_KEY = 'overvpn.panelTourDismissed';
const TOUR_RELAUNCH_KEY = 'overvpn.panelTourRelaunch';

export const TOUR_ASSIST_EVENT = 'overvpn-tour-assist';

export type TourAssistAction = 'create-inbound' | 'create-plan' | 'create-user';

export type TourAssistDetail = {
  action: TourAssistAction;
};

function readDismissed(): boolean {
  try {
    return localStorage.getItem(TOUR_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function readRelaunch(): boolean {
  try {
    return localStorage.getItem(TOUR_RELAUNCH_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissPanelTour(): void {
  try {
    localStorage.setItem(TOUR_DISMISSED_KEY, '1');
    localStorage.removeItem(TOUR_RELAUNCH_KEY);
  } catch {
    // ignore
  }
}

export function clearPanelTourDismissed(): void {
  try {
    localStorage.removeItem(TOUR_DISMISSED_KEY);
  } catch {
    // ignore
  }
}

export function requestPanelTourRelaunch(): void {
  try {
    localStorage.removeItem(TOUR_DISMISSED_KEY);
    localStorage.setItem(TOUR_RELAUNCH_KEY, '1');
  } catch {
    // ignore
  }
}

export function clearPanelTourRelaunch(): void {
  try {
    localStorage.removeItem(TOUR_RELAUNCH_KEY);
  } catch {
    // ignore
  }
}

export function dispatchTourAssist(action: TourAssistAction): void {
  window.dispatchEvent(
    new CustomEvent<TourAssistDetail>(TOUR_ASSIST_EVENT, { detail: { action } }),
  );
}

export function usePanelTour() {
  const { admin } = useAuth();
  const isOwner = admin?.role === 'OWNER';
  const [tourDismissed, setTourDismissed] = useState(readDismissed);
  const [relaunchPending, setRelaunchPending] = useState(readRelaunch);

  const settingsQuery = useQuery({
    queryKey: ['settings', 'panel-tour'],
    queryFn: getSettings,
    enabled: isOwner,
  });

  const onboardingTourEnabled = settingsQuery.data?.featureFlags.onboardingTour !== false;

  useEffect(() => {
    const onStorage = () => {
      setTourDismissed(readDismissed());
      setRelaunchPending(readRelaunch());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dismissTour = useCallback(() => {
    dismissPanelTour();
    setTourDismissed(true);
    setRelaunchPending(false);
  }, []);

  const relaunchTour = useCallback(() => {
    requestPanelTourRelaunch();
    setTourDismissed(false);
    setRelaunchPending(true);
  }, []);

  const consumeRelaunch = useCallback(() => {
    clearPanelTourRelaunch();
    setRelaunchPending(false);
  }, []);

  const shouldAutoStart = useMemo(
    () =>
      isOwner &&
      !settingsQuery.isLoading &&
      onboardingTourEnabled &&
      (!tourDismissed || relaunchPending),
    [isOwner, settingsQuery.isLoading, onboardingTourEnabled, tourDismissed, relaunchPending],
  );

  return {
    isOwner,
    isLoading: isOwner && settingsQuery.isLoading,
    onboardingTourEnabled,
    tourDismissed,
    shouldAutoStart,
    relaunchPending,
    dismissTour,
    relaunchTour,
    consumeRelaunch,
  };
}
