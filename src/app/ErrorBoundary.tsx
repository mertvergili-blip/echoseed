import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Label shown in the recovery message, e.g. "Terrarium" or "Desktop Creature". */
  label: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches unexpected render errors so a bug in one view doesn't present as a
 * blank white screen with no explanation. This is a safety net, not a
 * substitute for fixing root causes — every crash it catches should still be
 * treated as a bug, but the player gets a legible recovery option instead of
 * an app that appears to have silently died.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}] unhandled render error:`, error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            width: "100%",
            gap: 16,
            padding: 24,
            background: "#05070c",
            color: "#cdd9ea",
            fontFamily: "Inter, system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 13, letterSpacing: "0.16em", color: "#8be9fd", textTransform: "uppercase" }}>
            {this.props.label} hit an unexpected error
          </div>
          <div style={{ fontSize: 12, color: "#7d8ba3", maxWidth: 420 }}>
            {this.state.error.message || "Something went wrong while rendering this view."}
            <br />
            Your last save was not affected — reloading returns you to it.
          </div>
          <button
            onClick={this.reload}
            style={{
              background: "rgba(139, 233, 253, 0.14)",
              border: "1px solid rgba(139, 233, 253, 0.35)",
              color: "#8be9fd",
              borderRadius: 7,
              padding: "8px 16px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
