export type BoardRenderMode = 'normal' | 'large' | 'huge';

export function getBoardRenderMode(
  gridSize: { width: number; height: number },
  arrowCount: number,
  isLowEndDevice = false,
): BoardRenderMode {
  const width = Math.max(1, Number(gridSize.width) || 1);
  const height = Math.max(1, Number(gridSize.height) || 1);
  const area = width * height;
  const maxDim = Math.max(width, height);

  const largeArea = isLowEndDevice ? 1600 : 2200;
  const hugeArea = isLowEndDevice ? 3200 : 4800;
  const largeArrowCount = isLowEndDevice ? 220 : 320;
  const hugeArrowCount = isLowEndDevice ? 500 : 700;
  const largeMaxDim = isLowEndDevice ? 42 : 55;
  const hugeMaxDim = isLowEndDevice ? 70 : 85;

  if (area >= hugeArea || arrowCount >= hugeArrowCount || maxDim >= hugeMaxDim) {
    return 'huge';
  }

  if (area >= largeArea || arrowCount >= largeArrowCount || maxDim >= largeMaxDim) {
    return 'large';
  }

  return 'normal';
}
