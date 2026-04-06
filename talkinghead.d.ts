declare module '@met4citizen/talkinghead' {
  export class TalkingHead {
    constructor(node: HTMLElement, options?: Record<string, unknown>);
    showAvatar(avatar: Record<string, unknown>): Promise<void>;
    speakAudio(audio: Record<string, unknown>, opt?: Record<string, unknown>): void;
    stopSpeaking(): void;
    lookAtCamera(durationMs: number): void;
    setMood(mood: string): void;
    dispose(): void;
  }
}
