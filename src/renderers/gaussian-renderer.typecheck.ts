import type { GaussianRenderer } from './gaussian-renderer';

// Keep async reference rendering from accepting an eagerly acquired canvas view.
// This compile-time guard also rejects a union that reintroduces that unsafe path.
type RequireViewFactory<T extends () => GPUTextureView> = T;
export type ReferenceFrameRequiresDeferredView = RequireViewFactory<Parameters<GaussianRenderer['referenceFrame']>[0]>;
