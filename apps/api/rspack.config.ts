import type { Configuration } from '@rspack/core';
import * as path from 'path';

const config: Configuration = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  target: 'node',
  stats: 'errors-warnings',
  entry: {
    main: './src/main.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js',
    clean: true,
  },
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.js', '.json'],
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
