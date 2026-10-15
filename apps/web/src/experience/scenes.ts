import type { SceneComponent } from './contracts';
import { MerkezScene } from '../scenes/merkez';

/** slug -> scene component. Only chapters with status 'ready' in chapters.ts appear here. */
export const SCENES: Record<string, SceneComponent> = {
  merkez: MerkezScene,
};
