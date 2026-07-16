import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import path from 'path';

const apiProxyTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3333';
const agentProxyTarget = process.env.AGENT_PROXY_TARGET || 'http://127.0.0.1:4444';

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  plugins: [pluginReact()],
  html: {
    title: '智能化战例场景编排器',
    favicon: './public/favicon.png'
  },
  output: {},
  server: {
    port: 9999,
    proxy: {
      '/SceneBack': {
        target: apiProxyTarget,
        changeOrigin: true,
        pathRewrite: {
          '^/SceneBack': ''
        }
      },
      '/SceneAgent': {
        target: agentProxyTarget,
        changeOrigin: true,
        pathRewrite: {
          '^/SceneAgent': ''
        }
      }
    }
  },
  source: {
    define: {
      'process.env.API_BASE': JSON.stringify('/SceneBack/')
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
