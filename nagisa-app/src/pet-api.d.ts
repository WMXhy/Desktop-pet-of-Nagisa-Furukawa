type PickupPose = 'hold' | 'left' | 'right';
type PickupChange = { id: number; pose: PickupPose | null };

interface Window {
  pet: {
    start(id: number, x: number, y: number): void;
    move(id: number, x: number, y: number): void;
    finish(id: number, x: number, y: number): Promise<boolean>;
    cancel(id: number): void;
    onPickupChanged(callback: (change: PickupChange) => void): () => void;
    readCare(): Promise<import('./care').CareSnapshot>;
    greetToday(): Promise<import('./care').GreetingResponse>;
    feedBread(revision: number, epoch?: number): Promise<import('./care').CareResponse>;
    feedFood(id: import('./care').FoodId, revision: number, epoch?: number): Promise<import('./care').CareResponse>;
    buyFood(id: import('./care').FoodId, quantity: number, revision: number, epoch?: number): Promise<import('./care').CareResponse>;
    buyToy(id: import('./care').ToyId, revision: number, epoch?: number): Promise<import('./care').CareResponse>;
    hugDango(): Promise<import('./care').CareResponse>;
    listenToLine(): Promise<import('./care').CareResponse>;
    claimBread(revision: number, epoch?: number): Promise<import('./care').CareResponse>;
    startActivity(kind: import('./care').ActivityKind, revision: number, epoch?: number): Promise<import('./care').CareResponse>;
    cancelActivity(id: string, revision: number, epoch?: number): Promise<import('./care').CareResponse>;
    openDangoGame(mode?: import('./dango').DangoMode): Promise<void>;
    readDangoMode(): Promise<import('./dango').DangoMode>;
    startDango(revision: number, mode?: import('./dango').DangoMode, epoch?: number): Promise<import('./dango').DangoResponse<import('./dango').DangoPreview>>;
    pickDango(id: string, slot: import('./dango').DangoSlot): Promise<import('./dango').DangoResponse<import('./dango').DangoResult>>;
    leaveDango(id: string): Promise<void>;
    openSettings(): Promise<void>;
    readSettings(): Promise<import('./settings').SettingsView>;
    previewSettings(draft: import('./settings').Settings): Promise<import('./settings').SettingsResult>;
    applySettings(draft: import('./settings').Settings): Promise<import('./settings').SettingsResult>;
    cancelSettings(): Promise<import('./settings').SettingsView>;
    resetPositionPreview(): Promise<void>;
    previewAnimation(): Promise<import('./settings').SettingsResult>;
    dismissOnboarding(): Promise<import('./settings').SettingsResult>;
    exportData(): Promise<import('./save-transfer').TransferResponse>;
    previewData(action: import('./save-transfer').TransferAction): Promise<import('./save-transfer').TransferResponse>;
    applyData(token: string, confirm?: string): Promise<import('./save-transfer').TransferResponse>;
    cancelData(): Promise<void>;
    onSettingsChanged(callback: (view: import('./settings').SettingsView) => void): () => void;
    onPreviewAnimation(callback: () => void): () => void;
    onJournalSection(callback: (section: import('./settings').JournalSection) => void): () => void;
    onCareChanged(callback: (change: import('./care').CareChange) => void): () => void;
    onFed(callback: (id: import('./care').FoodId) => void): () => void;
    onHug(callback: () => void): () => void;
    onListenToLine(callback: () => void): () => void;
    onDangoMode(callback: (mode: import('./dango').DangoMode) => void): () => void;
  };
}
