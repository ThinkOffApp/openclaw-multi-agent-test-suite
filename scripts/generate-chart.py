#!/usr/bin/env python3
"""Generate a stacked bar chart of OMATS results by model and stage.

Usage: python3 scripts/generate-chart.py [--output chart.svg]

Reads summary.json files from runs/ directories and generates an SVG chart.
"""

import json
import sys
import os
from pathlib import Path

def load_results(runs_dir):
    """Load all model results from summary files."""
    models = {}

    for entry in sorted(Path(runs_dir).iterdir()):
        summary = entry / 'summary.json' if entry.is_dir() else None
        if not summary or not summary.exists():
            continue

        data = json.loads(summary.read_text())
        model_name = data.get('model', entry.name)

        stages = {3: {'pass': 0, 'total': 0}, 4: {'pass': 0, 'total': 0}, 5: {'pass': 0, 'total': 0}}

        for r in data.get('results', []):
            scenario = r.get('scenario', '')
            stage_str = scenario.split('/')[0].replace('stage', '')
            try:
                stage = int(stage_str)
            except ValueError:
                continue

            if stage in stages:
                stages[stage]['total'] += 1
                if r.get('status') == 'pass':
                    stages[stage]['pass'] += 1

        total_pass = sum(s['pass'] for s in stages.values())
        total_tests = sum(s['total'] for s in stages.values())

        models[model_name] = {
            'stages': stages,
            'total_pass': total_pass,
            'total_tests': total_tests
        }

    return models

def generate_svg(models, output_path):
    """Generate stacked horizontal bar chart as SVG."""
    # Sort by total score descending
    sorted_models = sorted(models.items(), key=lambda x: x[1]['total_pass'], reverse=True)

    bar_height = 35
    bar_gap = 12
    label_width = 160
    chart_width = 400
    max_score = 28  # total scenarios

    total_height = len(sorted_models) * (bar_height + bar_gap) + 80
    total_width = label_width + chart_width + 80

    colors = {3: '#4CAF50', 4: '#2196F3', 5: '#FF9800'}  # green, blue, orange

    svg_parts = []
    svg_parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_width} {total_height}" font-family="monospace">')
    svg_parts.append(f'  <text x="{total_width/2}" y="25" text-anchor="middle" font-size="16" font-weight="bold">OMATS Scores by Model</text>')

    # Legend
    legend_y = 45
    for stage, color in colors.items():
        x = label_width + (stage - 3) * 120
        svg_parts.append(f'  <rect x="{x}" y="{legend_y}" width="14" height="14" fill="{color}" rx="2"/>')
        svg_parts.append(f'  <text x="{x + 18}" y="{legend_y + 12}" font-size="11">Stage {stage}</text>')

    y_offset = 70

    for i, (model_name, data) in enumerate(sorted_models):
        y = y_offset + i * (bar_height + bar_gap)

        # Model label
        short_name = model_name.split('/')[-1]
        if len(short_name) > 20:
            short_name = short_name[:18] + '..'
        svg_parts.append(f'  <text x="{label_width - 8}" y="{y + bar_height/2 + 5}" text-anchor="end" font-size="12">{short_name}</text>')

        # Stacked bars
        x_pos = label_width
        for stage in [3, 4, 5]:
            passes = data['stages'][stage]['pass']
            width = (passes / max_score) * chart_width
            if width > 0:
                svg_parts.append(f'  <rect x="{x_pos}" y="{y}" width="{width}" height="{bar_height}" fill="{colors[stage]}" rx="2"/>')
                if width > 18:
                    svg_parts.append(f'  <text x="{x_pos + width/2}" y="{y + bar_height/2 + 5}" text-anchor="middle" font-size="11" fill="white">{passes}</text>')
                x_pos += width

        # Total score
        svg_parts.append(f'  <text x="{x_pos + 8}" y="{y + bar_height/2 + 5}" font-size="12" font-weight="bold">{data["total_pass"]}/{data["total_tests"]}</text>')

        # Light background bar
        svg_parts.insert(-1, f'  <rect x="{label_width}" y="{y}" width="{chart_width}" height="{bar_height}" fill="#f0f0f0" rx="2"/>')

    svg_parts.append('</svg>')

    svg = '\n'.join(svg_parts)
    Path(output_path).write_text(svg)
    print(f'Chart written to {output_path}')

def generate_markdown_chart(models):
    """Generate a text-based chart for README."""
    sorted_models = sorted(models.items(), key=lambda x: x[1]['total_pass'], reverse=True)

    lines = []
    lines.append('```')
    lines.append('OMATS Scores by Model (Stage 3 / Stage 4 / Stage 5)')
    lines.append('')

    max_bar = 28
    bar_width = 28  # one char per possible point

    for model_name, data in sorted_models:
        short = model_name.split('/')[-1]
        if len(short) > 16:
            short = short[:14] + '..'

        s3 = data['stages'][3]['pass']
        s4 = data['stages'][4]['pass']
        s5 = data['stages'][5]['pass']
        total = data['total_pass']

        bar = '#' * s3 + '=' * s4 + '+' * s5
        padding = '.' * (bar_width - len(bar))

        lines.append(f'{short:>16} |{bar}{padding}| {total}/{data["total_tests"]}  (S3:{s3} S4:{s4} S5:{s5})')

    lines.append('')
    lines.append('Legend: # = Stage 3, = = Stage 4, + = Stage 5')
    lines.append('```')

    return '\n'.join(lines)

if __name__ == '__main__':
    runs_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'runs')
    output = sys.argv[sys.argv.index('--output') + 1] if '--output' in sys.argv else os.path.join(runs_dir, 'chart.svg')

    models = load_results(runs_dir)

    if not models:
        print('No model results found in runs/', file=sys.stderr)
        sys.exit(1)

    generate_svg(models, output)
    print()
    print(generate_markdown_chart(models))
