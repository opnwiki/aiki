"""Trace the approved raster wordmark into font-independent SVG outlines.

Requires Pillow and NumPy. Only the black lettering is traced; the supplied
crop must contain the wordmark, including its orbital strokes.
"""
from argparse import ArgumentParser
from pathlib import Path

import numpy as np
from PIL import Image


def simplify(points, tolerance=0.4):
    if len(points) < 3:
        return points
    start, end = np.array(points[0]), np.array(points[-1])
    values = np.array(points)
    delta = end - start
    length = np.linalg.norm(delta)
    if length < 1e-9:
        distances = np.linalg.norm(values - start, axis=1)
    else:
        distances = np.abs(delta[0] * (values[:, 1] - start[1]) - delta[1] * (values[:, 0] - start[0])) / length
    split = int(np.argmax(distances))
    if distances[split] > tolerance:
        return simplify(points[:split + 1], tolerance)[:-1] + simplify(points[split:], tolerance)
    return [points[0], points[-1]]


def trace(image):
    rgb = np.asarray(image.convert('RGB'), dtype=np.float64)
    # A neutral black mask keeps adjacent blue galaxy wisps out of the SVG.
    neutral = (rgb.max(axis=2) - rgb.min(axis=2)) < 24
    ink = np.where(neutral, 1 - rgb.max(axis=2) / 255, 0)
    ink = np.pad(ink, 1)
    vertices, adjacency = {}, {}
    cases = {
        1: [(3, 0)], 2: [(0, 1)], 3: [(3, 1)], 4: [(1, 2)],
        5: [(3, 0), (1, 2)], 6: [(0, 2)], 7: [(3, 2)],
        8: [(2, 3)], 9: [(2, 0)], 10: [(0, 1), (2, 3)],
        11: [(2, 1)], 12: [(1, 3)], 13: [(1, 0)], 14: [(0, 3)],
    }
    bits = ((ink[:-1, :-1] >= .5).astype(np.int32)
            + 2 * (ink[:-1, 1:] >= .5)
            + 4 * (ink[1:, 1:] >= .5)
            + 8 * (ink[1:, :-1] >= .5))
    for y, x in zip(*np.where((bits > 0) & (bits < 15))):
        for edge_a, edge_b in cases[int(bits[y, x])]:
            keys = []
            for edge in (edge_a, edge_b):
                if edge == 0:
                    key, p, q = ('h', x, y), (x, y), (x + 1, y)
                elif edge == 1:
                    key, p, q = ('v', x + 1, y), (x + 1, y), (x + 1, y + 1)
                elif edge == 2:
                    key, p, q = ('h', x, y + 1), (x, y + 1), (x + 1, y + 1)
                else:
                    key, p, q = ('v', x, y), (x, y), (x, y + 1)
                if key not in vertices:
                    a, b = ink[p[1], p[0]], ink[q[1], q[0]]
                    fraction = (.5 - a) / (b - a)
                    vertices[key] = (p[0] + fraction * (q[0] - p[0]) - 1, p[1] + fraction * (q[1] - p[1]) - 1)
                keys.append(key)
            a, b = keys
            adjacency.setdefault(a, []).append(b)
            adjacency.setdefault(b, []).append(a)
    visited, loops = set(), []
    for start in adjacency:
        if start in visited:
            continue
        current, previous, points = start, None, []
        while current not in visited:
            visited.add(current)
            points.append(vertices[current])
            neighbors = adjacency[current]
            following = next(key for key in neighbors if key != previous)
            previous, current = current, following
        area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1]))) / 2
        if area < 2:
            continue
        split = int(np.argmax(np.linalg.norm(np.array(points) - points[0], axis=1)))
        loop = simplify(points[:split + 1])[:-1] + simplify(points[split:] + [points[0]])[:-1]
        loops.append(loop)
    all_points = np.array([point for loop in loops for point in loop])
    left, top = all_points.min(axis=0) - 2
    right, bottom = all_points.max(axis=0) + 2
    paths = []
    for loop in loops:
        values = [f'{x - left:.2f},{y - top:.2f}' for x, y in loop]
        paths.append('M' + 'L'.join(values) + 'Z')
    width, height = right - left, bottom - top
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.2f} {height:.2f}" width="{width:.2f}" height="{height:.2f}" role="img" aria-labelledby="aiki-title">\n  <title id="aiki-title">AIKI</title>\n  <path fill="#111111" fill-rule="evenodd" d="{" ".join(paths)}"/>\n</svg>\n'
    return svg, len(loops), sum(len(loop) for loop in loops)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    svg, loops, points = trace(Image.open(args.source))
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    args.destination.write_text(svg, encoding='utf-8')
    print(f'{args.destination}: {loops} contours, {points} vector points')


if __name__ == '__main__':
    main()
