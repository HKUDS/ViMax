"use client";

import { Component, type ReactNode } from "react";
import { ErrorFallback, type ErrorFallbackProps } from "./ErrorFallback";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /** Props passed to the default ErrorFallback */
  fallbackProps?: Omit<ErrorFallbackProps, "error" | "onRetry">;
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleRetry}
          {...this.props.fallbackProps}
        />
      );
    }

    return this.props.children;
  }
}
