export {
  changeKey,
  computeSyncPlan,
  footprintFits,
  isOutOfSync,
  linkEndsEqual,
  linksTouchingComponent,
  routesTouchingComponent,
} from './diff';
export { applySyncPlan, copyEnd, type ApplySummary } from './apply';
export {
  acceptBackAnnotation,
  proposeFootprintChange,
  proposePortSwap,
  proposeRefRename,
  rejectBackAnnotation,
  validateFootprintChange,
  validatePortSwap,
  validateRefRename,
  type AcceptResult,
} from './backAnnotate';
