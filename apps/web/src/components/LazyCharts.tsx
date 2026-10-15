import { lazy, Suspense } from 'react';
import type { DailyPoint, ModelSlice } from '@orbit/core';
import { Skeleton } from './states';
import type { DailyMetric } from './charts';

const Daily = lazy(() => import('./charts').then((m) => ({ default: m.DailyChart })));
const Area = lazy(() => import('./charts').then((m) => ({ default: m.RequestsAreaChart })));
const Donut = lazy(() => import('./charts').then((m) => ({ default: m.ModelDonut })));

export const DailyChartLazy = (p: { daily: DailyPoint[]; metric: DailyMetric }) => (
  <Suspense fallback={<Skeleton height={300} />}>
    <Daily {...p} />
  </Suspense>
);
export const ModelDonutLazy = (p: { models: ModelSlice[] }) => (
  <Suspense fallback={<Skeleton height={180} />}>
    <Donut {...p} />
  </Suspense>
);
export const RequestsAreaChartLazy = (p: { points: { t: number; processed: number }[] }) => (
  <Suspense fallback={<Skeleton height={220} />}>
    <Area {...p} />
  </Suspense>
);
