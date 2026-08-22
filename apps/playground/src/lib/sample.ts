export const SAMPLE_SOURCE = `// Edit this source, pick transforms on the left, then press Obfuscate.
const MAX_RETRIES = 3;
const PATHS = { '/a': 'alpha', '/b': 'beta', '/c': 'gamma' };

const shout = (text) => text.toUpperCase();

function lookup(path) {
  return PATHS[path] ?? null;
}

class Fetcher {
  constructor(name) {
    this.name = name;
    this.calls = 0;
  }

  fetch(url, retries = MAX_RETRIES) {
    this.calls += 1;
    if (retries <= 0) {
      throw new Error(\`\${this.name} gave up on \${url}\`);
    }
    return lookup(url) ?? this.fetch(url, retries - 1);
  }
}

const fetcher = new Fetcher('playground');
const cache = { hits: 0 };
let report = '';

for (const url of ['/a', '/b', '/c']) {
  const key = url.length > 2 ? url : url + '!';

  if (!(key in cache)) {
    cache[key] = fetcher.fetch(url);
  } else {
    cache.hits += 1;
  }

  report += \`\${key}: \${shout(String(cache[key]))}\\n\`;
}

let checksum = 0;
for (let i = 0; i < 8; i += 1) {
  checksum += i * 2 ** 10;
}

switch (checksum % 3) {
  case 0:
    debugger;
    break;
  case 1:
    console.info('one', checksum);
    break;
  default:
    console.log(report);
}

cache.ratio ??= cache.hits / 3;

const unused = 'this binding gets removed';
console.log(\`calls=\${fetcher.calls}\`, checksum);
`
