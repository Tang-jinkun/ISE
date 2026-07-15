import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = path.resolve(import.meta.dirname, '../src');
const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

async function collectModuleSpecifiers(filePath: string, visited = new Set<string>()): Promise<string[]> {
  const resolvedPath = path.resolve(filePath);
  if (visited.has(resolvedPath)) {
    return [];
  }
  visited.add(resolvedPath);

  const source = await readFile(resolvedPath, 'utf8');
  const sourceFile = ts.createSourceFile(resolvedPath, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  const dependencies = specifiers.filter((specifier) => specifier.startsWith('.'));
  const transitiveSpecifiers = await Promise.all(
    dependencies.map((specifier) => {
      const typescriptSpecifier = specifier.replace(/\.js$/, '.ts');
      return collectModuleSpecifiers(path.resolve(path.dirname(resolvedPath), typescriptSpecifier), visited);
    })
  );

  return [...specifiers, ...transitiveSpecifiers.flat()];
}

test('browser package entrypoint has no transitive Node built-in dependencies', async () => {
  const specifiers = await collectModuleSpecifiers(path.join(sourceRoot, 'index.ts'));
  assert.deepEqual(
    specifiers.filter((specifier) => nodeBuiltins.has(specifier)),
    []
  );
});
