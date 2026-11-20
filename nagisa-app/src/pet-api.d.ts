interface Window {
  pet: {
    start(x: number, y: number): void;
    move(x: number, y: number): void;
    finish(x: number, y: number): Promise<boolean>;
    cancel(): void;
    readCare(): Promise<import('./care').CareReadResult>;
    feedBread(revision: number): Promise<import('./care').FeedResponse>;
    onFed(callback: () => void): () => void;
  };
}
