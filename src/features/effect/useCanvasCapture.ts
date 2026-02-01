import { useCallback, useRef, useState } from "react";

export function useCanvasCapture() {
  const [isRecording, setIsRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number>(0);

  const startRecording = useCallback(
    (canvas: HTMLCanvasElement, durationMs: number, fps = 30): Promise<Blob> => {
      return new Promise((resolve, reject) => {
        try {
          const stream = canvas.captureStream(fps);
          const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
            ? "video/webm;codecs=vp9"
            : "video/webm";

          const recorder = new MediaRecorder(stream, { mimeType });
          recorderRef.current = recorder;
          chunksRef.current = [];
          setIsRecording(true);
          setProgress(0);

          const startTime = Date.now();

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunksRef.current.push(event.data);
            }
          };

          recorder.onstop = () => {
            setIsRecording(false);
            setProgress(1);
            clearInterval(timerRef.current);
            const blob = new Blob(chunksRef.current, { type: mimeType });
            resolve(blob);
          };

          recorder.onerror = () => {
            setIsRecording(false);
            clearInterval(timerRef.current);
            reject(new Error("Recording failed"));
          };

          recorder.start(100); // Collect data every 100ms

          // Progress timer
          timerRef.current = window.setInterval(() => {
            const elapsed = Date.now() - startTime;
            setProgress(Math.min(elapsed / durationMs, 1));

            if (elapsed >= durationMs) {
              recorder.stop();
            }
          }, 100);
        } catch (error) {
          setIsRecording(false);
          reject(error);
        }
      });
    },
    [],
  );

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
    clearInterval(timerRef.current);
  }, []);

  return {
    startRecording,
    stopRecording,
    isRecording,
    progress,
  };
}
