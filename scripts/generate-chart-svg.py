#!/usr/bin/env python3
"""Generate a stacked horizontal bar chart SVG of OMATS results."""

import sys
import os

# Model data: (name, s3_pass, s3_total, s4_pass, s4_total, s5_pass, s5_total)
MODELS = [
    ("GPT-5.4",        4, 5, 13, 13, 10, 10),
    ("Mistral Large",  5, 5, 13, 13,  9, 10),
    ("Gemini 2.5 Pro", 5, 5, 12, 13, 10, 10),
    ("Grok 3",         5, 5, 13, 13,  9, 10),
    ("GPT-4o",         4, 5, 12, 13,  9, 10),
    ("Qwen Max",       4, 5, 12, 13,  9, 10),
    ("Qwen 3.5-27B",   3, 5, 12, 13,  9, 10),
    ("Kimi K2.5",      5, 5, 10, 12,  8, 10),
    ("Grok 4.1 Fast",  5, 5,  9, 13,  8, 10),
    ("Qwen 3-8B",      4, 5,  8, 13,  9, 10),
    ("Qwen 3-4B",      2, 5,  9, 13,  6, 10),
]

# Sort by total score descending
MODELS.sort(key=lambda m: m[1] + m[3] + m[5], reverse=True)

# Colors
C3 = "#2ecc71"  # green for stage 3
C4 = "#3498db"  # blue for stage 4
C5 = "#e67e22"  # orange for stage 5
BG = "#ecf0f1"  # light gray background
TEXT = "#2c3e50" # dark text

# Dimensions
bar_height = 40
bar_gap = 10
label_width = 140
chart_width = 450
max_score = 28
padding_top = 70
padding_right = 90
padding_bottom = 50

total_height = padding_top + len(MODELS) * (bar_height + bar_gap) + padding_bottom
total_width = label_width + chart_width + padding_right

svg = []
svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_width}" height="{total_height}" viewBox="0 0 {total_width} {total_height}">')
svg.append(f'<rect width="{total_width}" height="{total_height}" fill="white"/>')

# Title
svg.append(f'<text x="{total_width/2}" y="30" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="{TEXT}">OMATS Multi-Agent Benchmark</text>')
svg.append(f'<text x="{total_width/2}" y="48" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#7f8c8d">28 scenarios across 3 stages — March 2026</text>')

# Legend
legend_x = label_width
legend_y = 58
for label, color, x_off in [("Stage 3: Agent", C3, 0), ("Stage 4: Multi-Agent", C4, 130), ("Stage 5: Management", C5, 290)]:
    x = legend_x + x_off
    svg.append(f'<rect x="{x}" y="{legend_y}" width="12" height="12" fill="{color}" rx="2"/>')
    svg.append(f'<text x="{x + 16}" y="{legend_y + 10}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="{TEXT}">{label}</text>')

# Bars
for i, (name, s3, t3, s4, t4, s5, t5) in enumerate(MODELS):
    y = padding_top + i * (bar_height + bar_gap)
    total = s3 + s4 + s5
    pct = total / max_score * 100

    # Model label
    svg.append(f'<text x="{label_width - 10}" y="{y + bar_height/2 + 5}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="{TEXT}">{name}</text>')

    # Background bar
    svg.append(f'<rect x="{label_width}" y="{y}" width="{chart_width}" height="{bar_height}" fill="{BG}" rx="4"/>')

    # Stacked segments
    x_pos = label_width
    for passes, color in [(s3, C3), (s4, C4), (s5, C5)]:
        width = (passes / max_score) * chart_width
        if width > 0:
            svg.append(f'<rect x="{x_pos}" y="{y}" width="{width}" height="{bar_height}" fill="{color}" rx="0"/>')
            if width > 20:
                svg.append(f'<text x="{x_pos + width/2}" y="{y + bar_height/2 + 5}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="white">{passes}</text>')
            x_pos += width

    # Round corners on the combined bar
    total_width_bar = (total / max_score) * chart_width
    svg.append(f'<rect x="{label_width}" y="{y}" width="{total_width_bar}" height="{bar_height}" fill="none" stroke="none" rx="4"/>')

    # Score label
    svg.append(f'<text x="{label_width + chart_width + 8}" y="{y + bar_height/2 + 5}" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="{TEXT}">{total}/28</text>')
    svg.append(f'<text x="{label_width + chart_width + 50}" y="{y + bar_height/2 + 5}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#7f8c8d">{pct:.0f}%</text>')

svg.append('</svg>')

output_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'omats-chart.svg')
os.makedirs(os.path.dirname(output_path), exist_ok=True)

with open(output_path, 'w') as f:
    f.write('\n'.join(svg))

print(f'Chart written to {output_path}')
