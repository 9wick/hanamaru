"""Check local links, Markdown structure and copies of type-checked examples."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
paths = [ROOT / 'README.md', *sorted((ROOT / 'docs').glob('*.md'))]
errors = []
links = 0
anchors = 0


def slug(heading):
    return re.sub(r'[^\w\-\u0080-\U0010ffff ]', '', heading.lower()).replace(' ', '-')


for path in paths:
    text = path.read_text()
    if sum(line.startswith('```') for line in text.splitlines()) % 2:
        errors.append(f'{path}: unbalanced code fences')
    for link in re.findall(r'\]\(([^)]+)\)', text):
        if '://' in link:
            continue
        links += 1
        relative, _, fragment = link.partition('#')
        destination = path.parent / relative if relative else path
        if not destination.exists():
            errors.append(f'{path}: missing {link}')
        elif fragment and destination.suffix == '.md':
            anchors += 1
            headings = re.findall(r'^#+ (.+)$', destination.read_text(), re.M)
            if fragment not in [slug(heading) for heading in headings]:
                errors.append(f'{path}: missing anchor {link}')
    outside = re.sub(r'```.*?```', '', text, flags=re.S)
    table_width = None
    for line in outside.splitlines():
        if line.startswith('|'):
            width = len(re.split(r'(?<!\\)\|', line))
            if table_width is None:
                table_width = width
            elif width != table_width:
                errors.append(f'{path}: malformed table: {line}')
        else:
            table_width = None

examples = {
    'calls.test.ts': ['README.md', 'docs/getting-started.md'],
    'math.ts': ['docs/getting-started.md'],
    'math.test.ts': ['README.md', 'docs/getting-started.md'],
    'user.ts': ['docs/getting-started.md'],
    'user.test.ts': ['README.md', 'docs/getting-started.md'],
    'user-cases.ts': ['docs/grouping.md'],
    'groups.test.ts': ['docs/grouping.md'],
    'middleware.test.ts': ['docs/middleware.md'],
    'each.test.ts': ['README.md', 'docs/each.md'],
    'execution-options.test.ts': ['docs/execution-options.md'],
}
comparisons = 0
for name, targets in examples.items():
    body = (ROOT / 'docs/examples' / name).read_text().strip()
    for target in targets:
        comparisons += 1
        if '```ts\n' + body + '\n```' not in (ROOT / target).read_text():
            errors.append(f'{target}: stale sample {name}')

negative = sum(
    path.read_text().count('@ts-expect-error')
    for path in (ROOT / 'docs/spec').glob('*.ts')
)
print(f'{len(paths)} documents; {links} local links; {anchors} anchors; '
      f'{comparisons} sample copies; {negative} negative type assertions')
for error in errors:
    print(error)
print(f'errors: {len(errors)}')
raise SystemExit(bool(errors))
