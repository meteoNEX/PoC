"use client";

import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";

type Props = { children: ReactNode; onCaptured: (error: Error) => void };
type State = { error: Error | null };

export class ReportErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
    this.props.onCaptured(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boundary-fallback">
          <strong>Error boundary caught a render error.</strong>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Reset boundary
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function BoomOnRender({ armed }: { armed: boolean }) {
  if (armed) {
    throw new Error("React render error for Sentry PoC");
  }
  return null;
}

export function BoundaryBoomOnRender({ armed }: { armed: boolean }) {
  if (armed) {
    throw new Error("React error-boundary error for Sentry PoC");
  }
  return null;
}
