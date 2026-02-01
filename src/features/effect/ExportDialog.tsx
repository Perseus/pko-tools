import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { effectPlaybackAtom, selectedFrameIndexAtom } from "@/store/effect";
import { useAtom } from "jotai";
import { Download, Video, Square } from "lucide-react";
import React from "react";
import { useCallback, useState } from "react";
import { useCanvasCapture } from "@/features/effect/useCanvasCapture";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Total effect duration in seconds. */
  duration: number;
}

export default function ExportDialog({
  open,
  onOpenChange,
  duration,
}: ExportDialogProps) {
  const { startRecording, stopRecording, isRecording, progress } = useCanvasCapture();
  const [playback, setPlayback] = useAtom(effectPlaybackAtom);
  const [, setSelectedFrame] = useAtom(selectedFrameIndexAtom);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [fps, setFps] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const handleRecord = useCallback(async () => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      setError("No canvas element found.");
      return;
    }

    setBlob(null);
    setError(null);

    // Reset playback to frame 0 and start playing
    setSelectedFrame(0);
    setPlayback({
      ...playback,
      isPlaying: true,
      currentTime: 0,
      speed: 1,
    });

    // Close the dialog so the canvas is fully visible during recording
    onOpenChange(false);

    const durationMs = Math.max(duration * 1000, 1000);

    try {
      const result = await startRecording(canvas, durationMs, fps);
      setBlob(result);
      setPlayback((prev) => ({ ...prev, isPlaying: false }));
      // Re-open dialog to show the download button
      onOpenChange(true);
    } catch (err) {
      setPlayback((prev) => ({ ...prev, isPlaying: false }));
      setError(err instanceof Error ? err.message : "Recording failed");
      onOpenChange(true);
    }
  }, [duration, fps, playback, setPlayback, setSelectedFrame, startRecording, onOpenChange]);

  const handleStop = useCallback(() => {
    stopRecording();
    setPlayback((prev) => ({ ...prev, isPlaying: false }));
  }, [stopRecording, setPlayback]);

  const handleDownload = useCallback(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "effect-capture.webm";
    a.click();
    URL.revokeObjectURL(url);
  }, [blob]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Effect Preview</DialogTitle>
            <DialogDescription>
              Record the viewport to a .webm video file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Duration:</span>
              <span>{duration.toFixed(2)}s</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Frame rate:</span>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="h-7 rounded border border-input bg-background px-2 text-xs"
                disabled={isRecording}
              >
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </div>
            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}
            {blob && !isRecording && (
              <div className="rounded-lg border border-border bg-muted/50 p-3 text-center text-xs text-muted-foreground">
                Recording complete ({(blob.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>
          <DialogFooter>
            <>
              <Button onClick={handleRecord} size="sm" disabled={isRecording}>
                <Video className="mr-1 h-3 w-3" />
                Record
              </Button>
              {blob && (
                <Button onClick={handleDownload} variant="outline" size="sm">
                  <Download className="mr-1 h-3 w-3" />
                  Download
                </Button>
              )}
            </>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recording indicator overlay — shown when dialog is closed during capture */}
      {isRecording && !open && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-border bg-background/90 px-4 py-2 shadow-lg backdrop-blur-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="text-xs text-muted-foreground">
            Recording... {Math.round(progress * 100)}%
          </span>
          <Button onClick={handleStop} variant="destructive" size="sm" className="h-6 px-2 text-xs">
            <Square className="mr-1 h-3 w-3" />
            Stop
          </Button>
        </div>
      )}
    </>
  );
}
