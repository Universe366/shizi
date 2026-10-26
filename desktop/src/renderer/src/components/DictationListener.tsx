import { useEffect, useRef } from 'react';

/** 全局听写：主进程热键触发录音，识别后回传文字（由主进程粘贴）。 */
export function DictationListener() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const cleanup = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };

    const stop = () => {
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      } catch {
        // ignore
      }
    };

    const start = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunksRef.current.push(event.data);
        };
        recorder.onstop = async () => {
          if (timerRef.current) window.clearTimeout(timerRef.current);
          timerRef.current = null;
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          try {
            const blob = new Blob(chunksRef.current, {
              type: recorder.mimeType || 'audio/webm'
            });
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(reader.error || new Error('读取录音失败'));
              reader.readAsDataURL(blob);
            });
            const response = await window.bsub.transcribeVoice(dataUrl);
            if (response.ok && response.data.text.trim()) {
              window.bsub.dictationFinish({ text: response.data.text.trim() });
            } else {
              window.bsub.dictationFinish({
                text: '',
                error: response.ok ? '没有识别到语音' : response.error
              });
            }
          } catch (error) {
            window.bsub.dictationFinish({
              text: '',
              error: `语音识别失败：${(error as Error).message}`
            });
          } finally {
            busyRef.current = false;
          }
        };
        recorder.start();
        recorderRef.current = recorder;
        // 最长 30 秒，避免忘记停止一直占麦克风
        timerRef.current = window.setTimeout(stop, 30000);
      } catch (error) {
        busyRef.current = false;
        window.bsub.dictationFinish({
          text: '',
          error: `无法使用麦克风：${(error as Error).message}`
        });
      }
    };

    const offStart = window.bsub.onDictationStart(() => void start());
    const offStop = window.bsub.onDictationStop(() => stop());
    return () => {
      offStart();
      offStop();
      cleanup();
    };
  }, []);

  return null;
}
