import * as fs from 'fs';
import * as path from 'path';

describe('API runtime dependencies', () => {
  it.each(['class-transformer', 'class-validator'])(
    'ships %s for the global ValidationPipe',
    (dependency) => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
      );

      expect(packageJson.dependencies).toHaveProperty(dependency);
      expect(packageJson.devDependencies).not.toHaveProperty(dependency);
    },
  );
});
