let context: AudioContext | undefined;

export function playChime(volume: number) {
  if (volume <= 0) return;
  try {
    const audio = context ??= new AudioContext();
    void audio.resume().then(() => {
      const time = audio.currentTime;
      const level = audio.createGain();
      level.gain.setValueAtTime(0, time);
      level.gain.linearRampToValueAtTime(0.12 * volume / 100, time + 0.025);
      level.gain.exponentialRampToValueAtTime(0.001, time + 0.19);
      level.connect(audio.destination);
      const tone = audio.createOscillator();
      tone.frequency.setValueAtTime(587.33, time);
      tone.frequency.setValueAtTime(783.99, time + 0.07);
      tone.connect(level);
      tone.start(time);
      tone.stop(time + 0.2);
      tone.onended = () => { tone.disconnect(); level.disconnect(); };
    }).catch((error) => console.warn('提示音无法播放', error));
  } catch (error) { console.warn('提示音无法播放', error); }
}
