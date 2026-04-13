import fs from 'node:fs';
import path from 'node:path';

const standaloneRoot = path.join(process.cwd(), '.next', 'standalone');

if (!fs.existsSync(standaloneRoot)) {
  console.warn(`[materialize-standalone] Skip: ${standaloneRoot} does not exist.`);
  process.exit(0);
}

materializeLinks(standaloneRoot);

function materializeLinks(root) {
  let pass = 0;

  while (true) {
    pass += 1;
    const links = collectLinks(root);

    if (links.length === 0) {
      console.log(`[materialize-standalone] Completed after ${pass - 1} pass(es).`);
      return;
    }

    for (const linkPath of links) {
      replaceLink(linkPath);
    }
  }
}

function collectLinks(root) {
  const queue = [root];
  const output = [];

  while (queue.length > 0) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const stats = fs.lstatSync(entryPath);

      if (stats.isSymbolicLink()) {
        output.push(entryPath);
        continue;
      }

      if (entry.isDirectory()) {
        queue.push(entryPath);
      }
    }
  }

  return output;
}

function replaceLink(linkPath) {
  const realTarget = fs.realpathSync(linkPath);
  const targetStats = fs.statSync(linkPath);

  fs.rmSync(linkPath, { recursive: true, force: true });

  if (targetStats.isDirectory()) {
    fs.cpSync(realTarget, linkPath, {
      recursive: true,
      dereference: true,
      force: true,
      verbatimSymlinks: false,
    });
  } else {
    fs.copyFileSync(realTarget, linkPath);
  }

  console.log(`[materialize-standalone] Materialized ${path.relative(process.cwd(), linkPath)}`);
}
