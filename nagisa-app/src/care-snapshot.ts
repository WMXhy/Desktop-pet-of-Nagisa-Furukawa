import { useEffect, useRef, useState } from 'react';
import { activityDurations, type CareSnapshot } from './care';

export function useCareSnapshot() {
  const [care, setCare] = useState<CareSnapshot>();
  const [readStatus, setReadStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const updates = useRef(0);

  function updateSnapshot(snapshot: CareSnapshot) {
    setCare((previous) => previous?.ok && (!snapshot.ok || snapshot.state.revision < previous.state.revision)
      ? previous : snapshot);
  }

  async function loadCare() {
    const before = updates.current;
    try {
      const snapshot = await window.pet.readCare();
      setReadStatus((previous) => snapshot.ok || previous === 'ready' ? 'ready' : 'failed');
      // 退出未完成的对局只改变内存状态，推送可以比同修订号的读取回执更新。
      if (updates.current === before) updateSnapshot(snapshot);
    } catch (error) {
      console.error('无法读取养成状态', error);
      setReadStatus((previous) => previous === 'ready' ? previous : 'failed');
      if (updates.current === before) updateSnapshot({ ok: false, message: '暂时无法读取养成状态，请重试。',
        durations: activityDurations(), gameBusy: false });
    }
  }

  useEffect(() => {
    const unsubscribe = window.pet.onCareChanged(({ snapshot }) => {
      updates.current += 1;
      updateSnapshot(snapshot);
    });
    void loadCare();
    return unsubscribe;
  }, []);

  return { care, setCare, loadCare, readStatus };
}
