"""Convert NOAA ERDDAP CSV to the 720 × 360 signed-meter grid used by the renderer."""

import argparse
import csv
import io
import math
from pathlib import Path
import struct
from urllib.parse import quote
from urllib.request import urlopen


BASE = 'https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s.csv?'
QUERY = 'z[0:30:10799][0:30:21599]'
WIDTH, HEIGHT = 720, 360
STEP = 0.5
FIRST_LAT, FIRST_LON = -90 + 1 / 120, 1 / 120


def convert(source):
    rows = csv.reader(source)
    if next(rows, None) != ['latitude', 'longitude', 'z']:
        raise ValueError('Unexpected NOAA CSV header')
    if next(rows, None) != ['degrees_north', 'degrees_east', 'meters']:
        raise ValueError('Unexpected NOAA CSV units')

    values = []
    for i, (lat, lon, height) in enumerate(rows):
        row, col = divmod(i, WIDTH)
        if not (math.isclose(float(lat), FIRST_LAT + row * STEP, abs_tol=1e-6)
                and math.isclose(float(lon), FIRST_LON + col * STEP, abs_tol=1e-6)):
            raise ValueError(f'Unexpected coordinates on data row {i + 1}')
        values.append(round(float(height)))
    if len(values) != WIDTH * HEIGHT:
        raise ValueError(f'Expected {WIDTH * HEIGHT} samples, got {len(values)}')
    return struct.pack(f'<{len(values)}h', *values)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', type=Path, help='Pre-downloaded ERDDAP CSV')
    parser.add_argument('--output', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'data' / 'etopo-0.5deg.i16')
    args = parser.parse_args()
    if args.csv:
        with args.csv.open(encoding='utf-8', newline='') as source:
            binary = convert(source)
    else:
        with urlopen(BASE + quote(QUERY, safe=''), timeout=90) as response:
            with io.TextIOWrapper(response, encoding='utf-8', newline='') as source:
                binary = convert(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(binary)
    print(f'{args.output}: {len(binary)} bytes ({WIDTH} × {HEIGHT} samples)')


if __name__ == '__main__':
    main()
