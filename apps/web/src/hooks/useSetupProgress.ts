import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthContext';
import { listInbounds } from '@/api/inbounds';
import { listPlans } from '@/api/plans';
import { listUsers } from '@/api/users';

const WIZARD_DISMISSED_KEY = 'overvpn.setupWizardDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(WIZARD_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissSetupWizard(): void {
  try {
    localStorage.setItem(WIZARD_DISMISSED_KEY, '1');
  } catch {
    // ignore quota / private mode
  }
}

export function clearSetupWizardDismissed(): void {
  try {
    localStorage.removeItem(WIZARD_DISMISSED_KEY);
  } catch {
    // ignore
  }
}

export type SetupStepId = 'inbound' | 'plan' | 'user';

export type SetupStep = {
  id: SetupStepId;
  done: boolean;
};

export function useSetupProgress() {
  const { admin } = useAuth();
  const isOwner = admin?.role === 'OWNER';
  const [wizardDismissed, setWizardDismissed] = useState(readDismissed);

  const inboundsQuery = useQuery({
    queryKey: ['setup', 'inbounds'],
    queryFn: () => listInbounds({ page: 1, pageSize: 1 }),
    enabled: isOwner,
  });

  const plansQuery = useQuery({
    queryKey: ['setup', 'plans'],
    queryFn: () => listPlans({ page: 1, pageSize: 1 }),
    enabled: isOwner,
  });

  const usersQuery = useQuery({
    queryKey: ['setup', 'users'],
    queryFn: () => listUsers({ page: 1, pageSize: 1 }),
    enabled: isOwner,
  });

  const inboundCount = inboundsQuery.data?.pagination.total ?? 0;
  const planCount = plansQuery.data?.pagination.total ?? 0;
  const userCount = usersQuery.data?.pagination.total ?? 0;

  const steps = useMemo<SetupStep[]>(
    () => [
      { id: 'inbound', done: inboundCount > 0 },
      { id: 'plan', done: planCount > 0 },
      { id: 'user', done: userCount > 0 },
    ],
    [inboundCount, planCount, userCount],
  );

  const doneCount = steps.filter((step) => step.done).length;
  const complete = doneCount === steps.length;
  const isLoading =
    isOwner && (inboundsQuery.isLoading || plansQuery.isLoading || usersQuery.isLoading);

  useEffect(() => {
    if (complete) {
      clearSetupWizardDismissed();
      setWizardDismissed(false);
    }
  }, [complete]);

  const dismissWizard = useCallback(() => {
    dismissSetupWizard();
    setWizardDismissed(true);
  }, []);

  const shouldShowWizard = isOwner && !isLoading && !complete && !wizardDismissed;
  const shouldShowChecklist = isOwner && !isLoading && !complete;

  return {
    isOwner,
    isLoading,
    steps,
    doneCount,
    totalSteps: steps.length,
    complete,
    wizardDismissed,
    shouldShowWizard,
    shouldShowChecklist,
    dismissWizard,
    inboundCount,
    planCount,
    userCount,
  };
}
