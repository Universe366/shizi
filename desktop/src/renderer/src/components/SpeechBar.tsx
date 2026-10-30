import { useEffect, useState } from 'react';
import { Pause, Play, Square, Volume2 } from 'lucide-react';
import {
  onSpeechState,
  pauseSpeech,
  resumeSpeech,
  speechState,
  stopSpeech,
  type SpeechState
} from '../lib/speech';

/** 全局朗读控制：暂停/继续/停止，避免多个朗读叠在一起时无法收手。 */
export function SpeechBar() {
  const [state, setState] = useState<SpeechState>(() => speechState());

  useEffect(() => onSpeechState(setState), []);

  if (!state.playing && !state.paused) return null;

  return (
    <div className="speech-bar" role="status" aria-live="polite">
      <Volume2 size={15} />
      <span className="speech-bar-label">{state.paused ? '朗读已暂停' : '正在朗读'}</span>
      <button
        className="speech-bar-btn"
        title={state.paused ? '继续朗读' : '暂停朗读'}
        onClick={() => (state.paused ? resumeSpeech() : pauseSpeech())}
      >
        {state.paused ? <Play size={13} /> : <Pause size={13} />}
        {state.paused ? '继续' : '暂停'}
      </button>
      <button className="speech-bar-btn" title="停止朗读" onClick={() => stopSpeech()}>
        <Square size={12} />
        停止
      </button>
    </div>
  );
}
