"""Validate/render synthetic output with the separately installed Poppler tools."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('samples', type=Path)
parser.add_argument('--tools-dir', type=Path)
args = parser.parse_args()
def tool(name):
    result = str(args.tools_dir / name) if args.tools_dir else shutil.which(name)
    if not result or not Path(result).is_file():
        raise SystemExit(f'BLOCKED: {name} is required for actual PDF content/output verification')
    return result
text_tool, info_tool, image_tool = [tool(name) for name in ('pdftotext', 'pdfinfo', 'pdftoppm')]
results = []
for kind, layout, rows in [('sale', 'a4', 90), ('sale', 'thermal80', 4), ('receipt', 'a4', 2), ('receipt', 'thermal80', 2), ('sales_credit', 'a4', 6), ('customer_statement', 'a4', 80)]:
    source = args.samples / f'{kind}-{layout}.pdf'
    data = source.read_bytes()
    assert data.startswith(b'%PDF-') and data.rstrip().endswith(b'%%EOF'), source
    assert not re.search(rb'/(JavaScript|Launch|EmbeddedFile|URI)\b', data), source
    text = subprocess.check_output([text_tool, '-layout', str(source), '-'], text=True)
    info = subprocess.check_output([info_tool, str(source)], text=True)
    assert 'SYNTHETIC-2026-001' in text and 'परीक्षण' in text and 'ग्राहक' in text and '₹' in text, source
    assert all(value in text for value in ['₹ 40.00', '₹ 100.00', '₹ 0.00', '2.500 box', '25.000 piece']), source
    assert ('₹ -500.00' if kind == 'sales_credit' else '₹ 500.00') in text, source
    assert '<script>' in text and 'https://127.0.0.1/no-fetch' in text, source
    # Every synthetic line survives wrapping and page breaks exactly once.
    for row in range(1, rows + 1):
        assert len(re.findall(rf'Item {row}:', text)) == 1, (source, row)
    pages = int(re.search(r'^Pages:\s+(\d+)', info, re.M).group(1))
    assert pages >= (2 if rows >= 80 else 1), source
    width = float(re.search(r'^Page size:\s+([0-9.]+)', info, re.M).group(1))
    assert abs(width - (226.772 if layout == 'thermal80' else 595.28)) < .1, (source, width)
    assert re.search(r'^JavaScript:\s+no', info, re.M) and re.search(r'^Encrypted:\s+no', info, re.M), source
    for page in sorted({1, pages}):
        target = args.samples / f'{kind}-{layout}-page{page}'
        subprocess.run([image_tool, '-f', str(page), '-singlefile', '-scale-to', '1400', '-png', str(source), str(target)], check=True, stdout=subprocess.DEVNULL)
        assert target.with_suffix('.png').stat().st_size > 1000
    (args.samples / f'{kind}-{layout}.txt').write_text(text)
    results.append({'file': source.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'pages': pages, 'width_points': width, 'exact_money_and_rows': 'pass', 'hindi_and_rupee_content': 'pass'})
boundary = args.samples / 'header-boundary-a4.pdf'
boundary_text = subprocess.check_output([text_tool, '-layout', str(boundary), '-'], text=True)
assert boundary_text.count('Item / वस्तु') == 1 and boundary_text.count('Item 1:') == 1, 'Duplicate/missing boundary header or row'
subprocess.run([image_tool, '-f', '2', '-singlefile', '-scale-to', '1400', '-png', str(boundary), str(args.samples / 'header-boundary-a4-page2')], check=True, stdout=subprocess.DEVNULL)
results.append({'file': boundary.name, 'sha256': hashlib.sha256(boundary.read_bytes()).hexdigest(), 'one_header_after_initial_page_break': 'pass'})
manifest = {'scope': 'Synthetic samples; screen-rendered output, not physical-printer acceptance', 'tool': 'Poppler', 'results': results}
(args.samples / 'verification.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
