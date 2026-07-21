export interface ViewTransform {
    k: number;
    x: number;
    y: number;
    width?: number;
    height?: number;
}

export interface ViewportSize {
    width: number;
    height: number;
}

export function keepPointStationary(
    transform: ViewTransform,
    oldPoint: [number, number],
    newPoint: [number, number],
): ViewTransform {
    return {
        ...transform,
        x: transform.x + transform.k * (oldPoint[0] - newPoint[0]),
        y: transform.y + transform.k * (oldPoint[1] - newPoint[1]),
    };
}

export function adaptToViewport(
    transform: ViewTransform,
    viewport: ViewportSize,
    activePoint?: [number, number],
): ViewTransform {
    const previous = transform.width && transform.height
        ? { width: transform.width, height: transform.height }
        : undefined;
    if (previous?.width === viewport.width && previous.height === viewport.height) {
        return { ...transform, ...viewport };
    }

    let x = transform.x + (viewport.width - (previous?.width ?? viewport.width)) / 2;
    let y = transform.y + (viewport.height - (previous?.height ?? viewport.height)) / 2;
    if (activePoint) {
        const wasVisible = !previous || (
            transform.k * activePoint[0] + transform.x >= 0
            && transform.k * activePoint[0] + transform.x <= previous.width
            && transform.k * activePoint[1] + transform.y >= 0
            && transform.k * activePoint[1] + transform.y <= previous.height
        );
        if (wasVisible) {
            const marginX = Math.min(64, viewport.width / 4);
            const marginY = Math.min(64, viewport.height / 4);
            const screenX = transform.k * activePoint[0] + x;
            const screenY = transform.k * activePoint[1] + y;
            x += Math.max(marginX, Math.min(viewport.width - marginX, screenX)) - screenX;
            y += Math.max(marginY, Math.min(viewport.height - marginY, screenY)) - screenY;
        }
    }
    return { k: transform.k, x, y, ...viewport };
}

export function keepTreeInViewport(
    transform: ViewTransform,
    viewport: ViewportSize,
    points: Array<[number, number]>,
    radius: number,
): ViewTransform {
    if (!points.length) return transform;
    const allowance = radius * 0.8; // Leave at least 10% of the node diameter visible.
    let closest: { dx: number; dy: number; distance: number } | undefined;
    for (const [px, py] of points) {
        const screenX = transform.k * px + transform.x;
        const screenY = transform.k * py + transform.y;
        const dx = Math.max(-allowance, Math.min(viewport.width + allowance, screenX)) - screenX;
        const dy = Math.max(-allowance, Math.min(viewport.height + allowance, screenY)) - screenY;
        if (dx === 0 && dy === 0) return transform;
        const distance = dx * dx + dy * dy;
        if (!closest || distance < closest.distance) closest = { dx, dy, distance };
    }
    return { ...transform, x: transform.x + closest!.dx, y: transform.y + closest!.dy };
}

export function fitPoints(points: Array<[number, number]>, viewport: ViewportSize, padding = 80): ViewTransform {
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const inset = Math.min(padding, viewport.width / 4, viewport.height / 4);
    const scale = Math.max(0.05, Math.min(
        1,
        (viewport.width - inset * 2) / Math.max(1, maxX - minX),
        (viewport.height - inset * 2) / Math.max(1, maxY - minY),
    ));
    return {
        k: scale,
        x: viewport.width / 2 - scale * (minX + maxX) / 2,
        y: viewport.height / 2 - scale * (minY + maxY) / 2,
        ...viewport,
    };
}
