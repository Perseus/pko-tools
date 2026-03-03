import React from "react";
import { Button } from "@/components/ui/button";

type CanvasErrorBoundaryProps = {
  children: React.ReactNode;
  className?: string;
};

type CanvasErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class CanvasErrorBoundary extends React.Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || "Unknown render error",
    };
  }

  componentDidCatch(error: Error): void {
    console.error("Canvas render failure:", error);
  }

  private reset = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className={this.props.className ?? "absolute inset-0 flex items-center justify-center"}
        >
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="font-semibold">Viewport crashed</div>
            <div className="mt-1 text-xs text-destructive/80">
              {this.state.message || "An unexpected render error occurred."}
            </div>
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={this.reset}
            >
              Retry
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
