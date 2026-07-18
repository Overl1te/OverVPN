import { Button, Tour, Typography } from 'antd';
import type { TourProps, TourStepProps } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSetupProgress } from '@/hooks/useSetupProgress';
import { dispatchTourAssist, usePanelTour, type TourAssistAction } from '@/hooks/usePanelTour';
import { PanelTourSkipModal } from '@/components/PanelTourSkipModal';
import {
  PANEL_TOUR_STEPS,
  waitForSelector,
  type PanelTourStepDef,
} from '@/components/panelTourSteps';

function stepCopyKey(id: string, part: 'title' | 'body'): string {
  return `tour.steps.${id}.${part}`;
}

export function PanelTour() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setup = useSetupProgress();
  const tour = usePanelTour();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(0);
  const [skipOpen, setSkipOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const advancingRef = useRef(false);
  const startedRef = useRef(false);

  const defs = PANEL_TOUR_STEPS;

  const prepareStep = useCallback(
    async (index: number): Promise<boolean> => {
      const def = defs[index];
      if (!def) {
        return false;
      }
      if (def.route) {
        const path = location.pathname;
        const wanted = def.route;
        if (path !== wanted && !path.startsWith(`${wanted}/`)) {
          navigate(wanted);
        }
      }
      const el = await waitForSelector(def.target);
      return Boolean(el);
    },
    [defs, location.pathname, navigate],
  );

  const startTour = useCallback(async () => {
    setCurrent(0);
    setReady(false);
    setOpen(true);
    await prepareStep(0);
    setReady(true);
    tour.consumeRelaunch();
  }, [prepareStep, tour]);

  useEffect(() => {
    if (!tour.shouldAutoStart || tour.isLoading || startedRef.current) {
      return;
    }
    startedRef.current = true;
    void startTour();
  }, [tour.shouldAutoStart, tour.isLoading, startTour]);

  useEffect(() => {
    if (!tour.relaunchPending || tour.isLoading) {
      return;
    }
    if (open) {
      return;
    }
    startedRef.current = true;
    void startTour();
  }, [tour.relaunchPending, tour.isLoading, open, startTour]);

  const finishTour = useCallback(() => {
    setOpen(false);
    setSkipOpen(false);
    setReady(false);
    tour.dismissTour();
    startedRef.current = false;
    if (location.pathname !== '/dashboard') {
      navigate('/dashboard');
    }
  }, [location.pathname, navigate, tour]);

  const goToIndex = useCallback(
    async (index: number) => {
      if (advancingRef.current) {
        return;
      }
      if (index < 0) {
        return;
      }
      if (index >= defs.length) {
        finishTour();
        return;
      }
      advancingRef.current = true;
      setReady(false);
      try {
        await prepareStep(index);
        setCurrent(index);
        // Allow layout paint before showing fly animation target
        await new Promise((r) => window.setTimeout(r, 40));
        setReady(true);
      } finally {
        advancingRef.current = false;
      }
    },
    [defs.length, finishTour, prepareStep],
  );

  const goNext = useCallback(() => {
    void goToIndex(current + 1);
  }, [current, goToIndex]);

  const assistAlreadyDone = useCallback(
    (assist: TourAssistAction | undefined): boolean => {
      if (!assist) {
        return false;
      }
      if (assist === 'create-inbound') {
        return setup.steps[0]?.done === true;
      }
      if (assist === 'create-plan') {
        return setup.steps[1]?.done === true;
      }
      if (assist === 'create-user') {
        return setup.steps[2]?.done === true;
      }
      return false;
    },
    [setup.steps],
  );

  const renderDescription = useCallback(
    (def: PanelTourStepDef) => {
      const bodyKey = stepCopyKey(def.id, 'body');
      const done = def.assist && assistAlreadyDone(def.assist) ? t('tour.assistAlreadyDone') : null;

      return (
        <div className="panel-tour-desc">
          <Typography.Paragraph style={{ marginBottom: def.assist ? 12 : 0 }}>
            {t(bodyKey)}
          </Typography.Paragraph>
          {done ? (
            <Typography.Paragraph type="success" style={{ marginBottom: 12 }}>
              {done}
            </Typography.Paragraph>
          ) : null}
          {def.assist && !assistAlreadyDone(def.assist) ? (
            <Button
              type="default"
              size="small"
              onClick={() => {
                if (def.assist) {
                  dispatchTourAssist(def.assist);
                }
              }}
            >
              {t('tour.assistCreate')}
            </Button>
          ) : null}
        </div>
      );
    },
    [assistAlreadyDone, t],
  );

  const steps: TourStepProps[] = useMemo(
    () =>
      defs.map((def) => ({
        title: t(stepCopyKey(def.id, 'title')),
        description: renderDescription(def),
        target: () => document.querySelector(def.target) as HTMLElement,
        nextButtonProps: { style: { display: 'none' } },
        prevButtonProps: { style: { display: 'none' } },
        // Highlighted CTA clickable on assist steps; explain steps block target clicks
        // via Tour disabledInteraction below.
      })),
    [defs, renderDescription, t],
  );

  const currentDef = defs[current];
  const disabledInteraction = !currentDef?.allowTargetClick;

  const actionsRender: TourProps['actionsRender'] = () => (
    <div className="panel-tour-actions">
      <Button onClick={() => setSkipOpen(true)}>{t('tour.skip')}</Button>
      <Button type="primary" onClick={goNext}>
        {current >= defs.length - 1 ? t('tour.finish') : t('tour.next')}
      </Button>
    </div>
  );

  if (!tour.isOwner || !tour.onboardingTourEnabled) {
    return null;
  }

  return (
    <>
      <Tour
        open={open && ready}
        current={current}
        steps={steps}
        onClose={() => setSkipOpen(true)}
        disabledInteraction={disabledInteraction}
        mask={{ color: 'rgba(15, 23, 42, 0.55)' }}
        gap={{ offset: 4, radius: 8 }}
        zIndex={1100}
        actionsRender={actionsRender}
        indicatorsRender={(currentStep, total) => (
          <span className="panel-tour-indicator">
            {currentStep + 1} / {total}
          </span>
        )}
      />
      <PanelTourSkipModal
        open={skipOpen}
        onCancel={() => setSkipOpen(false)}
        onSkipStep={() => {
          setSkipOpen(false);
          goNext();
        }}
        onSkipAll={() => {
          setSkipOpen(false);
          finishTour();
        }}
      />
    </>
  );
}
