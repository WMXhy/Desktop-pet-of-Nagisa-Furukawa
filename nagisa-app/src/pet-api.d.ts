interface Window {
  pet: {
    start(x: number, y: number): void;
    move(x: number, y: number): void;
    finish(x: number, y: number): Promise<boolean>;
    cancel(): void;
    readCare(): Promise<import('./care').CareSnapshot>;
    feedBread(revision: number): Promise<import('./care').CareResponse>;
    startActivity(kind: import('./care').ActivityKind, revision: number): Promise<import('./care').CareResponse>;
    cancelActivity(id: string, revision: number): Promise<import('./care').CareResponse>;
    onCareChanged(callback: (change: import('./care').CareChange) => void): () => void;
    onFed(callback: () => void): () => void;
  };
}
