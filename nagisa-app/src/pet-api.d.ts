interface Window {
  pet: {
    start(x: number, y: number): void;
    move(x: number, y: number): void;
    finish(x: number, y: number): Promise<boolean>;
    cancel(): void;
    readCare(): Promise<import('./care').CareSnapshot>;
    feedBread(revision: number): Promise<import('./care').CareResponse>;
    feedFood(id: import('./care').FoodId, revision: number): Promise<import('./care').CareResponse>;
    buyFood(id: import('./care').FoodId, quantity: number, revision: number): Promise<import('./care').CareResponse>;
    claimBread(revision: number): Promise<import('./care').CareResponse>;
    startActivity(kind: import('./care').ActivityKind, revision: number): Promise<import('./care').CareResponse>;
    cancelActivity(id: string, revision: number): Promise<import('./care').CareResponse>;
    openDangoGame(): Promise<void>;
    startDango(revision: number): Promise<import('./dango').DangoResponse<import('./dango').DangoPreview>>;
    pickDango(id: string, slot: import('./dango').DangoSlot): Promise<import('./dango').DangoResponse<import('./dango').DangoResult>>;
    leaveDango(id: string): Promise<void>;
    onCareChanged(callback: (change: import('./care').CareChange) => void): () => void;
    onFed(callback: (id: import('./care').FoodId) => void): () => void;
  };
}
