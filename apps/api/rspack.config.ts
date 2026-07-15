import type { Configuration } from '@rspack/core';
import * as path from 'path';

const bundledWorkspacePackage = /^@ise\/runtime-contracts(?:\/node)?$/;

const config: Configuration = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  target: 'node',
  stats: 'errors-warnings',
  entry: {
    main: './src/main.ts',
    'runtime-contracts-smoke': './src/runtime-contracts-smoke.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'builtin:swc-loader',
            options: {
              jsc: {
                target: 'es2021',
                parser: {
                  syntax: 'typescript',
                  tsx: false,
                  decorators: true,
                },
                transform: {
                  legacyDecorator: true,
                  decoratorMetadata: true,
                },
              },
            },
          },
        ],
      },
    ],
  },
  externalsPresets: { node: true },
  externals: [
    ({ request }, callback) => {
      if (request && bundledWorkspacePackage.test(request)) {
        callback();
        return;
      }
      if (
        request &&
        !request.startsWith('.') &&
        !path.isAbsolute(request) &&
        !request.startsWith('@/')
      ) {
        callback(null, `commonjs ${request}`);
        return;
      }
      callback();
    },
  ],
};

export default config;
