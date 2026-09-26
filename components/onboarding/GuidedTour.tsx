"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BG2, BORDER, DIM, MONO, TEXT } from "@/lib/constants";

const STORAGE_KEY = "drips.guidedTour.dismissed";

interface TourStep {
  title: string;
  body: string;
  target?: string;
}

const STEPS: TourStep[] = [
  {
    title: "Welcome to the dashboard",
    body: "This is your overview of the Drips Wave dashboard. Use the tabs to move between the dashboard, transactions, and docs.",
  },
  {
    title: "Mock vs. live data",
    body: "Until you connect a wallet, the dashboard shows simulated (mock) data so you can explore safely. Once connected, live on-chain data replaces the mock values.",
    target: "[data-tour='dashboard-tab']",
  },
  {
    title: "Connect your wallet",
    body: "Connect a wallet to switch from mock data to live data and interact with real transactions.",
    target: "[data-tour='wallet-connect']",
  },
  {
    title: "Find the docs",
    body: "New here? The Docs tab has setup guides and references to help you get started.",
    target: "[data-tour='docs-tab']",
  },
];

function readDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismissed() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore storage failures */
  }
}

interface GuidedTourProps {
  /** Increment to manually re-trigger the tour from outside. */
  trigger?: number;
}

export function GuidedTour({ trigger = 0 }: GuidedTourProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!readDismissed()) setOpen(true);
  }, []);

  useEffect(() => {
    if (trigger > 0) {
      setStep(0);
      setOpen(true);
    }
  }, [trigger]);

  const dismiss = useCallback(() => {
    persistDismissed();
    setOpen(false);
  }, []);

  const next = useCallback(() => {
    setStep((s) => {
      if (s >= STEPS.length - 1) {
        persistDismissed();
        setOpen(false);
        return s;
      }
      return s + 1;
    });
  }, []);

  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  const current = STEPS[step];

  const rect = useMemo(() => {
    if (!open || !current?.target || typeof document === "undefined") return null;
    const el = document.querySelector(current.target);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }, [open, current, step]);

  if (!open || !current) return null;

  const isLast = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Guided tour"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.55)",
      }}
    >
      {rect && (
        <div
          style={{
            position: "fixed",
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            border: `2px solid ${TEXT}`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 320,
          background: BG2,
          border: `1px solid ${BORDER}`,
          padding: "16px 18px",
        }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: "0.14em",
            color: DIM,
            fontFamily: MONO,
            marginBottom: 8,
          }}
        >
          STEP {step + 1} / {STEPS.length}
        </div>
        <div style={{ fontSize: 14, color: TEXT, marginBottom: 8 }}>{current.title}</div>
        <div style={{ fontSize: 12, color: DIM, lineHeight: 1.5, marginBottom: 16 }}>
          {current.body}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button
            type="button"
            onClick={dismiss}
            style={{
              background: "transparent",
              border: "none",
              color: DIM,
              fontFamily: MONO,
              fontSize: 11,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Skip tour
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button
                type="button"
                onClick={back}
                style={{
                  background: "transparent",
                  border: `1px solid ${BORDER}`,
                  color: TEXT,
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: "pointer",
                  padding: "6px 12px",
                }}
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={next}
              style={{
                background: TEXT,
                border: `1px solid ${TEXT}`,
                color: BG2,
                fontFamily: MONO,
                fontSize: 11,
                cursor: "pointer",
                padding: "6px 12px",
              }}
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
